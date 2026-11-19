package com.outcomego.features

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.RocketLaunch
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.TrackChanges
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialGlassTextField
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialPrimaryButton
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSecondaryButton
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.mobile.core.CreateExploreIdeaRequest
import com.outcomego.mobile.core.DiscardExploreIdeaRequest
import com.outcomego.mobile.core.ExploreIdea
import com.outcomego.mobile.core.ExploreIdeaPage
import com.outcomego.mobile.core.OutcomeGoRequestException
import com.outcomego.mobile.core.OutcomeInboxItem
import com.outcomego.mobile.core.OutcomeInboxPage
import com.outcomego.mobile.core.OutcomeLinkTarget
import com.outcomego.mobile.core.OutcomeListPage
import com.outcomego.mobile.core.OutcomePlanningDraft
import com.outcomego.mobile.core.ProposeExploreIdeaRequest
import kotlinx.coroutines.launch
import java.util.UUID

data class OutcomeBotOption(val id: String, val name: String)

private enum class WorkspaceTab { All, Inbox, Explore }

private sealed interface WorkspaceRoute {
    data object Root : WorkspaceRoute
    data class NewPlan(val initialPlan: OutcomePlanningDraft? = null) : WorkspaceRoute
    data class Outcome(val id: String) : WorkspaceRoute
    data class Decision(val id: String) : WorkspaceRoute
    data class HumanAction(val id: String) : WorkspaceRoute
}

@Composable
fun OutcomeWorkspaceScreen(
    gateway: FeatureGateway,
    bots: List<OutcomeBotOption>,
    initialTarget: OutcomeLinkTarget? = null,
    onBack: () -> Unit,
    onUnsupported: () -> Unit,
    onAuthenticationRequired: (OutcomeLinkTarget) -> Unit,
) {
    var route by remember(gateway, initialTarget) {
        mutableStateOf<WorkspaceRoute>(
            initialTarget?.decisionId?.let { WorkspaceRoute.Decision(it) }
                ?: initialTarget?.outcomeId?.let { WorkspaceRoute.Outcome(it) }
                ?: WorkspaceRoute.Root,
        )
    }
    var activeTab by rememberSaveable { mutableStateOf(WorkspaceTab.All) }
    var refreshVersion by remember { mutableIntStateOf(0) }

    val current = route
    if (current != WorkspaceRoute.Root) {
        BackHandler {
            refreshVersion++
            route = WorkspaceRoute.Root
        }
        when (current) {
            is WorkspaceRoute.NewPlan -> OutcomePlanningScreen(
                gateway = gateway,
                bots = bots,
                initialDraft = current.initialPlan,
                onBack = {
                    refreshVersion++
                    route = WorkspaceRoute.Root
                },
                onCreated = { created ->
                    refreshVersion++
                    route = WorkspaceRoute.Outcome(created.id)
                },
                onAuthenticationRequired = onAuthenticationRequired,
            )
            is WorkspaceRoute.Outcome -> OutcomeDetailScreen(
                gateway = gateway,
                id = current.id,
                onBack = {
                    refreshVersion++
                    route = WorkspaceRoute.Root
                },
                onHumanWorkItem = { workId -> route = WorkspaceRoute.HumanAction(workId) },
                onAuthenticationRequired = onAuthenticationRequired,
            )
            is WorkspaceRoute.Decision -> OutcomeDecisionScreen(
                gateway = gateway,
                id = current.id,
                onBack = {
                    refreshVersion++
                    route = WorkspaceRoute.Root
                },
                onOutcome = { outcomeId -> route = WorkspaceRoute.Outcome(outcomeId) },
                onAuthenticationRequired = onAuthenticationRequired,
            )
            is WorkspaceRoute.HumanAction -> OutcomeHumanActionScreen(
                gateway = gateway,
                id = current.id,
                onBack = {
                    refreshVersion++
                    route = WorkspaceRoute.Root
                },
                onAuthenticationRequired = onAuthenticationRequired,
            )
            WorkspaceRoute.Root -> Unit
        }
        return
    }

    val haptic = LocalAppHaptics.current
    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(onBack, haptic) {
                val trigger = 72.dp.toPx()
                var total = 0f
                var fired = false
                detectHorizontalDragGestures(onDragStart = { total = 0f; fired = false }) { _, delta ->
                    total += delta
                    if (!fired && total >= trigger) {
                        fired = true
                        haptic.play(HapticEffect.Medium)
                        onBack()
                    }
                }
            },
    ) {
        FeaturePage(
            title = localizedText("Outcomes", "成果工作台"),
            onBack = onBack,
            actions = {
                SpatialIconOrb(
                    icon = Icons.Outlined.Refresh,
                    contentDescription = localizedText("Refresh", "刷新"),
                    onClick = { refreshVersion++ },
                )
                SpatialIconOrb(
                    icon = Icons.Outlined.Add,
                    contentDescription = localizedText("New Outcome", "新建目标"),
                    onClick = { route = WorkspaceRoute.NewPlan() },
                )
            },
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                OutcomeSegmentedTabs(
                    tabs = listOf(
                        Icons.Outlined.TrackChanges to localizedText("All", "全部"),
                        Icons.Outlined.NotificationsActive to localizedText("Inbox", "待处理"),
                        Icons.Outlined.Lightbulb to localizedText("Explore", "探索"),
                    ),
                    selectedIndex = activeTab.ordinal,
                    onSelect = { activeTab = WorkspaceTab.entries[it] },
                    modifier = Modifier.padding(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.xs),
                )
                when (activeTab) {
                    WorkspaceTab.All -> AllGoalsTab(
                        gateway = gateway,
                        bots = bots,
                        refreshVersion = refreshVersion,
                        onOpenOutcome = { route = WorkspaceRoute.Outcome(it) },
                        onCreateNew = { route = WorkspaceRoute.NewPlan() },
                        onUnsupported = onUnsupported,
                        onAuthenticationRequired = onAuthenticationRequired,
                    )
                    WorkspaceTab.Inbox -> NeedsAttentionTab(
                        gateway = gateway,
                        refreshVersion = refreshVersion,
                        onSelectItem = { item ->
                            route = when (item.category) {
                                "decision_pending" -> item.decisionId?.let { WorkspaceRoute.Decision(it) }
                                    ?: WorkspaceRoute.Outcome(item.outcomeId)
                                "human_action_pending" -> item.workItemId?.let { WorkspaceRoute.HumanAction(it) }
                                    ?: WorkspaceRoute.Outcome(item.outcomeId)
                                else -> WorkspaceRoute.Outcome(item.outcomeId)
                            }
                        },
                        onAuthenticationRequired = onAuthenticationRequired,
                    )
                    WorkspaceTab.Explore -> ExploreIdeasTab(
                        gateway = gateway,
                        bots = bots,
                        refreshVersion = refreshVersion,
                        onOpenPlan = { plan -> route = WorkspaceRoute.NewPlan(plan) },
                        onOpenOutcome = { id -> route = WorkspaceRoute.Outcome(id) },
                        onAuthenticationRequired = onAuthenticationRequired,
                    )
                }
            }
        }
    }
}

@Composable
private fun AllGoalsTab(
    gateway: FeatureGateway,
    bots: List<OutcomeBotOption>,
    refreshVersion: Int,
    onOpenOutcome: (String) -> Unit,
    onCreateNew: () -> Unit,
    onUnsupported: () -> Unit,
    onAuthenticationRequired: (OutcomeLinkTarget) -> Unit,
) {
    val colors = SpatialTheme.colors
    var page by remember(gateway) { mutableStateOf<OutcomeListPage?>(null) }
    var statusFilter by rememberSaveable { mutableStateOf<String?>(null) }
    var queryText by rememberSaveable { mutableStateOf("") }
    var loading by remember(gateway) { mutableStateOf(false) }
    var failure by remember(gateway) { mutableStateOf(false) }
    var failedMore by remember(gateway) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val botNames = remember(bots) { bots.associate { it.id to it.name } }

    suspend fun load(more: Boolean = false) {
        if (loading) return
        loading = true
        failure = false
        failedMore = more
        val cursor = if (more) page?.nextCursor else null
        gateway.listOutcomes(cursor = cursor, status = statusFilter, query = queryText.trim().ifBlank { null }).fold(
            onSuccess = { next ->
                if (next == null) onUnsupported()
                else page = if (more) next.copy(items = (page?.items.orEmpty() + next.items).distinctBy { it.id }) else next
            },
            onFailure = {
                if ((it as? OutcomeGoRequestException)?.error?.status == 401) {
                    page = null
                    onAuthenticationRequired(OutcomeLinkTarget())
                } else {
                    failure = true
                }
            },
        )
        loading = false
    }

    LaunchedEffect(gateway, statusFilter, refreshVersion) { load() }

    val itemsList = page?.items.orEmpty()
    val runningCount = remember(itemsList) { itemsList.count { it.status in setOf("planning", "running", "queued") } }
    val attentionCount = remember(itemsList) {
        itemsList.count {
            it.status in setOf("pending_approval", "review_pending", "needs_review", "decision_pending", "waiting_decision", "human_action_pending", "waiting_human")
        }
    }
    val acceptedCount = remember(itemsList) { itemsList.count { it.status == "accepted" || it.status == "completed" } }

    LazyColumn(
        contentPadding = PaddingValues(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.xs),
        verticalArrangement = Arrangement.spacedBy(SpatialSpacing.sm),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
            ) {
                OutcomeMetricTile(
                    label = localizedText("Running", "运行中"),
                    value = runningCount.toString(),
                    icon = Icons.Outlined.PlayCircle,
                    tint = colors.accent,
                    modifier = Modifier.weight(1f),
                )
                OutcomeMetricTile(
                    label = localizedText("Attention", "待处理"),
                    value = attentionCount.toString(),
                    icon = Icons.Outlined.HourglassEmpty,
                    tint = colors.warning,
                    modifier = Modifier.weight(1f),
                )
                OutcomeMetricTile(
                    label = localizedText("Accepted", "已验收"),
                    value = acceptedCount.toString(),
                    icon = Icons.Outlined.CheckCircle,
                    tint = colors.success,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        item {
            SpatialGlassTextField(
                value = queryText,
                onValueChange = { queryText = it },
                placeholder = localizedText("Search outcomes...", "搜索目标..."),
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null, tint = colors.textSecondary) },
                trailingIcon = if (queryText.isNotEmpty()) {
                    {
                        IconButton(onClick = { queryText = ""; scope.launch { load() } }) {
                            Icon(Icons.Outlined.Close, contentDescription = null, tint = colors.textSecondary)
                        }
                    }
                } else null,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { scope.launch { load() } }),
            )
        }
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
            ) {
                listOf(
                    null to localizedText("All", "全部"),
                    "pending_approval" to localizedText("Approval", "待批准"),
                    "running" to localizedText("Running", "执行中"),
                    "review_pending" to localizedText("Review", "待验收"),
                    "accepted" to localizedText("Accepted", "已验收"),
                    "cancelled" to localizedText("Cancelled", "已取消"),
                ).forEach { (value, label) ->
                    FilterChip(
                        selected = statusFilter == value,
                        onClick = { if (statusFilter != value) { page = null; statusFilter = value } },
                        shape = RoundedCornerShape(SpatialRadii.pill),
                        label = { Text(label, style = MaterialTheme.typography.labelMedium) },
                    )
                }
            }
        }
        items(itemsList, key = { it.id }) { outcome ->
            SpatialGlassSurface(
                tier = GlassTier.Card,
                shape = RoundedCornerShape(SpatialRadii.lg),
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOpenOutcome(outcome.id) },
            ) {
                Column(
                    modifier = Modifier.padding(SpatialSpacing.md),
                    verticalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                    ) {
                        OutcomeStatusPill(outcome.status)
                        OutcomeBadgePill(text = "v${outcome.currentRevision ?: 0}")
                        Spacer(Modifier.weight(1f))
                        Text(
                            text = formatOutcomeTimestamp(outcome.updatedAt),
                            style = MaterialTheme.typography.labelSmall,
                            color = colors.textTertiary,
                        )
                    }
                    Text(
                        text = outcome.title,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = colors.textPrimary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutcomeBadgePill(
                            text = botNames[outcome.botId] ?: outcome.botId.take(8),
                            icon = Icons.Outlined.SmartToy,
                        )
                        Spacer(Modifier.weight(1f))
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = null,
                            tint = colors.textTertiary,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }
        }
        if (itemsList.isEmpty() && !loading && !failure) {
            item {
                SpatialGlassSurface(Modifier.fillMaxWidth(), tier = GlassTier.Subtle, shape = RoundedCornerShape(SpatialRadii.lg)) {
                    Column(
                        modifier = Modifier.padding(SpatialSpacing.lg),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(SpatialSpacing.sm),
                    ) {
                        Text(
                            text = localizedText("No outcomes yet", "暂无目标"),
                            style = MaterialTheme.typography.titleSmall,
                            color = colors.textSecondary,
                        )
                        SpatialPrimaryButton(
                            label = localizedText("New Outcome", "新建目标"),
                            onClick = onCreateNew,
                        )
                    }
                }
            }
        }
        if (loading) item { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
        if (failure) {
            item {
                TextButton(onClick = { scope.launch { load(failedMore) } }) {
                    Text(localizedText("Could not load outcomes. Retry", "无法加载目标，重试"))
                }
            }
        }
        if (page?.nextCursor != null && !failure) {
            item {
                SpatialSecondaryButton(
                    label = localizedText("Load more", "加载更多"),
                    onClick = { scope.launch { load(true) } },
                    enabled = !loading,
                )
            }
        }
    }
}

@Composable
private fun NeedsAttentionTab(
    gateway: FeatureGateway,
    refreshVersion: Int,
    onSelectItem: (OutcomeInboxItem) -> Unit,
    onAuthenticationRequired: (OutcomeLinkTarget) -> Unit,
) {
    val colors = SpatialTheme.colors
    var page by remember(gateway) { mutableStateOf<OutcomeInboxPage?>(null) }
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    var loading by remember(gateway) { mutableStateOf(false) }
    var unavailable by remember(gateway) { mutableStateOf(false) }
    var failure by remember(gateway) { mutableStateOf(false) }
    var failedMore by remember(gateway) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun load(more: Boolean = false) {
        if (loading) return
        loading = true
        failure = false
        failedMore = more
        try {
            gateway.outcomeInbox(category, if (more) page?.nextCursor else null).fold(
                onSuccess = { next ->
                    unavailable = next == null
                    if (next != null) page = if (more) next.copy(items = (page?.items.orEmpty() + next.items).distinctBy { it.id }) else next
                },
                onFailure = {
                    if ((it as? OutcomeGoRequestException)?.error?.status == 401) {
                        page = null
                        onAuthenticationRequired(OutcomeLinkTarget())
                    } else failure = true
                },
            )
        } finally {
            loading = false
        }
    }

    LaunchedEffect(gateway, category, refreshVersion) { load() }

    LazyColumn(
        contentPadding = PaddingValues(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.xs),
        verticalArrangement = Arrangement.spacedBy(SpatialSpacing.sm),
    ) {
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
            ) {
                listOf(null, "decision_pending", "acceptance_pending", "human_action_pending", "completed").forEach { value ->
                    FilterChip(
                        selected = category == value,
                        onClick = { if (category != value) { page = null; category = value } },
                        enabled = !loading,
                        shape = RoundedCornerShape(SpatialRadii.pill),
                        label = { Text(outcomeCategoryLabel(value), style = MaterialTheme.typography.labelMedium) },
                    )
                }
            }
        }
        if (loading) item { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
        if (unavailable) item { Text(localizedText("Outcome Inbox is unavailable on this server.", "此服务器不支持成果收件箱。")) }
        if (failure) {
            item {
                TextButton(onClick = { scope.launch { load(failedMore) } }) {
                    Text(localizedText("Could not load items. Retry", "无法加载事项，重试"))
                }
            }
        }
        if (page?.items?.isEmpty() == true && !loading && !unavailable) {
            item {
                SpatialGlassSurface(Modifier.fillMaxWidth(), tier = GlassTier.Subtle, shape = RoundedCornerShape(SpatialRadii.lg)) {
                    Text(
                        text = localizedText("All caught up — nothing needs attention.", "暂无待处理事项。"),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textSecondary,
                        modifier = Modifier.padding(SpatialSpacing.lg),
                    )
                }
            }
        }
        items(page?.items.orEmpty(), key = { it.id }) { item ->
            SpatialGlassSurface(
                tier = GlassTier.Card,
                shape = RoundedCornerShape(SpatialRadii.lg),
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onSelectItem(item) },
            ) {
                Column(Modifier.padding(SpatialSpacing.md), verticalArrangement = Arrangement.spacedBy(SpatialSpacing.xs)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                    ) {
                        OutcomeStatusPill(item.category)
                        Spacer(Modifier.weight(1f))
                        Text(
                            text = formatOutcomeTimestamp(item.createdAt),
                            style = MaterialTheme.typography.labelSmall,
                            color = colors.textTertiary,
                        )
                    }
                    Text(
                        text = item.title,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = colors.textPrimary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (item.next.isNotBlank()) {
                        Text(
                            text = item.next,
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textSecondary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (item.problem.isNotBlank()) {
                        Text(
                            text = item.problem,
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.warning,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
        if (page?.nextCursor != null && !failure) {
            item {
                SpatialSecondaryButton(
                    label = localizedText("Load more", "加载更多"),
                    onClick = { scope.launch { load(true) } },
                    enabled = !loading,
                )
            }
        }
    }
}

@Composable
private fun ExploreIdeasTab(
    gateway: FeatureGateway,
    bots: List<OutcomeBotOption>,
    refreshVersion: Int,
    onOpenPlan: (OutcomePlanningDraft) -> Unit,
    onOpenOutcome: (String) -> Unit,
    onAuthenticationRequired: (OutcomeLinkTarget) -> Unit,
) {
    val colors = SpatialTheme.colors
    var page by remember(gateway) { mutableStateOf<ExploreIdeaPage?>(null) }
    var loading by remember(gateway) { mutableStateOf(false) }
    var mutatingId by remember { mutableStateOf<String?>(null) }
    var unavailable by remember(gateway) { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var showCreate by rememberSaveable { mutableStateOf(false) }
    var newTitle by rememberSaveable { mutableStateOf("") }
    var newNote by rememberSaveable { mutableStateOf("") }
    var selectedBotId by rememberSaveable { mutableStateOf(bots.firstOrNull()?.id.orEmpty()) }
    val scope = rememberCoroutineScope()
    val loadExploreFailedMsg = localizedText("Could not load Explore ideas.", "无法加载探索想法。")

    LaunchedEffect(bots) {
        if (selectedBotId.isBlank() && bots.isNotEmpty()) selectedBotId = bots.first().id
    }

    suspend fun load(more: Boolean = false) {
        if (loading) return
        loading = true
        errorMessage = null
        gateway.listExploreIdeas(if (more) page?.nextCursor else null).fold(
            onSuccess = { next ->
                unavailable = next == null
                if (next != null) page = if (more) next.copy(items = (page?.items.orEmpty() + next.items).distinctBy { it.id }) else next
            },
            onFailure = {
                if ((it as? OutcomeGoRequestException)?.error?.status == 401) {
                    onAuthenticationRequired(OutcomeLinkTarget())
                } else {
                    errorMessage = it.message ?: loadExploreFailedMsg
                }
            },
        )
        loading = false
    }

    LaunchedEffect(gateway, refreshVersion) { load() }

    LazyColumn(
        contentPadding = PaddingValues(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.xs),
        verticalArrangement = Arrangement.spacedBy(SpatialSpacing.sm),
    ) {
        if (!unavailable) {
            item {
                SpatialSecondaryButton(
                    label = if (showCreate) localizedText("Close", "收起") else localizedText("+ New Idea", "+ 新建想法"),
                    onClick = { showCreate = !showCreate },
                )
            }
        }
        if (showCreate) {
            item {
                SpatialGlassSurface(Modifier.fillMaxWidth(), tier = GlassTier.Card, shape = RoundedCornerShape(SpatialRadii.lg)) {
                    Column(Modifier.padding(SpatialSpacing.md), verticalArrangement = Arrangement.spacedBy(SpatialSpacing.sm)) {
                        SpatialGlassTextField(
                            value = newTitle,
                            onValueChange = { newTitle = it },
                            label = localizedText("Title", "想法标题"),
                        )
                        SpatialGlassTextField(
                            value = newNote,
                            onValueChange = { newNote = it },
                            label = localizedText("Notes", "补充说明"),
                            singleLine = false,
                            maxLines = 4,
                        )
                        if (bots.isNotEmpty()) {
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs)) {
                                bots.forEach { bot ->
                                    FilterChip(
                                        selected = selectedBotId == bot.id,
                                        onClick = { selectedBotId = bot.id },
                                        shape = RoundedCornerShape(SpatialRadii.pill),
                                        label = { Text(bot.name) },
                                    )
                                }
                            }
                        }
                        SpatialPrimaryButton(
                            label = localizedText("Save Idea", "保存想法"),
                            enabled = newTitle.isNotBlank() && mutatingId == null,
                            loading = mutatingId == "create",
                            onClick = {
                                scope.launch {
                                    mutatingId = "create"
                                    errorMessage = null
                                    gateway.createExploreIdea(
                                        CreateExploreIdeaRequest(
                                            title = newTitle.trim(),
                                            note = newNote.trim().ifBlank { null },
                                            botId = selectedBotId.ifBlank { null },
                                            status = "draft",
                                            clientRequestId = UUID.randomUUID().toString(),
                                        ),
                                    ).fold(
                                        onSuccess = {
                                            newTitle = ""
                                            newNote = ""
                                            showCreate = false
                                            load()
                                        },
                                        onFailure = { errorMessage = it.message ?: "Failed" },
                                    )
                                    mutatingId = null
                                }
                            },
                        )
                    }
                }
            }
        }
        if (loading) item { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
        if (unavailable) {
            item { Text(localizedText("Explore is not enabled on this server.", "当前服务器未启用探索想法功能。"), color = colors.textSecondary) }
        }
        errorMessage?.let { msg -> item { Text(msg, color = colors.danger) } }
        if (page?.items?.isEmpty() == true && !loading && !unavailable) {
            item { Text(localizedText("No ideas yet.", "暂无探索想法。"), color = colors.textSecondary) }
        }
        items(page?.items.orEmpty(), key = { it.id }) { idea ->
            ExploreIdeaCard(
                idea = idea,
                bots = bots,
                busy = mutatingId == idea.id,
                onPropose = { botId ->
                    scope.launch {
                        mutatingId = idea.id
                        errorMessage = null
                        gateway.proposeExploreIdea(
                            idea.id,
                            ProposeExploreIdeaRequest(
                                botId = botId,
                                clientRequestId = UUID.randomUUID().toString(),
                            ),
                        ).fold(
                            onSuccess = { proposal ->
                                load()
                                onOpenPlan(proposal.plan)
                            },
                            onFailure = { errorMessage = it.message ?: "Failed to propose" },
                        )
                        mutatingId = null
                    }
                },
                onDiscard = {
                    scope.launch {
                        mutatingId = idea.id
                        errorMessage = null
                        gateway.discardExploreIdea(
                            idea.id,
                            DiscardExploreIdeaRequest(clientRequestId = UUID.randomUUID().toString()),
                        ).fold(
                            onSuccess = { load() },
                            onFailure = { errorMessage = it.message ?: "Failed to discard" },
                        )
                        mutatingId = null
                    }
                },
                onOpenOutcome = onOpenOutcome,
            )
        }
        if (page?.nextCursor != null) {
            item {
                SpatialSecondaryButton(
                    label = localizedText("Load more", "加载更多"),
                    onClick = { scope.launch { load(true) } },
                    enabled = !loading,
                )
            }
        }
    }
}

@Composable
private fun ExploreIdeaCard(
    idea: ExploreIdea,
    bots: List<OutcomeBotOption>,
    busy: Boolean,
    onPropose: (String?) -> Unit,
    onDiscard: () -> Unit,
    onOpenOutcome: (String) -> Unit,
) {
    val colors = SpatialTheme.colors
    SpatialGlassSurface(Modifier.fillMaxWidth(), tier = GlassTier.Card, shape = RoundedCornerShape(SpatialRadii.lg)) {
        Column(Modifier.padding(SpatialSpacing.md), verticalArrangement = Arrangement.spacedBy(SpatialSpacing.xs)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutcomeStatusPill(idea.status)
                Spacer(Modifier.weight(1f))
                Text(formatOutcomeTimestamp(idea.updatedAt), style = MaterialTheme.typography.labelSmall, color = colors.textTertiary)
            }
            Text(idea.title, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
            if (idea.note.isNotBlank()) {
                Text(idea.note, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val targetBot = idea.botId ?: bots.firstOrNull()?.id
                if (idea.status in setOf("draft", "exploring")) {
                    SpatialPrimaryButton(
                        label = localizedText("Propose", "生成提案"),
                        enabled = !busy && targetBot != null,
                        loading = busy,
                        onClick = { onPropose(targetBot) },
                        modifier = Modifier.weight(1f),
                    )
                    SpatialIconOrb(
                        icon = Icons.Outlined.DeleteOutline,
                        contentDescription = localizedText("Discard", "丢弃"),
                        enabled = !busy,
                        tint = colors.danger,
                        onClick = onDiscard,
                    )
                }
                idea.proposedOutcomeId?.let { outcomeId ->
                    SpatialSecondaryButton(
                        label = localizedText("View Outcome", "查看目标"),
                        onClick = { onOpenOutcome(outcomeId) },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}
