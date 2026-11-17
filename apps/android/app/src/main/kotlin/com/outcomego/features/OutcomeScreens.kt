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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.outcomego.mobile.core.OutcomeDetail
import com.outcomego.mobile.core.OutcomeListPage
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import kotlinx.coroutines.launch

@Composable
fun OutcomesScreen(
    gateway: FeatureGateway, onBack: () -> Unit, onUnsupported: () -> Unit,
    onHumanWorkItem: (String) -> Unit = {},
    onAuthenticationRequired: (com.outcomego.mobile.core.OutcomeLinkTarget) -> Unit = {},
) {
    var page by remember(gateway) { mutableStateOf<OutcomeListPage?>(null) }
    var detailID by remember(gateway) { mutableStateOf<String?>(null) }
    var loading by remember(gateway) { mutableStateOf(false) }
    var failure by remember(gateway) { mutableStateOf(false) }
    var failedMore by remember(gateway) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun load(more: Boolean = false) {
        if (loading) return
        loading = true
        failure = false
        failedMore = more
        val cursor = if (more) page?.nextCursor else null
        gateway.listOutcomes(cursor).fold(
            onSuccess = { next ->
                if (next == null) onUnsupported()
                else page = if (more) next.copy(items = (page?.items.orEmpty() + next.items).distinctBy { it.id }) else next
            },
            onFailure = {
                if ((it as? com.outcomego.mobile.core.OutcomeGoRequestException)?.error?.status == 401) {
                    page = null
                    onAuthenticationRequired(com.outcomego.mobile.core.OutcomeLinkTarget())
                } else failure = true
            },
        )
        loading = false
    }
    LaunchedEffect(gateway) { load() }
    val selected = detailID
    if (selected != null) {
        BackHandler { detailID = null }
        OutcomeDetailScreen(gateway, selected, { detailID = null }, onHumanWorkItem, onAuthenticationRequired)
        return
    }
    FeaturePage(localizedText("Outcomes", "成果"), onBack = onBack) {
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { OutcomeDesktopNotice() }
            item { TextButton(onClick = { scope.launch { load() } }, enabled = !loading) { Text(localizedText("Refresh", "刷新")) } }
            items(page?.items.orEmpty(), key = { it.id }) { outcome ->
                OutcomeCard(Modifier.clickable { detailID = outcome.id }) {
                    Text(outcome.title, style = MaterialTheme.typography.titleMedium)
                    Text(outcomeStatusLabel(outcome.status))
                    Text(localizedText("Updated: ${outcome.updatedAt}", "更新时间：${outcome.updatedAt}"), style = MaterialTheme.typography.bodySmall)
                }
            }
            if (page?.items?.isEmpty() == true) item { Text(localizedText("No outcomes yet", "暂无成果")) }
            if (loading) item { CircularProgressIndicator() }
            if (failure) item { TextButton(onClick = { scope.launch { load(failedMore) } }) { Text(localizedText("Could not load outcomes. Retry", "无法加载成果，重试")) } }
            if (page?.nextCursor != null && !failure) item {
                TextButton(onClick = { scope.launch { load(true) } }, enabled = !loading) { Text(localizedText("Load more", "加载更多")) }
            }
        }
    }
}

@Composable
internal fun OutcomeDetailScreen(
    gateway: FeatureGateway, id: String, onBack: () -> Unit,
    onHumanWorkItem: (String) -> Unit = {},
    onAuthenticationRequired: (com.outcomego.mobile.core.OutcomeLinkTarget) -> Unit = {},
) {
    var detail by remember(gateway, id) { mutableStateOf<OutcomeDetail?>(null) }
    var loading by remember(gateway, id) { mutableStateOf(false) }
    var failure by remember(gateway, id) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun load() {
        if (loading) return
        loading = true
        failure = false
        gateway.outcomeDetail(id).fold(onSuccess = { detail = it }, onFailure = {
            if ((it as? com.outcomego.mobile.core.OutcomeGoRequestException)?.error?.status == 401) {
                detail = null
                onAuthenticationRequired(com.outcomego.mobile.core.OutcomeLinkTarget(outcomeId = id))
            } else failure = true
        })
        loading = false
    }
    LaunchedEffect(gateway, id) { load() }
    FeaturePage(detail?.title ?: localizedText("Outcome", "成果"), onBack = onBack) {
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { OutcomeDesktopNotice() }
            item { TextButton(onClick = { scope.launch { load() } }, enabled = !loading) { Text(localizedText("Refresh", "刷新")) } }
            if (loading) item { CircularProgressIndicator() }
            if (failure) item { TextButton(onClick = { scope.launch { load() } }) { Text(localizedText("Could not load outcome. Retry", "无法加载成果，重试")) } }
            detail?.let { value ->
                item { OutcomeCard {
                    Text(outcomeStatusLabel(value.status))
                    Text(value.description)
                    Text(localizedText("Current revision: ${value.currentRevision ?: "—"}", "当前修订：${value.currentRevision ?: "—"}"))
                    Text(localizedText("Updated: ${value.updatedAt}", "更新时间：${value.updatedAt}"))
                    value.currentRevisionView?.goal?.forEach { Text(it) }
                } }
                item { Text(localizedText("Work items", "工作项"), style = MaterialTheme.typography.titleMedium) }
                items(value.workItems.sortedBy { it.ordinal }, key = { it.id }) { work -> OutcomeCard {
                    Text(work.title)
                    Text(outcomeStatusLabel(work.status))
                    Text(localizedText("Revision ${work.contractRevision}", "修订 ${work.contractRevision}"))
                    work.statusReason?.let { Text(it) }
                    if (work.executorType == "human") {
                        TextButton(onClick = { onHumanWorkItem(work.id) }) { Text(localizedText("View human action", "查看人工动作")) }
                    }
                } }
                item { Text(localizedText("Outputs", "输出"), style = MaterialTheme.typography.titleMedium) }
                items(value.outputs, key = { it.id }) { output -> OutcomeCard {
                    Text(output.title)
                    output.content?.let { Text(it) }
                    output.contentRef?.let { Text(it) }
                } }
                item { Text(localizedText("Acceptance results", "验收结果"), style = MaterialTheme.typography.titleMedium) }
                items(value.currentRevisionView?.criteria.orEmpty().sortedBy { it.ordinal }, key = { it.id }) { criterion -> OutcomeCard {
                    Text(criterion.statement)
                    Text(if (criterion.required) localizedText("Required", "必需") else localizedText("Optional", "可选"))
                    Text(outcomeStatusLabel(criterion.latestResult))
                    value.reviews.filter { it.criterionId == criterion.id && it.contractRevision == value.currentRevision }
                        .sortedByDescending { it.sequence }.forEach { review ->
                            Text(outcomeStatusLabel(review.result))
                            Text(review.comment)
                            Text(review.reviewedAt)
                            value.evidence.filter { it.id in review.evidenceIds }.forEach { evidence ->
                                Text(evidence.contentSummary)
                                Text(evidence.sourceRef)
                            }
                        }
                } }
            }
        }
    }
}

@Composable
private fun OutcomeDesktopNotice() {
    Text(localizedText("Planning, approval, acceptance and rework: please complete on Desktop.", "规划、批准、验收和返工：请在 Desktop 完成。"))
}

@Composable
private fun OutcomeCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    SpatialGlassSurface(modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { content() }
    }
}

@Composable
internal fun outcomeStatusLabel(value: String?): String = when (value) {
    "draft" -> localizedText("Draft", "草稿")
    "planning" -> localizedText("Planning", "规划中")
    "pending_approval" -> localizedText("Pending approval", "待批准")
    "approved" -> localizedText("Approved", "已批准")
    "queued" -> localizedText("Queued", "排队中")
    "running" -> localizedText("Running", "执行中")
    "completed" -> localizedText("Completed", "已完成")
    "review_pending", "needs_review" -> localizedText("Pending review", "待验收")
    "decision_pending", "waiting_decision" -> localizedText("Pending decision", "待决策")
    "human_action_pending", "waiting_human" -> localizedText("Pending human action", "待人工处理")
    "accepted" -> localizedText("Accepted", "已验收")
    "failed" -> localizedText("Failed", "失败")
    "cancelled" -> localizedText("Cancelled", "已取消")
    "paused" -> localizedText("Paused", "已暂停")
    "pending" -> localizedText("Pending", "待处理")
    "ready" -> localizedText("Ready", "已就绪")
    "in_progress" -> localizedText("In progress", "处理中")
    "submitted" -> localizedText("Submitted", "已提交")
    "rejected" -> localizedText("Rejected", "已拒绝")
    "retry_pending" -> localizedText("Pending retry", "待重试")
    "PASS" -> localizedText("Pass", "通过")
    "FAIL" -> localizedText("Fail", "不通过")
    "UNVERIFIED", null -> localizedText("Unverified", "未验证")
    "WAIVED_BY_APPROVED_CHANGE" -> localizedText("Waived by approved change", "批准变更已豁免")
    else -> localizedText("Unknown status", "未知状态")
}
