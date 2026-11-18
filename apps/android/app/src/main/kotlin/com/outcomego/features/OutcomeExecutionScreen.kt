package com.outcomego.features

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.mobile.core.OutcomeDetail
import com.outcomego.mobile.core.OutcomeGoRequestException
import com.outcomego.mobile.core.OutcomeLinkTarget
import com.outcomego.mobile.core.OutcomeTranscriptPage
import com.outcomego.mobile.core.OutcomeTranscriptRow
import com.outcomego.mobile.core.OutcomeWorkItem
import com.outcomego.mobile.core.mobileJson
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

private data class ParsedToolInfo(
    val name: String,
    val command: String? = null,
    val output: String? = null,
    val exitCode: Int? = null,
)

private fun parseToolInfo(content: String, role: String): ParsedToolInfo {
    val fallback = if (role == "file_change") "file_change" else "tool"
    return runCatching {
        val obj = mobileJson.parseToJsonElement(content) as? JsonObject ?: return ParsedToolInfo(fallback)
        val toolName = obj["tool"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: fallback
        ParsedToolInfo(
            name = toolName,
            command = obj["command"]?.jsonPrimitive?.contentOrNull,
            output = obj["output"]?.jsonPrimitive?.contentOrNull,
            exitCode = obj["exit_code"]?.jsonPrimitive?.intOrNull,
        )
    }.getOrElse {
        ParsedToolInfo(name = fallback, output = content.take(200))
    }
}

private fun toolPreviewLine(info: ParsedToolInfo): String {
    val src = info.command ?: info.output ?: ""
    return src.lineSequence().firstOrNull { it.isNotBlank() }?.replace(Regex("\\s+"), " ")?.trim()?.take(160).orEmpty()
}

private fun toolIconFor(role: String, name: String): ImageVector = when {
    role == "file_change" -> Icons.Outlined.Description
    name == "Shell" || role == "command" -> Icons.Outlined.Terminal
    name.startsWith("browser_") -> Icons.Outlined.Public
    else -> Icons.Outlined.Build
}

@Composable
internal fun OutcomeExecutionScreen(
    gateway: FeatureGateway,
    outcome: OutcomeDetail,
    initialWorkItemId: String? = null,
    onBack: () -> Unit,
    onAuthenticationRequired: (OutcomeLinkTarget) -> Unit,
) {
    BackHandler(onBack = onBack)
    val colors = SpatialTheme.colors
    val workItems = remember(outcome.workItems) {
        val agentItems = outcome.workItems.filter { it.executorType == "agent" }.sortedBy { it.ordinal }
        agentItems.ifEmpty { outcome.workItems.sortedBy { it.ordinal } }
    }
    val defaultItem = remember(workItems, initialWorkItemId) {
        workItems.firstOrNull { it.id == initialWorkItemId }
            ?: workItems.firstOrNull { it.status == "running" }
            ?: workItems.lastOrNull()
    }
    var selectedWorkId by remember(outcome.id, initialWorkItemId) { mutableStateOf(defaultItem?.id) }
    var before by remember(selectedWorkId) { mutableStateOf<Int?>(null) }
    var refreshTick by remember { mutableIntStateOf(0) }
    var page by remember(selectedWorkId) { mutableStateOf<OutcomeTranscriptPage?>(null) }
    var loading by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var stickToEnd by remember(selectedWorkId) { mutableStateOf(true) }
    val listState = rememberLazyListState()
    val isAtBottom by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val lastVisible = info.visibleItemsInfo.lastOrNull()?.index ?: 0
            info.totalItemsCount == 0 || lastVisible >= info.totalItemsCount - 2
        }
    }
    LaunchedEffect(isAtBottom, listState.isScrollInProgress) {
        if (listState.isScrollInProgress) {
            stickToEnd = isAtBottom
        }
    }
    val scope = rememberCoroutineScope()
    val loadErr = localizedText("Could not load execution records.", "无法加载执行记录。")

    val currentItem: OutcomeWorkItem? = workItems.firstOrNull { it.id == selectedWorkId } ?: defaultItem
    val isRunning = outcome.status == "running" || currentItem?.status == "running"

    LaunchedEffect(selectedWorkId, before, refreshTick, isRunning) {
        val workId = selectedWorkId ?: return@LaunchedEffect
        while (true) {
            loading = page == null
            errorMsg = null
            gateway.outcomeWorkItemTranscript(outcome.id, workId, before).fold(
                onSuccess = { json ->
                    runCatching {
                        val decoded = mobileJson.decodeFromJsonElement<OutcomeTranscriptPage>(json)
                        decoded.copy(rows = decoded.rows.filter { it.role in setOf("assistant", "tool", "command", "file_change") })
                    }.onSuccess { page = it }
                        .onFailure { errorMsg = loadErr }
                },
                onFailure = { err ->
                    if ((err as? OutcomeGoRequestException)?.error?.status == 401) {
                        onAuthenticationRequired(OutcomeLinkTarget(outcomeId = outcome.id))
                    } else {
                        errorMsg = err.message ?: loadErr
                    }
                },
            )
            loading = false
            if (!isRunning || before != null) break
            delay(5_000)
        }
    }

    val newestId = page?.rows?.lastOrNull()?.id
    val rowCount = page?.rows?.size ?: 0
    LaunchedEffect(selectedWorkId, newestId, rowCount, before) {
        if (before == null && stickToEnd && rowCount > 0) {
            val targetIndex = (listState.layoutInfo.totalItemsCount - 1).coerceAtLeast(0)
            listState.scrollToItem(targetIndex)
        }
    }

    FeaturePage(
        title = localizedText("Execution Records", "执行记录"),
        subtitle = outcome.title,
        onBack = onBack,
        actions = {
            SpatialIconOrb(
                icon = Icons.Outlined.Refresh,
                contentDescription = localizedText("Refresh", "刷新"),
                onClick = { refreshTick++ },
            )
        },
    ) {
        Column(Modifier.fillMaxSize()) {
            if (workItems.size > 1) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.xs),
                    horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                ) {
                    workItems.forEach { item ->
                        FilterChip(
                            selected = item.id == currentItem?.id,
                            onClick = {
                                selectedWorkId = item.id
                                before = null
                                stickToEnd = true
                            },
                            shape = RoundedCornerShape(SpatialRadii.pill),
                            label = { Text("#${item.ordinal} ${item.title}", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        )
                    }
                }
            }

            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.xs),
                verticalArrangement = Arrangement.spacedBy(SpatialSpacing.sm),
            ) {
                page?.let { p ->
                    if (p.next_before != null || before != null) {
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs)) {
                                p.next_before?.let { prev ->
                                    TextButton(onClick = { stickToEnd = false; before = prev }) {
                                        Text(localizedText("Earlier messages", "更早记录"))
                                    }
                                }
                                if (before != null) {
                                    TextButton(onClick = { stickToEnd = true; before = null }) {
                                        Text(localizedText("Latest messages", "最新记录"))
                                    }
                                }
                            }
                        }
                    }
                }

                if (loading) {
                    item { Box(Modifier.fillMaxWidth().padding(SpatialSpacing.md), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
                }
                errorMsg?.let { err ->
                    item {
                        SpatialGlassSurface(Modifier.fillMaxWidth(), tier = GlassTier.Subtle, shape = RoundedCornerShape(SpatialRadii.md)) {
                            Row(Modifier.padding(SpatialSpacing.md), verticalAlignment = Alignment.CenterVertically) {
                                Text(err, color = colors.danger, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                                TextButton(onClick = { refreshTick++ }) { Text(localizedText("Retry", "重试")) }
                            }
                        }
                    }
                }
                if (currentItem == null || (!loading && page?.rows?.isEmpty() == true && errorMsg == null)) {
                    item {
                        SpatialGlassSurface(Modifier.fillMaxWidth(), tier = GlassTier.Subtle, shape = RoundedCornerShape(SpatialRadii.lg)) {
                            Text(
                                text = localizedText("No visible execution records yet.", "暂无可展示的执行记录。"),
                                style = MaterialTheme.typography.bodyMedium,
                                color = colors.textSecondary,
                                modifier = Modifier.padding(SpatialSpacing.lg),
                            )
                        }
                    }
                }

                items(page?.rows.orEmpty(), key = { it.id }) { row ->
                    ExecutionRowCard(row)
                }
            }

            SpatialGlassSurface(
                tier = GlassTier.Subtle,
                shape = RoundedCornerShape(topStart = SpatialRadii.md, topEnd = SpatialRadii.md),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = SpatialSpacing.md, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                ) {
                    Icon(Icons.Outlined.Lock, contentDescription = null, tint = colors.textTertiary, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.size(6.dp))
                    Text(
                        text = localizedText("This execution log is read-only", "此执行记录仅支持只读查看"),
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.textTertiary,
                    )
                }
            }
        }
    }
}

@Composable
private fun ExecutionRowCard(row: OutcomeTranscriptRow) {
    val colors = SpatialTheme.colors
    var expanded by remember(row.id) { mutableStateOf(false) }

    if (row.role == "assistant") {
        SpatialGlassSurface(
            tier = GlassTier.Card,
            shape = RoundedCornerShape(SpatialRadii.lg),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(SpatialSpacing.md), verticalArrangement = Arrangement.spacedBy(SpatialSpacing.xs)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(Icons.Outlined.SmartToy, contentDescription = null, tint = colors.accent, modifier = Modifier.size(15.dp))
                    Text("Bot", style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                    OutcomeStatusPill(row.status)
                    Spacer(Modifier.weight(1f))
                    Text(formatOutcomeTimestamp(row.at), style = MaterialTheme.typography.labelSmall, color = colors.textTertiary)
                }
                Text(
                    text = row.content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textPrimary,
                )
            }
        }
        return
    }

    val info = remember(row.id, row.content) { parseToolInfo(row.content, row.role) }
    val preview = remember(info) { toolPreviewLine(info) }
    val failed = row.status == "failed" || (info.exitCode ?: 0) != 0
    val icon = toolIconFor(row.role, info.name)
    val label = if (row.role == "file_change") localizedText("File change", "文件变更") else info.name

    SpatialGlassSurface(
        tier = GlassTier.Subtle,
        shape = RoundedCornerShape(SpatialRadii.md),
        modifier = Modifier
            .fillMaxWidth()
            .clickable { expanded = !expanded },
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = if (failed) colors.danger else colors.textSecondary,
                    modifier = Modifier.size(15.dp),
                )
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = if (failed) colors.danger else colors.textPrimary,
                )
                if (preview.isNotBlank()) {
                    Text(
                        text = preview,
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        color = colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                } else {
                    Spacer(Modifier.weight(1f))
                }
                if (failed) {
                    Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = colors.danger, modifier = Modifier.size(14.dp))
                }
                Text(formatOutcomeTimestamp(row.at), style = MaterialTheme.typography.labelSmall, color = colors.textTertiary)
                Icon(
                    imageVector = if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                    contentDescription = null,
                    tint = colors.textTertiary,
                    modifier = Modifier.size(16.dp),
                )
            }
            if (expanded) {
                SpatialGlassSurface(
                    tier = GlassTier.Subtle,
                    containerColor = colors.codeSurface,
                    shape = RoundedCornerShape(SpatialRadii.xs),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    val detailsText = buildString {
                        info.command?.let { append("$ ").appendLine(it) }
                        info.exitCode?.let { append("exit ").appendLine(it) }
                        info.output?.let { append(it) }
                        if (isEmpty()) append(localizedText("Private tool details are omitted.", "工具详细参数已脱敏。"))
                    }
                    Text(
                        text = detailsText,
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        color = colors.textPrimary,
                        modifier = Modifier.padding(10.dp),
                    )
                }
            }
        }
    }
}
