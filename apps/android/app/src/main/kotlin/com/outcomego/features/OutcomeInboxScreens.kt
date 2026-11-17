package com.outcomego.features

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.mobile.core.*
import kotlinx.coroutines.launch
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import java.util.UUID

private data class OutcomeDestination(val kind: String, val id: String = "")
private val DecisionDraftSaver = Saver<OutcomeDecisionDraft, List<String>>(
    save = { listOf(it.optionId.orEmpty(), it.customText, it.attempt?.let { input -> mobileJson.encodeToString(input) }.orEmpty()) },
    restore = { OutcomeDecisionDraft(it[0].ifBlank { null }, it[1],
        it[2].ifBlank { null }?.let { input -> mobileJson.decodeFromString<ResolveOutcomeDecision>(input) }) },
)

@Composable
fun OutcomeInboxScreen(
    gateway: FeatureGateway,
    initialTarget: OutcomeLinkTarget? = null,
    onBack: () -> Unit,
    onUnsupported: () -> Unit,
    onAuthenticationRequired: (OutcomeLinkTarget) -> Unit,
) {
    var destination by remember(gateway, initialTarget) { mutableStateOf(initialTarget?.let {
        it.decisionId?.let { id -> OutcomeDestination("decision", id) }
            ?: it.outcomeId?.let { id -> OutcomeDestination("outcome", id) }
    }) }
    var page by remember(gateway) { mutableStateOf<OutcomeInboxPage?>(null) }
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    var loading by remember(gateway) { mutableStateOf(false) }
    var unavailable by remember(gateway) { mutableStateOf(false) }
    var failure by remember(gateway) { mutableStateOf(false) }
    var failedMore by remember(gateway) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun load(more: Boolean = false) {
        if (loading) return
        loading = true; failure = false; failedMore = more
        try {
            gateway.outcomeInbox(category, if (more) page?.nextCursor else null).fold(
                onSuccess = { next ->
                    unavailable = next == null
                    if (next != null) page = if (more) next.copy(items = (page?.items.orEmpty() + next.items).distinctBy { it.id }) else next
                },
                onFailure = {
                    if ((it as? OutcomeGoRequestException)?.error?.status == 401) {
                        page = null; onAuthenticationRequired(OutcomeLinkTarget())
                    } else failure = true
                },
            )
        } finally { loading = false }
    }
    LaunchedEffect(gateway, category, destination) { if (destination == null) load() }
    val selected = destination
    if (selected != null) {
        BackHandler { destination = null }
        when (selected.kind) {
            "decision" -> OutcomeDecisionScreen(gateway, selected.id, { destination = null },
                { destination = OutcomeDestination("outcome", it) }, onAuthenticationRequired)
            "human" -> OutcomeHumanActionScreen(gateway, selected.id, { destination = null }, onAuthenticationRequired)
            "outcome" -> OutcomeDetailScreen(gateway, selected.id, { destination = null },
                onHumanWorkItem = { destination = OutcomeDestination("human", it) },
                onAuthenticationRequired = onAuthenticationRequired)
            else -> OutcomesScreen(gateway, { destination = null }, onUnsupported,
                onHumanWorkItem = { destination = OutcomeDestination("human", it) },
                onAuthenticationRequired = onAuthenticationRequired)
        }
        return
    }
    FeaturePage(localizedText("Outcome Inbox", "成果收件箱"), onBack = onBack) {
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { TextButton(onClick = { destination = OutcomeDestination("list") }) { Text(localizedText("All outcomes", "全部成果")) } }
            item {
                Column {
                    listOf(null, "decision_pending", "acceptance_pending", "human_action_pending", "completed").forEach { value ->
                        TextButton(onClick = { if (category != value) { page = null; category = value } }, enabled = !loading) {
                            Text((if (category == value) "✓ " else "") + outcomeCategoryLabel(value))
                        }
                    }
                }
            }
            item { TextButton(onClick = { scope.launch { load() } }, enabled = !loading) { Text(localizedText("Refresh", "刷新")) } }
            if (loading) item { CircularProgressIndicator() }
            if (unavailable) item { Text(localizedText("Outcome Inbox is unavailable on this server.", "此服务器不支持成果收件箱。")) }
            if (failure) item {
                if (page?.items?.isNotEmpty() == true) Text(localizedText(
                    "Showing the last loaded items. They may be outdated.", "正在显示上次加载的事项，内容可能已过期。"))
                OutcomeRetry { scope.launch { load(failedMore) } }
            }
            if (page?.items?.isEmpty() == true && !loading) item { Text(localizedText("No inbox items", "暂无收件箱事项")) }
            items(page?.items.orEmpty(), key = { it.id }) { item ->
                OutcomeInboxCard(Modifier.clickable {
                    val fallback = OutcomeDestination("outcome", item.outcomeId)
                    destination = when (item.category) {
                        "decision_pending" -> item.decisionId?.let { OutcomeDestination("decision", it) } ?: fallback
                        "human_action_pending" -> item.workItemId?.let { OutcomeDestination("human", it) } ?: fallback
                        else -> fallback
                    }
                }) {
                    Text(item.title, style = MaterialTheme.typography.titleMedium)
                    Text(outcomeCategoryLabel(item.category))
                    OutcomeSummaryLines(item.completed, item.problem, item.next)
                    if (item.category in setOf("acceptance_pending", "human_action_pending")) OutcomeHumanDesktopNotice()
                }
            }
            if (page?.nextCursor != null && !failure) item {
                TextButton(onClick = { scope.launch { load(true) } }, enabled = !loading) { Text(localizedText("Load more", "加载更多")) }
            }
        }
    }
}

@Composable
private fun OutcomeDecisionScreen(
    gateway: FeatureGateway, id: String, onBack: () -> Unit,
    onOutcome: (String) -> Unit, onAuthenticationRequired: (OutcomeLinkTarget) -> Unit,
) {
    var decision by remember(gateway, id) { mutableStateOf<OutcomeDecision?>(null) }
    var draft by rememberSaveable(id, stateSaver = DecisionDraftSaver) { mutableStateOf(OutcomeDecisionDraft()) }
    var loading by remember { mutableStateOf(false) }
    var resolving by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf(false) }
    var retryResolve by remember { mutableStateOf(false) }
    var conflict by remember { mutableStateOf(false) }
    var expired by remember { mutableStateOf(false) }
    var resolution by remember { mutableStateOf<OutcomeDecisionResolution?>(null) }
    var expanded by rememberSaveable(id) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun unauthorized(error: Throwable): Boolean {
        if ((error as? OutcomeGoRequestException)?.error?.status != 401) return false
        decision = null
        onAuthenticationRequired(OutcomeLinkTarget(decisionId = id))
        return true
    }
    suspend fun load() {
        if (loading) return
        loading = true; retryResolve = false
        try {
            gateway.outcomeDecision(id).fold(onSuccess = { decision = it; failure = false },
                onFailure = { if (!unauthorized(it)) failure = true })
        } finally { loading = false }
    }
    suspend fun resolve() {
        val current = decision ?: return
        if (resolving || loading || expired || !draft.validFor(current)) return
        draft = draft.prepare(current) { UUID.randomUUID().toString() }
        val input = draft.attempt ?: return
        resolving = true; failure = false; conflict = false
        try {
            gateway.resolveOutcomeDecision(id, input).fold(
                onSuccess = { resolution = it },
                onFailure = { error ->
                    if (!unauthorized(error)) {
                        when ((error as? OutcomeGoRequestException)?.error?.status) {
                            409 -> conflict = true
                            410 -> expired = true
                            else -> { failure = true; retryResolve = true }
                        }
                    }
                },
            )
            if (conflict || expired || resolution != null) load()
        } finally { resolving = false }
    }
    LaunchedEffect(gateway, id) { load() }
    FeaturePage(localizedText("Decision", "决策"), onBack = onBack) {
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (loading || resolving) item { CircularProgressIndicator() }
            item { TextButton(onClick = { scope.launch { load() } }, enabled = !loading && !resolving) { Text(localizedText("Refresh", "刷新")) } }
            if (failure) item { OutcomeRetry { scope.launch { if (retryResolve) resolve() else load() } } }
            if (conflict) item { Text(localizedText("The decision changed. The current card was refreshed; your choice is kept.", "决策已变化。已刷新当前卡片，并保留你的选择。")) }
            if (expired) item { Text(localizedText("This decision has expired. Please view the current outcome.", "此决策已过期，请查看当前成果。")) }
            resolution?.let { result -> item { OutcomeInboxCard {
                Text(localizedText("Decision resolved", "决策已解决"))
                Text(outcomeResumeLabel(result.resume.status))
                TextButton(onClick = { onOutcome(result.outcomeId) }) { Text(localizedText("View outcome", "查看成果")) }
            } } }
            decision?.let { value ->
                item { OutcomeInboxCard {
                    OutcomeSummaryLines(value.completedSummary, value.problemSummary, value.nextStepSummary)
                    Text(outcomeDecisionStatusLabel(if (resolution != null) "resolved" else value.status))
                    value.recommendation?.let { Text(localizedText("Recommendation: ${it.reason}", "推荐依据：${it.reason}")) }
                    value.expiresAt?.let { Text(localizedText("Expires: $it", "到期时间：$it")) }
                } }
                if (!value.canResolve) item {
                    Text(localizedText("This decision is no longer open. View the current outcome.", "此决策已关闭，请查看当前成果。"))
                    value.resolvedOption?.let { Text(it.label) }
                    value.customText?.let { Text(it) }
                }
                items(value.options, key = { it.id }) { option ->
                    TextButton(onClick = { draft = draft.choose(option.id) }, enabled = value.canResolve && !resolving && !expired && resolution == null) {
                        Column(Modifier.fillMaxWidth()) {
                            Text((if (draft.optionId == option.id) "✓ " else "") + option.label)
                            Text(option.consequence)
                            if (option.recommended == true) Text(localizedText("Recommended", "推荐"))
                            option.reason?.let { Text(it) }
                        }
                    }
                }
                if (value.customEntryAllowed) item {
                    OutlinedTextField(
                        value = draft.customText, onValueChange = { draft = draft.edit(it) },
                        label = { Text(localizedText("Custom choice", "自定义方案")) },
                        enabled = value.canResolve && !resolving && !expired && resolution == null,
                        modifier = Modifier.fillMaxWidth(),
                        supportingText = { Text(localizedText("Up to 4,000 characters", "最多 4,000 个字符")) },
                    )
                    if (draft.optionId != null) Text(localizedText("The selected option will be submitted.", "将提交已选选项。"))
                }
                if (draft.optionId != null && value.options.none { it.id == draft.optionId }) item {
                    Text(localizedText("Your previous option is unavailable. Choose another option to continue.", "此前的选项已不可用，请重新选择。"))
                }
                if (value.canResolve && resolution == null && !expired) item {
                    TextButton(onClick = { scope.launch { resolve() } }, enabled = !resolving && !loading && draft.validFor(value)) {
                        Text(localizedText("Submit decision", "提交决策"))
                    }
                }
                item {
                    TextButton(onClick = { expanded = !expanded }) { Text(localizedText("Details", "详情")) }
                    if (expanded) {
                        Text(localizedText("Revision ${value.contractRevision}", "修订 ${value.contractRevision}"))
                        TextButton(onClick = { onOutcome(value.outcomeId) }) { Text(localizedText("View outcome", "查看成果")) }
                        if (value.truncatedOptionCount > 0) Text(localizedText("Additional options were omitted by the server.", "服务器省略了部分选项。"))
                    }
                }
            }
        }
    }
}

@Composable
internal fun OutcomeHumanActionScreen(
    gateway: FeatureGateway, id: String, onBack: () -> Unit,
    onAuthenticationRequired: (OutcomeLinkTarget) -> Unit,
) {
    var detail by remember(gateway, id) { mutableStateOf<OutcomeHumanWorkItem?>(null) }
    var loading by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf(false) }
    var referencesExpanded by rememberSaveable(id) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun load() {
        if (loading) return
        loading = true; failure = false
        try {
            gateway.outcomeHumanWorkItem(id).fold(onSuccess = { detail = it }, onFailure = {
                if ((it as? OutcomeGoRequestException)?.error?.status == 401) {
                    val target = OutcomeLinkTarget(outcomeId = detail?.outcomeId)
                    detail = null; onAuthenticationRequired(target)
                } else failure = true
            })
        } finally { loading = false }
    }
    LaunchedEffect(gateway, id) { load() }
    FeaturePage(detail?.title ?: localizedText("Human action", "人工动作"), onBack = onBack) {
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { OutcomeHumanDesktopNotice() }
            item { TextButton(onClick = { scope.launch { load() } }, enabled = !loading) { Text(localizedText("Refresh", "刷新")) } }
            if (loading) item { CircularProgressIndicator() }
            if (failure) item { OutcomeRetry { scope.launch { load() } } }
            detail?.let { value ->
                item { Text(outcomeStatusLabel(value.status)) }
                item { Text(localizedText("Receipt history", "回执历史")) }
                items(value.receipts.sortedByDescending { it.sequence }, key = { it.id }) { receipt ->
                    OutcomeInboxCard {
                        Text(localizedText("Receipt ${receipt.sequence}", "回执 ${receipt.sequence}"))
                        Text(outcomeStatusLabel(receipt.status))
                        Text(receipt.submittedAt)
                        Text(receipt.payload.comment)
                        Text(receipt.payload.text)
                        receipt.reviewComment?.let { Text(it) }
                        receipt.missingRequirements.forEach { Text(it.label) }
                    }
                }
                val card = value.card
                if (card == null) item { Text(localizedText("No human action card is available.", "暂无人工动作卡。")) }
                else {
                    item { OutcomeInboxCard {
                        Text(card.title, style = MaterialTheme.typography.titleMedium)
                        Text(card.purpose)
                        Text(localizedText("Revision ${card.contractRevision}", "修订 ${card.contractRevision}"))
                    } }
                    item { Text(localizedText("Prerequisites", "前置条件")) }
                    items(card.prerequisites) { Text((if (it.completed) "✓ " else "○ ") + it.label) }
                    item { Text(localizedText("Steps", "步骤")) }
                    items(card.steps.sortedBy { it.ordinal }, key = { it.id }) { step ->
                        Text("${step.ordinal}. ${step.text}" + if (step.optional) localizedText(" (optional)", "（可选）") else "")
                    }
                    item { Text(localizedText("Required inputs", "输入要求")) }
                    items(card.inputFields, key = { it.id }) { Text(it.label + if (it.required) localizedText(" (required)", "（必需）") else "") }
                    item { Text(localizedText("Evidence requirements", "证据要求")) }
                    items(card.evidenceRequirements) { Text(it.label + if (it.required) localizedText(" (required)", "（必需）") else "") }
                    item {
                        TextButton(onClick = { referencesExpanded = !referencesExpanded }) { Text(localizedText("References", "资料引用")) }
                        if (referencesExpanded) card.references.forEach { reference ->
                            OutcomeInboxCard {
                                Text(reference.title)
                                Text(reference.version)
                                Text(reference.sourceRef)
                                Text(reference.permissionSummary)
                                if (reference.stale) Text(localizedText("This reference is outdated.", "此资料已过期。"))
                                reference.excerpt?.let { Text(it) }
                            }
                        }
                    }
                    card.draft?.let { draft -> item { OutcomeInboxCard {
                        Text(localizedText("Saved Desktop progress", "Desktop 已保存的进度"))
                        Text(draft.draftSummary)
                        Text(draft.reason)
                    } } }
                }
            }
        }
    }
}

@Composable
internal fun OutcomeInboxCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    SpatialGlassSurface(modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}
@Composable
private fun OutcomeSummaryLines(completed: String, problem: String, next: String) {
    Text(localizedText("Completed: $completed", "已完成：$completed"))
    Text(localizedText("Problem: ${problem.ifBlank { "No unresolved issues" }}", "当前问题：${problem.ifBlank { "无未解问题" }}"))
    Text(localizedText("Next: $next", "下一步：$next"))
}
@Composable
private fun OutcomeRetry(onRetry: () -> Unit) {
    TextButton(onClick = onRetry) { Text(localizedText("Could not load this item. Retry", "无法加载此事项，重试")) }
}
@Composable
internal fun OutcomeHumanDesktopNotice() {
    Text(localizedText("Start, pause, receipts and review: please complete on Desktop.", "开始、暂停、回执和验收：请在 Desktop 完成。"))
}
@Composable
internal fun outcomeCategoryLabel(category: String?): String = when (category) {
    null -> localizedText("All categories", "全部分类")
    "decision_pending" -> localizedText("Pending decision", "待决策")
    "acceptance_pending" -> localizedText("Pending review", "待验收")
    "human_action_pending" -> localizedText("Pending human action", "待人工处理")
    "completed" -> localizedText("Completed", "已完成")
    else -> localizedText("Outcome update", "成果更新")
}
@Composable
private fun outcomeDecisionStatusLabel(status: String): String = when (status) {
    "open", "presented" -> localizedText("Awaiting your decision", "等待你的决策")
    "resolved" -> localizedText("Decision resolved", "决策已解决")
    "expired" -> localizedText("Decision expired", "决策已过期")
    "withdrawn" -> localizedText("Replaced by a newer state", "已由新状态替代")
    else -> localizedText("Unknown status", "未知状态")
}
@Composable
private fun outcomeResumeLabel(status: String): String = when (status) {
    "enqueued", "queued_for_capacity" -> localizedText("The task is queued to continue.", "任务已排队等待继续。")
    "pending_approval" -> localizedText("A new revision needs approval on Desktop.", "新修订需在 Desktop 批准。")
    "waiting_human" -> localizedText("A human action is required on Desktop.", "请在 Desktop 处理人工动作。")
    "cancelled" -> localizedText("The branch was cancelled.", "分支已取消。")
    else -> localizedText("View the outcome for its current state.", "请查看成果的当前状态。")
}
