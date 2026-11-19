package com.outcomego.features

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Assignment
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialGlassTextField
import com.outcomego.android.ui.designsystem.SpatialGroupedSection
import com.outcomego.android.ui.designsystem.SpatialHairlineDivider
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialPrimaryButton
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSecondaryButton
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.mobile.core.ApproveContractRevisionRequest
import com.outcomego.mobile.core.CancelOutcomeRequest
import com.outcomego.mobile.core.CreateContractRevisionRequest
import com.outcomego.mobile.core.OutcomeBoundaries
import com.outcomego.mobile.core.OutcomeContractDraftInput
import com.outcomego.mobile.core.OutcomeCriterionDraftInput
import com.outcomego.mobile.core.OutcomeCriterionReviewInput
import com.outcomego.mobile.core.OutcomeDetail
import com.outcomego.mobile.core.OutcomeGoRequestException
import com.outcomego.mobile.core.OutcomeLinkTarget
import com.outcomego.mobile.core.OutcomeListPage
import com.outcomego.mobile.core.OutcomeReworkRequest
import com.outcomego.mobile.core.StartOutcomeRunRequest
import com.outcomego.mobile.core.SubmitOutcomeReviewRequest
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.util.UUID

private enum class DetailSection { Overview, Tasks, Review }

@Composable
fun OutcomesScreen(
    gateway: FeatureGateway,
    onBack: () -> Unit,
    onUnsupported: () -> Unit,
    onHumanWorkItem: (String) -> Unit = {},
    onAuthenticationRequired: (OutcomeLinkTarget) -> Unit = {},
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
        gateway.listOutcomes(cursor = cursor).fold(
            onSuccess = { next ->
                if (next == null) onUnsupported()
                else page = if (more) next.copy(items = (page?.items.orEmpty() + next.items).distinctBy { it.id }) else next
            },
            onFailure = {
                if ((it as? OutcomeGoRequestException)?.error?.status == 401) {
                    page = null
                    onAuthenticationRequired(OutcomeLinkTarget())
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
    FeaturePage(
        title = localizedText("Outcomes", "成果"),
        onBack = onBack,
        actions = {
            SpatialIconOrb(
                icon = Icons.Outlined.Refresh,
                contentDescription = localizedText("Refresh", "刷新"),
                onClick = { scope.launch { load() } },
                enabled = !loading,
            )
        },
    ) {
        LazyColumn(
            contentPadding = PaddingValues(SpatialSpacing.md),
            verticalArrangement = Arrangement.spacedBy(SpatialSpacing.sm),
        ) {
            items(page?.items.orEmpty(), key = { it.id }) { outcome ->
                OutcomeCard(Modifier.clickable { detailID = outcome.id }) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        OutcomeStatusPill(outcome.status)
                        Spacer(Modifier.weight(1f))
                        Text(formatOutcomeTimestamp(outcome.updatedAt), style = MaterialTheme.typography.labelSmall, color = SpatialTheme.colors.textTertiary)
                    }
                    Text(outcome.title, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold), maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            if (page?.items?.isEmpty() == true) item { Text(localizedText("No outcomes yet", "暂无成果")) }
            if (loading) item { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            if (failure) item { TextButton(onClick = { scope.launch { load(failedMore) } }) { Text(localizedText("Could not load outcomes. Retry", "无法加载成果，重试")) } }
            if (page?.nextCursor != null && !failure) item {
                SpatialSecondaryButton(label = localizedText("Load more", "加载更多"), onClick = { scope.launch { load(true) } }, enabled = !loading)
            }
        }
    }
}

@Composable
internal fun OutcomeDetailScreen(
    gateway: FeatureGateway,
    id: String,
    onBack: () -> Unit,
    onHumanWorkItem: (String) -> Unit = {},
    onAuthenticationRequired: (OutcomeLinkTarget) -> Unit = {},
) {
    val colors = SpatialTheme.colors
    var detail by remember(gateway, id) { mutableStateOf<OutcomeDetail?>(null) }
    var loading by remember(gateway, id) { mutableStateOf(false) }
    var mutating by remember { mutableStateOf(false) }
    var failure by remember(gateway, id) { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var actionNotice by remember { mutableStateOf<String?>(null) }

    var section by rememberSaveable(id) { mutableIntStateOf(0) }
    var briefState by remember(id) { mutableStateOf(OutcomeBriefState()) }
    var briefRetry by remember(id) { mutableIntStateOf(0) }
    var showRevisionEditor by rememberSaveable(id) { mutableStateOf(false) }
    var threadFocus by remember(id) { mutableIntStateOf(0) }
    var showExecutionRecords by rememberSaveable(id) { mutableStateOf(false) }
    var executionInitialWorkId by remember(id) { mutableStateOf<String?>(null) }
    var goalLines by rememberSaveable(id) { mutableStateOf("") }
    var criteriaLines by rememberSaveable(id) { mutableStateOf("") }
    var includedLines by rememberSaveable(id) { mutableStateOf("") }
    var excludedLines by rememberSaveable(id) { mutableStateOf("") }
    var changeSummary by rememberSaveable(id) { mutableStateOf("") }

    var transcriptWorkId by remember { mutableStateOf<String?>(null) }
    var transcriptBody by remember { mutableStateOf<JsonElement?>(null) }
    var transcriptLoading by remember { mutableStateOf(false) }

    var reviewResults by remember(id) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var reviewComments by remember(id) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var reworkSelected by remember(id) { mutableStateOf<Set<String>>(emptySet()) }
    var reworkComment by rememberSaveable(id) { mutableStateOf("") }

    val scope = rememberCoroutineScope()
    val errTranscriptMsg = localizedText("Could not load transcript.", "无法加载执行日志。")
    val noticeApprovedMsg = localizedText("Revision approved.", "契约已批准。")
    val noticeStartedMsg = localizedText("Run started.", "已启动运行。")
    val noticeCancelledMsg = localizedText("Outcome cancelled.", "目标已取消。")
    val noticeRevisedMsg = localizedText("Revision created.", "已创建新修订。")
    val noticeReviewMsg = localizedText("Review submitted.", "验收评审已提交。")
    val noticeReworkMsg = localizedText("Rework requested.", "已退回返工。")

    fun syncDraftFields(value: OutcomeDetail) {
        val rev = value.currentRevisionView ?: return
        if (!showRevisionEditor) {
            goalLines = rev.goal.joinToString("\n")
            criteriaLines = rev.criteria.sortedBy { it.ordinal }.joinToString("\n") { it.statement }
            includedLines = rev.boundaries?.included.orEmpty().joinToString("\n")
            excludedLines = rev.boundaries?.excluded.orEmpty().joinToString("\n")
        }
        if (reviewResults.isEmpty()) {
            reviewResults = rev.criteria.associate { it.id to (it.latestResult ?: "PASS") }
        }
    }

    suspend fun load() {
        if (loading) return
        loading = true
        failure = false
        gateway.outcomeDetail(id).fold(
            onSuccess = {
                detail = it
                syncDraftFields(it)
            },
            onFailure = {
                if ((it as? OutcomeGoRequestException)?.error?.status == 401) {
                    detail = null
                    onAuthenticationRequired(OutcomeLinkTarget(outcomeId = id))
                } else failure = true
            },
        )
        loading = false
    }

    suspend fun loadTranscript(workItemId: String, before: Int? = null) {
        transcriptWorkId = workItemId
        transcriptLoading = true
        gateway.outcomeWorkItemTranscript(id, workItemId, before).fold(
            onSuccess = { transcriptBody = it },
            onFailure = { actionError = it.message ?: errTranscriptMsg },
        )
        transcriptLoading = false
    }

    fun approveRevision(revNum: Int) {
        scope.launch {
            mutating = true; actionError = null; actionNotice = null
            gateway.approveOutcomeRevision(
                id,
                revNum,
                ApproveContractRevisionRequest(
                    expectedRevision = revNum,
                    confirmationText = "Approved on mobile",
                    clientRequestId = UUID.randomUUID().toString(),
                ),
            ).fold(
                onSuccess = { detail = it; actionNotice = noticeApprovedMsg },
                onFailure = { actionError = it.message ?: "Approve failed" },
            )
            mutating = false
        }
    }

    LaunchedEffect(gateway, id) { load() }

    // The brief depends on the saved contract content: a changed description or revision restarts it,
    // and a response for a previous revision is discarded instead of overwriting the new overview.
    val briefSource = detail?.let { d ->
        val rev = d.currentRevisionView
        listOf(d.id, d.title, d.description, rev?.id, rev?.goal, rev?.criteria?.map { it.statement to it.required }, rev?.boundaries, rev?.budget, rev?.conflicts)
    }
    LaunchedEffect(gateway, id, briefSource, briefRetry) {
        val current = detail ?: return@LaunchedEffect
        briefState = OutcomeBriefState(loading = true)
        gateway.outcomeBrief(id).fold(
            onSuccess = { brief ->
                val matches = brief != null && brief.outcomeId == current.id &&
                    brief.revisionId == current.currentRevisionView?.id
                briefState = OutcomeBriefState(loading = false, brief = brief.takeIf { matches }, failed = brief != null && !matches)
            },
            onFailure = { briefState = OutcomeBriefState(loading = false, failed = true) },
        )
    }

    val activeDetail = detail
    if (showExecutionRecords && activeDetail != null) {
        OutcomeExecutionScreen(
            gateway = gateway,
            outcome = activeDetail,
            initialWorkItemId = executionInitialWorkId,
            onBack = { showExecutionRecords = false },
            onAuthenticationRequired = onAuthenticationRequired,
        )
        return
    }

    FeaturePage(
        title = detail?.title ?: localizedText("Outcome", "目标详情"),
        onBack = onBack,
        actions = {
            SpatialIconOrb(
                icon = Icons.Outlined.Refresh,
                contentDescription = localizedText("Refresh", "刷新"),
                onClick = { scope.launch { load() } },
                enabled = !loading && !mutating,
            )
            if (detail?.currentRevision != null) {
                SpatialIconOrb(
                    icon = Icons.Outlined.Edit,
                    contentDescription = localizedText("Edit Contract", "修订契约"),
                    onClick = { showRevisionEditor = !showRevisionEditor },
                    enabled = !mutating,
                )
            }
        },
    ) {
        LazyColumn(
            contentPadding = PaddingValues(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.xs),
            verticalArrangement = Arrangement.spacedBy(SpatialSpacing.sm),
        ) {
            if (loading) item { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            if (failure) item { TextButton(onClick = { scope.launch { load() } }) { Text(localizedText("Could not load outcome. Retry", "无法加载目标，重试")) } }
            actionError?.let { err -> item { Text(err, color = colors.danger, style = MaterialTheme.typography.bodySmall) } }
            actionNotice?.let { msg -> item { Text(msg, color = colors.success, style = MaterialTheme.typography.bodySmall) } }

            detail?.let { value ->
                val criteria = value.currentRevisionView?.criteria.orEmpty().sortedBy { it.ordinal }
                val doneTasks = value.workItems.count { it.status in setOf("completed", "accepted") }
                val passedCriteria = criteria.count { it.latestResult == "PASS" }
                val totalSteps = (value.workItems.size + criteria.size).coerceAtLeast(1)
                val progress = (doneTasks + passedCriteria).toFloat() / totalSteps.toFloat()
                val revNum = value.currentRevision
                val revStatus = value.currentRevisionView?.status
                // While the bot is working on the goal the status is "planning": the owner cannot approve a contract it may be rewriting.
                val canApprove = revNum != null && value.status != "planning" &&
                    (value.status == "pending_approval" || revStatus == "pending_approval" || revStatus == "draft")
                val canStart = revNum != null && (value.status == "approved" || revStatus == "approved") && value.status !in setOf("running", "accepted", "cancelled")
                val canCancel = value.status !in setOf("accepted", "cancelled", "failed")

                // 0. Decision first: a pending plan asks its single question before any status or metrics.
                if (canApprove && revNum != null) {
                    value.currentRevisionView?.let { rev ->
                        item {
                            OutcomeApprovalCard(
                                outcomeId = value.id,
                                revision = rev,
                                intent = briefState.brief?.intent,
                                busy = mutating,
                                onApprove = { approveRevision(revNum) },
                                onRequestChanges = { threadFocus++ },
                            )
                        }
                    }
                }

                // Optional Contract Revision Editor
                if (showRevisionEditor && value.currentRevision != null) {
                    item {
                        OutcomeCard {
                            Text(localizedText("Edit Contract Revision", "发起契约修订"), style = MaterialTheme.typography.titleMedium)
                            SpatialGlassTextField(
                                value = goalLines,
                                onValueChange = { goalLines = it },
                                label = localizedText("Goals (one per line)", "目标条款（每行一条）"),
                                singleLine = false,
                                maxLines = 5,
                            )
                            SpatialGlassTextField(
                                value = criteriaLines,
                                onValueChange = { criteriaLines = it },
                                label = localizedText("Acceptance criteria (one per line)", "验收标准（每行一条）"),
                                singleLine = false,
                                maxLines = 5,
                            )
                            SpatialGlassTextField(
                                value = includedLines,
                                onValueChange = { includedLines = it },
                                label = localizedText("Included scope", "包含范围（每行一条）"),
                                singleLine = false,
                                maxLines = 3,
                            )
                            SpatialGlassTextField(
                                value = excludedLines,
                                onValueChange = { excludedLines = it },
                                label = localizedText("Excluded scope", "排除范围（每行一条）"),
                                singleLine = false,
                                maxLines = 3,
                            )
                            SpatialGlassTextField(
                                value = changeSummary,
                                onValueChange = { changeSummary = it },
                                label = localizedText("Change summary", "修订说明"),
                            )
                            SpatialPrimaryButton(
                                label = localizedText("Submit Revision", "提交修订"),
                                enabled = !mutating && goalLines.isNotBlank() && criteriaLines.isNotBlank(),
                                loading = mutating,
                                onClick = {
                                    scope.launch {
                                        mutating = true; actionError = null; actionNotice = null
                                        val baseRev = value.currentRevision ?: 1
                                        val goals = goalLines.lines().map { it.trim() }.filter { it.isNotEmpty() }
                                        val criteriaInputs = criteriaLines.lines().map { it.trim() }.filter { it.isNotEmpty() }
                                            .map { OutcomeCriterionDraftInput(statement = it, required = true) }
                                        val boundaries = OutcomeBoundaries(
                                            included = includedLines.lines().map { it.trim() }.filter { it.isNotEmpty() },
                                            excluded = excludedLines.lines().map { it.trim() }.filter { it.isNotEmpty() },
                                        )
                                        gateway.reviseOutcome(
                                            id,
                                            CreateContractRevisionRequest(
                                                baseRevision = baseRev,
                                                contract = OutcomeContractDraftInput(
                                                    goal = goals,
                                                    acceptance = criteriaInputs,
                                                    boundaries = boundaries,
                                                    budget = value.currentRevisionView?.budget,
                                                ),
                                                changeSummary = changeSummary.trim().ifBlank { null },
                                                clientRequestId = UUID.randomUUID().toString(),
                                            ),
                                        ).fold(
                                            onSuccess = {
                                                detail = it
                                                showRevisionEditor = false
                                                changeSummary = ""
                                                actionNotice = noticeRevisedMsg
                                            },
                                            onFailure = { actionError = it.message ?: "Revision failed" },
                                        )
                                        mutating = false
                                    }
                                },
                            )
                        }
                    }
                }

                // The goal's own bot thread: the owner's words go to the bot as they are. A pending plan shows it
                // right under the decision; otherwise it follows the status card.
                val threadItem: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
                    item(key = "outcome-thread") {
                        OutcomeThreadPanel(
                            gateway = gateway,
                            outcomeId = value.id,
                            canSend = value.status !in setOf("accepted", "cancelled"),
                            focusRequest = threadFocus,
                            onChanged = { scope.launch { load() } },
                            onAuthenticationRequired = onAuthenticationRequired,
                        )
                    }
                }
                if (canApprove) threadItem()

                // 1. Hero Status, Metrics & Progress Card
                item {
                    OutcomeCard {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                        ) {
                            OutcomeStatusPill(value.status)
                            OutcomeBadgePill(text = "Rev ${value.currentRevision ?: "—"}")
                            Spacer(Modifier.weight(1f))
                            Text(
                                text = formatOutcomeTimestamp(value.updatedAt),
                                style = MaterialTheme.typography.labelSmall,
                                color = colors.textTertiary,
                            )
                        }
                        if (!canApprove) Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                        ) {
                            OutcomeMetricTile(
                                label = localizedText("Tasks", "工作项"),
                                value = "$doneTasks/${value.workItems.size}",
                                icon = Icons.Outlined.Checklist,
                                tint = colors.accent,
                                modifier = Modifier.weight(1f),
                            )
                            OutcomeMetricTile(
                                label = localizedText("Criteria", "验收"),
                                value = "$passedCriteria/${criteria.size}",
                                icon = Icons.Outlined.Verified,
                                tint = colors.success,
                                modifier = Modifier.weight(1f),
                            )
                            OutcomeMetricTile(
                                label = localizedText("Outputs", "产物"),
                                value = value.outputs.size.toString(),
                                icon = Icons.Outlined.Inventory2,
                                tint = colors.warning,
                                modifier = Modifier.weight(1f),
                            )
                        }
                        if (!canApprove) LinearProgressIndicator(
                            progress = { progress.coerceIn(0f, 1f) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(6.dp)
                                .clip(RoundedCornerShape(SpatialRadii.pill)),
                            color = colors.accent,
                            trackColor = colors.glassSubtle,
                        )

                        if (canStart || canCancel) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                            ) {
                                if (canStart && revNum != null) {
                                    SpatialPrimaryButton(
                                        label = localizedText("Start Run", "启动运行"),
                                        enabled = !mutating,
                                        loading = mutating,
                                        modifier = Modifier.weight(1f),
                                        onClick = {
                                            scope.launch {
                                                mutating = true; actionError = null; actionNotice = null
                                                gateway.startOutcomeRun(
                                                    id,
                                                    StartOutcomeRunRequest(expectedRevision = revNum, clientRequestId = UUID.randomUUID().toString()),
                                                ).fold(
                                                    onSuccess = { detail = it; actionNotice = noticeStartedMsg },
                                                    onFailure = { actionError = it.message ?: "Start failed" },
                                                )
                                                mutating = false
                                            }
                                        },
                                    )
                                }
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                        ) {
                            if (canCancel) {
                                SpatialSecondaryButton(
                                    label = localizedText("Cancel", "取消目标"),
                                    enabled = !mutating,
                                    modifier = Modifier.weight(1f),
                                    onClick = {
                                        scope.launch {
                                            mutating = true; actionError = null; actionNotice = null
                                            gateway.cancelOutcome(
                                                id,
                                                CancelOutcomeRequest(clientRequestId = UUID.randomUUID().toString()),
                                            ).fold(
                                                onSuccess = { detail = it; actionNotice = noticeCancelledMsg },
                                                onFailure = { actionError = it.message ?: "Cancel failed" },
                                            )
                                            mutating = false
                                        }
                                    },
                                )
                            }
                            SpatialSecondaryButton(
                                label = localizedText("Execution", "执行记录"),
                                enabled = !mutating,
                                modifier = Modifier.weight(1f),
                                onClick = {
                                    executionInitialWorkId = null
                                    showExecutionRecords = true
                                },
                            )
                        }
                    }
                }

                if (!canApprove) threadItem()

                // 2. Segmented Section Switcher (reduces scrolling & wall-of-text!)
                item {
                    OutcomeSegmentedTabs(
                        tabs = listOf(
                            Icons.Outlined.Assignment to localizedText("Overview", "概览"),
                            Icons.Outlined.Checklist to localizedText("Tasks (${value.workItems.size})", "工作项 (${value.workItems.size})"),
                            Icons.Outlined.Verified to localizedText("Review (${criteria.size})", "产物验收"),
                        ),
                        selectedIndex = section,
                        onSelect = { section = it },
                    )
                }

                when (DetailSection.entries[section]) {
                    DetailSection.Overview -> {
                        // While approval is pending the full contract lives in the approval card's scope.
                        if (!canApprove) value.currentRevisionView?.let { rev ->
                            if (rev.goal.isNotEmpty()) {
                                item {
                                    SpatialGroupedSection(title = localizedText("Goals", "目标条款")) {
                                        rev.goal.forEachIndexed { idx, goalText ->
                                            Row(
                                                modifier = Modifier.padding(horizontal = SpatialSpacing.md, vertical = 12.dp),
                                                verticalAlignment = Alignment.Top,
                                                horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                                            ) {
                                                Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = colors.accent, modifier = Modifier.size(16.dp).padding(top = 2.dp))
                                                Text(goalText, style = MaterialTheme.typography.bodyMedium, color = colors.textPrimary)
                                            }
                                            if (idx < rev.goal.lastIndex) SpatialHairlineDivider()
                                        }
                                    }
                                }
                            }
                            rev.boundaries?.let { b ->
                                if (b.included.isNotEmpty() || b.excluded.isNotEmpty()) {
                                    item {
                                        SpatialGroupedSection(title = localizedText("Scope Boundaries", "范围边界")) {
                                            b.included.forEachIndexed { idx, itemText ->
                                                Row(
                                                    modifier = Modifier.padding(horizontal = SpatialSpacing.md, vertical = 10.dp),
                                                    horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                                                ) {
                                                    OutcomeBadgePill("+", tint = colors.success)
                                                    Text(itemText, style = MaterialTheme.typography.bodySmall, color = colors.textPrimary)
                                                }
                                                if (idx < b.included.lastIndex || b.excluded.isNotEmpty()) SpatialHairlineDivider()
                                            }
                                            b.excluded.forEachIndexed { idx, itemText ->
                                                Row(
                                                    modifier = Modifier.padding(horizontal = SpatialSpacing.md, vertical = 10.dp),
                                                    horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                                                ) {
                                                    OutcomeBadgePill("-", tint = colors.danger)
                                                    Text(itemText, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
                                                }
                                                if (idx < b.excluded.lastIndex) SpatialHairlineDivider()
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        item {
                            OutcomeBriefSections(
                                outcome = value,
                                state = briefState,
                                onRetry = { briefRetry++ },
                            )
                        }
                    }

                    DetailSection.Tasks -> {
                        if (value.workItems.isEmpty()) {
                            item { Text(localizedText("No work items yet.", "暂无工作项。"), color = colors.textSecondary) }
                        }
                        items(value.workItems.sortedBy { it.ordinal }, key = { it.id }) { work ->
                            OutcomeCard {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(24.dp)
                                            .clip(CircleShape)
                                            .background(colors.glassSubtle),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Text("${work.ordinal}", style = MaterialTheme.typography.labelSmall, color = colors.textSecondary)
                                    }
                                    OutcomeStatusPill(work.status)
                                    OutcomeBadgePill(
                                        text = if (work.executorType == "human") localizedText("Human", "人工") else localizedText("Agent", "AI"),
                                        icon = if (work.executorType == "human") Icons.Outlined.Person else Icons.Outlined.SmartToy,
                                    )
                                    Spacer(Modifier.weight(1f))
                                    Text("v${work.contractRevision}", style = MaterialTheme.typography.labelSmall, color = colors.textTertiary)
                                }
                                Text(work.title, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                                work.statusReason?.takeIf { it.isNotBlank() }?.let {
                                    Text(it, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs)) {
                                    if (work.executorType == "human") {
                                        SpatialPrimaryButton(
                                            label = localizedText("Handle Action", "处理人工动作"),
                                            onClick = { onHumanWorkItem(work.id) },
                                            modifier = Modifier.weight(1f),
                                        )
                                    }
                                    SpatialSecondaryButton(
                                        label = localizedText("Execution", "执行记录"),
                                        modifier = Modifier.weight(1f),
                                        onClick = {
                                            executionInitialWorkId = work.id
                                            showExecutionRecords = true
                                        },
                                    )
                                }
                                if (transcriptWorkId == work.id) {
                                    if (transcriptLoading) CircularProgressIndicator(Modifier.size(20.dp))
                                    transcriptBody?.let { body ->
                                        val nextBefore = (body as? JsonObject)?.get("nextBefore")?.jsonPrimitive?.intOrNull
                                        SpatialGlassSurface(
                                            tier = GlassTier.Subtle,
                                            containerColor = colors.codeSurface,
                                            shape = RoundedCornerShape(SpatialRadii.sm),
                                            modifier = Modifier.fillMaxWidth(),
                                        ) {
                                            Column(Modifier.padding(SpatialSpacing.sm), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                                    Icon(Icons.Outlined.Terminal, contentDescription = null, tint = colors.textSecondary, modifier = Modifier.size(14.dp))
                                                    Text(localizedText("Execution Transcript", "执行日志"), style = MaterialTheme.typography.labelSmall, color = colors.textSecondary)
                                                }
                                                Text(
                                                    text = body.toString(),
                                                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                                                    color = colors.textPrimary,
                                                )
                                                if (nextBefore != null) {
                                                    TextButton(onClick = { scope.launch { loadTranscript(work.id, nextBefore) } }) {
                                                        Text(localizedText("Load earlier", "加载更早日志"))
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    DetailSection.Review -> {
                        if (value.outputs.isNotEmpty()) {
                            item {
                                Text(
                                    localizedText("Outputs (${value.outputs.size})", "输出产物 (${value.outputs.size})"),
                                    style = MaterialTheme.typography.labelLarge,
                                    color = colors.textSecondary,
                                )
                            }
                            items(value.outputs, key = { it.id }) { output ->
                                OutcomeCard {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs)) {
                                        Icon(Icons.Outlined.Description, contentDescription = null, tint = colors.accent, modifier = Modifier.size(16.dp))
                                        Text(output.title, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                                    }
                                    output.content?.takeIf { it.isNotBlank() }?.let {
                                        Text(it, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary, maxLines = 6, overflow = TextOverflow.Ellipsis)
                                    }
                                    output.contentRef?.takeIf { it.isNotBlank() }?.let {
                                        OutcomeBadgePill(it)
                                    }
                                }
                            }
                        }

                        item {
                            Text(
                                localizedText("Acceptance Criteria (${criteria.size})", "验收标准 (${criteria.size})"),
                                style = MaterialTheme.typography.labelLarge,
                                color = colors.textSecondary,
                            )
                        }
                        items(criteria, key = { it.id }) { criterion ->
                            OutcomeCard {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                                ) {
                                    OutcomeStatusPill(criterion.latestResult)
                                    OutcomeBadgePill(if (criterion.required) localizedText("Required", "必需") else localizedText("Optional", "可选"))
                                }
                                Text(criterion.statement, style = MaterialTheme.typography.titleSmall, color = colors.textPrimary)
                                value.reviews.filter { it.criterionId == criterion.id && it.contractRevision == value.currentRevision }
                                    .sortedByDescending { it.sequence }.forEach { review ->
                                        Text(
                                            "${review.comment} · ${formatOutcomeTimestamp(review.reviewedAt)}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = colors.textSecondary,
                                        )
                                        value.evidence.filter { it.id in review.evidenceIds }.forEach { evidence ->
                                            OutcomeBadgePill("${evidence.contentSummary} (${evidence.sourceRef})")
                                        }
                                    }
                                if (value.status in setOf("review_pending", "needs_review", "completed")) {
                                    val selectedResult = reviewResults[criterion.id] ?: "PASS"
                                    Row(horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs)) {
                                        listOf("PASS", "FAIL").forEach { res ->
                                            FilterChip(
                                                selected = selectedResult == res,
                                                onClick = { reviewResults = reviewResults + (criterion.id to res) },
                                                shape = RoundedCornerShape(SpatialRadii.pill),
                                                label = { Text(outcomeStatusLabel(res)) },
                                            )
                                        }
                                    }
                                    SpatialGlassTextField(
                                        value = reviewComments[criterion.id].orEmpty(),
                                        onValueChange = { reviewComments = reviewComments + (criterion.id to it) },
                                        label = localizedText("Review comment", "验收评语"),
                                    )
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier.clickable {
                                            reworkSelected = if (criterion.id in reworkSelected) reworkSelected - criterion.id else reworkSelected + criterion.id
                                        },
                                    ) {
                                        Checkbox(
                                            checked = criterion.id in reworkSelected,
                                            onCheckedChange = {
                                                reworkSelected = if (criterion.id in reworkSelected) reworkSelected - criterion.id else reworkSelected + criterion.id
                                            },
                                        )
                                        Text(localizedText("Select for rework", "勾选以退回返工"), style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                        }

                        if (criteria.isNotEmpty() && value.status in setOf("review_pending", "needs_review", "completed")) {
                            item {
                                OutcomeCard {
                                    Text(localizedText("Submit Acceptance or Rework", "提交验收或返工"), style = MaterialTheme.typography.titleMedium)
                                    SpatialPrimaryButton(
                                        label = localizedText("Submit Review", "提交验收评审"),
                                        enabled = !mutating && value.currentRevision != null,
                                        loading = mutating,
                                        onClick = {
                                            scope.launch {
                                                mutating = true; actionError = null; actionNotice = null
                                                val rev = value.currentRevision ?: 1
                                                val inputs = criteria.map { criterion ->
                                                    val criterionEvidence = value.evidence.filter { it.criterionId == criterion.id && it.contractRevision == rev }.map { it.id }
                                                    OutcomeCriterionReviewInput(
                                                        criterionId = criterion.id,
                                                        result = reviewResults[criterion.id] ?: "PASS",
                                                        evidenceIds = criterionEvidence,
                                                        comment = reviewComments[criterion.id].orEmpty(),
                                                        userConfirmed = true,
                                                    )
                                                }
                                                gateway.submitOutcomeReview(
                                                    id,
                                                    SubmitOutcomeReviewRequest(
                                                        expectedRevision = rev,
                                                        results = inputs,
                                                        clientRequestId = UUID.randomUUID().toString(),
                                                    ),
                                                ).fold(
                                                    onSuccess = { detail = it; actionNotice = noticeReviewMsg },
                                                    onFailure = { actionError = it.message ?: "Review failed" },
                                                )
                                                mutating = false
                                            }
                                        },
                                    )
                                    SpatialGlassTextField(
                                        value = reworkComment,
                                        onValueChange = { reworkComment = it },
                                        label = localizedText("Rework reason", "返工说明"),
                                    )
                                    SpatialSecondaryButton(
                                        label = localizedText("Request Rework", "退回返工"),
                                        enabled = !mutating && value.currentRevision != null && reworkSelected.isNotEmpty() && reworkComment.isNotBlank(),
                                        onClick = {
                                            scope.launch {
                                                mutating = true; actionError = null; actionNotice = null
                                                gateway.reworkOutcome(
                                                    id,
                                                    OutcomeReworkRequest(
                                                        criterionIds = reworkSelected.toList(),
                                                        comment = reworkComment.trim(),
                                                        expectedRevision = value.currentRevision ?: 1,
                                                        clientRequestId = UUID.randomUUID().toString(),
                                                    ),
                                                ).fold(
                                                    onSuccess = {
                                                        detail = it
                                                        reworkComment = ""
                                                        reworkSelected = emptySet()
                                                        actionNotice = noticeReworkMsg
                                                    },
                                                    onFailure = { actionError = it.message ?: "Rework failed" },
                                                )
                                                mutating = false
                                            }
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OutcomeCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    SpatialGlassSurface(
        modifier = modifier.fillMaxWidth(),
        tier = GlassTier.Card,
        shape = RoundedCornerShape(SpatialRadii.lg),
    ) {
        Column(Modifier.padding(SpatialSpacing.md), verticalArrangement = Arrangement.spacedBy(SpatialSpacing.xs)) { content() }
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
    "human_action_pending", "waiting_human" -> localizedText("Pending human", "待人工")
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
    "WAIVED_BY_APPROVED_CHANGE" -> localizedText("Waived", "已豁免")
    else -> localizedText("Unknown", "未知")
}
