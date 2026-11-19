package com.outcomego.features

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialGroupedSection
import com.outcomego.android.ui.designsystem.SpatialHairlineDivider
import com.outcomego.android.ui.designsystem.SpatialPrimaryButton
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSecondaryButton
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.mobile.core.OutcomeBrief
import com.outcomego.mobile.core.OutcomeBriefItem
import com.outcomego.mobile.core.OutcomeContractRevision
import com.outcomego.mobile.core.OutcomeDetail

/**
 * Brief lifecycle for the detail page. The brief is advisory: it never supplies approval,
 * readiness, task status or decision authority, so a missing brief only removes the summaries.
 */
internal data class OutcomeBriefState(
    val loading: Boolean = true,
    val brief: OutcomeBrief? = null,
    val failed: Boolean = false,
)

private enum class Readiness { Met, Unmet, Unknown }

private data class OutcomeCondition(
    val title: String,
    val status: Readiness,
    val explanation: String,
    val quote: String? = null,
)

// ---------------------------------------------------------------------------------------------
// Level 1: what needs the user right now
// ---------------------------------------------------------------------------------------------

/** First thing on a pending plan: one question, one sentence of context, the decision buttons. */
@Composable
internal fun OutcomeApprovalCard(
    outcomeId: String,
    revision: OutcomeContractRevision,
    intent: OutcomeBriefItem?,
    busy: Boolean,
    onApprove: () -> Unit,
    onRequestChanges: () -> Unit,
) {
    val colors = SpatialTheme.colors
    var scopeOpen by rememberSaveable(outcomeId, revision.revision) { mutableStateOf(false) }
    val criteria = revision.criteria.sortedBy { it.ordinal }
    val included = revision.boundaries?.included.orEmpty()
    val excluded = revision.boundaries?.excluded.orEmpty()

    SpatialGlassSurface(
        modifier = Modifier.fillMaxWidth(),
        tier = GlassTier.Card,
        shape = RoundedCornerShape(SpatialRadii.lg),
    ) {
        Column(
            modifier = Modifier.padding(SpatialSpacing.md),
            verticalArrangement = Arrangement.spacedBy(SpatialSpacing.sm),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(colors.accent))
                Text(
                    text = localizedText("Needs you now", "现在需要你"),
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = colors.accent,
                )
            }
            Text(
                text = localizedText("Approve this plan?", "批准这个计划？"),
                style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                color = colors.textPrimary,
            )
            Text(
                text = intent?.title?.takeIf { it.isNotBlank() }
                    ?: localizedText(
                        "Check the proposed scope before execution starts.",
                        "开始执行前，请先确认拟定的范围。",
                    ),
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textSecondary,
            )

            // Approval scope: collapsed to one line of counts; the full saved contract is one tap away.
            SpatialGlassSurface(
                tier = GlassTier.Subtle,
                shape = RoundedCornerShape(SpatialRadii.md),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column {
                    DisclosureHeader(
                        icon = Icons.Outlined.Checklist,
                        tint = colors.accent,
                        label = localizedText("Approval scope", "批准范围"),
                        preview = localizedText(
                            "${revision.goal.size} goals · ${criteria.size} criteria · ${included.size + excluded.size} boundaries",
                            "${revision.goal.size} 条目标 · ${criteria.size} 项验收 · ${included.size + excluded.size} 条边界",
                        ),
                        expanded = scopeOpen,
                        onToggle = { scopeOpen = !scopeOpen },
                    )
                    DisclosureBody(visible = scopeOpen) {
                        Column(
                            modifier = Modifier.padding(start = 14.dp, end = 14.dp, bottom = 14.dp),
                            verticalArrangement = Arrangement.spacedBy(SpatialSpacing.sm),
                        ) {
                            ScopeGroup(localizedText("Goals", "目标")) {
                                revision.goal.forEach { BulletLine(it, colors.accent) }
                            }
                            if (criteria.isNotEmpty()) {
                                ScopeGroup(localizedText("Acceptance", "验收标准")) {
                                    criteria.forEach { criterion ->
                                        Row(
                                            horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                                            verticalAlignment = Alignment.Top,
                                        ) {
                                            OutcomeBadgePill(
                                                text = if (criterion.required) localizedText("Required", "必需") else localizedText("Optional", "可选"),
                                                tint = if (criterion.required) colors.accent else colors.textSecondary,
                                            )
                                            Text(
                                                criterion.statement,
                                                style = MaterialTheme.typography.bodyMedium,
                                                color = colors.textPrimary,
                                                modifier = Modifier.weight(1f),
                                            )
                                        }
                                    }
                                }
                            }
                            if (included.isNotEmpty()) {
                                ScopeGroup(localizedText("Included", "包含")) {
                                    included.forEach { BulletLine(it, colors.success) }
                                }
                            }
                            if (excluded.isNotEmpty()) {
                                ScopeGroup(localizedText("Excluded", "排除")) {
                                    excluded.forEach { BulletLine(it, colors.danger, textColor = colors.textSecondary) }
                                }
                            }
                            revision.budget?.let { budget ->
                                val parts = listOfNotNull(
                                    budget.timeLimitMinutes?.let { localizedText("$it min", "$it 分钟") },
                                    budget.costLimit?.let { localizedText("cost $it", "费用 $it") },
                                )
                                if (parts.isNotEmpty()) {
                                    ScopeGroup(localizedText("Budget", "预算")) {
                                        Text(parts.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = colors.textPrimary)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            SpatialPrimaryButton(
                label = localizedText("Approve and start", "批准并开始"),
                enabled = !busy,
                loading = busy,
                modifier = Modifier.fillMaxWidth(),
                onClick = onApprove,
            )
            SpatialSecondaryButton(
                label = localizedText("Tell the bot what to change", "告诉机器人要改什么"),
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
                onClick = onRequestChanges,
            )
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Level 2 + 3: independent short sections, each with a one-line preview and source on demand
// ---------------------------------------------------------------------------------------------

@Composable
internal fun OutcomeBriefSections(
    outcome: OutcomeDetail,
    state: OutcomeBriefState,
    onRetry: () -> Unit,
) {
    val colors = SpatialTheme.colors
    val brief = state.brief
    val revision = outcome.currentRevisionView
    val tasks = outcome.workItems
        .filter { it.contractRevision == outcome.currentRevision }
        .sortedBy { it.ordinal }

    // Real approval, blocking questions and dependency state come from saved records; the generated
    // prerequisites can only ever be listed as not verified.
    val planApproved = localizedText("Plan approval", "方案批准")
    val planApprovedText = localizedText("The saved contract has been explicitly approved.", "已保存的契约已被明确批准。")
    val planPendingText = localizedText("Review the contract before approving this plan.", "批准前请先核对契约内容。")
    val questionTitle = localizedText("Unresolved planning question", "未解决的规划问题")
    val dependencyTitle = localizedText("Task dependency", "任务依赖")
    val dependencyMissing = localizedText("The prerequisite task could not be verified.", "无法核实该前置任务。")
    val conditions = buildList {
        add(
            OutcomeCondition(
                planApproved,
                if (revision?.status == "approved") Readiness.Met else Readiness.Unmet,
                if (revision?.status == "approved") planApprovedText else planPendingText,
            ),
        )
        revision?.conflicts?.filter { it.severity == "blocking" }?.forEach {
            add(OutcomeCondition(questionTitle, Readiness.Unmet, it.message))
        }
        tasks.flatMap { it.dependsOn }.distinct().forEach { dependencyId ->
            val dependency = outcome.workItems.firstOrNull { it.id == dependencyId }
            add(
                OutcomeCondition(
                    title = dependency?.title ?: dependencyTitle,
                    status = when {
                        dependency == null -> Readiness.Unknown
                        dependency.status == "completed" || dependency.status == "accepted" -> Readiness.Met
                        else -> Readiness.Unmet
                    },
                    explanation = dependency?.let { localizedText("Saved task status: ${outcomeStatusLabel(it.status)}", "已保存的任务状态：${outcomeStatusLabel(it.status)}") }
                        ?: dependencyMissing,
                ),
            )
        }
        brief?.prerequisites?.forEach {
            add(OutcomeCondition(it.title, Readiness.Unknown, it.explanation, it.quote))
        }
    }
    val unmet = conditions.count { it.status == Readiness.Unmet }
    val unknown = conditions.count { it.status == Readiness.Unknown }
    val overall = when {
        unmet > 0 -> Readiness.Unmet
        unknown > 0 || brief == null -> Readiness.Unknown
        else -> Readiness.Met
    }

    val done = tasks.count { it.status == "completed" || it.status == "accepted" }
    val running = tasks.count { it.status == "running" || it.status == "in_progress" }
    val preparing = localizedText("Preparing a short overview…", "正在整理简要概览…")
    val unavailable = localizedText("Short overview unavailable", "简要概览暂不可用")

    SpatialGroupedSection(
        title = localizedText("Goal overview", "目标概览"),
        footer = if (brief != null) localizedText("Summary of saved records · expand a section to see sources", "基于已保存记录整理 · 展开分组可查看原文") else null,
    ) {
        // Background
        BriefRow(
            key = "background",
            outcomeId = outcome.id,
            icon = Icons.Outlined.Flag,
            tint = colors.accent,
            label = localizedText("Background", "背景"),
            preview = brief?.background?.title?.takeIf { it.isNotBlank() } ?: if (state.loading) preparing else unavailable,
        ) {
            Text(
                text = brief?.background?.explanation?.takeIf { it.isNotBlank() }
                    ?: localizedText(
                        "The original request is available below; its prerequisites have not been verified.",
                        "可在下方查看原始需求；其前提条件尚未核实。",
                    ),
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textSecondary,
            )
            SourceReveal(text = outcome.description, label = localizedText("Original request", "原始需求"))
        }
        SpatialHairlineDivider()

        // Prerequisites
        BriefRow(
            key = "prerequisites",
            outcomeId = outcome.id,
            icon = Icons.Outlined.Shield,
            tint = colors.success,
            label = localizedText("Prerequisites", "前提条件"),
            previewContent = {
                ReadinessPill(overall)
                Text(
                    text = buildString {
                        if (unmet > 0) append(localizedText("$unmet pending", "$unmet 项待处理"))
                        else append(localizedText("Plan approved", "方案已批准"))
                        if (unknown > 0) append(" · ").append(localizedText("$unknown not verified", "$unknown 项待核实"))
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
            },
        ) {
            conditions.forEachIndexed { index, item ->
                if (index > 0) SpatialHairlineDivider()
                ItemBlock(
                    title = item.title,
                    explanation = item.explanation,
                    quote = item.quote,
                    trailing = { ReadinessPill(item.status) },
                )
            }
            if (brief == null) {
                Text(
                    localizedText("Other prerequisites have not been summarized or verified.", "其他前提条件尚未整理或核实。"),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textTertiary,
                )
            }
        }

        // Risks (omitted entirely when none are recorded, never padded with generic warnings)
        if (brief != null && brief.risks.isNotEmpty()) {
            SpatialHairlineDivider()
            BriefRow(
                key = "risks",
                outcomeId = outcome.id,
                icon = Icons.Outlined.WarningAmber,
                tint = colors.warning,
                label = localizedText("Recorded risks", "已记录风险"),
                preview = if (brief.risks.size == 1) brief.risks.first().title
                else localizedText("${brief.risks.size} recorded risks", "${brief.risks.size} 项已记录风险"),
            ) {
                brief.risks.forEachIndexed { index, risk ->
                    if (index > 0) SpatialHairlineDivider()
                    ItemBlock(
                        title = risk.title,
                        explanation = risk.explanation,
                        quote = risk.quote,
                        trailing = { OutcomeBadgePill(localizedText("Not assessed", "未评估")) },
                    )
                }
            }
        }
        SpatialHairlineDivider()

        // Tasks: real WorkItems first; unscheduled suggestions are labelled as such
        BriefRow(
            key = "tasks",
            outcomeId = outcome.id,
            icon = Icons.Outlined.Checklist,
            tint = colors.accent,
            label = localizedText("Tasks", "任务"),
            preview = when {
                tasks.isNotEmpty() -> localizedText(
                    "${tasks.size} tasks · $done done · $running running",
                    "${tasks.size} 个任务 · 已完成 $done · 进行中 $running",
                )
                brief != null && brief.proposedTasks.isNotEmpty() -> localizedText(
                    "${brief.proposedTasks.size} suggested tasks",
                    "${brief.proposedTasks.size} 个建议任务",
                )
                state.loading -> localizedText("Preparing task overview…", "正在整理任务概览…")
                brief != null -> localizedText("No task breakdown saved", "尚未保存任务拆分")
                else -> localizedText("Task overview unavailable", "任务概览暂不可用")
            },
        ) {
            when {
                tasks.isNotEmpty() -> tasks.forEachIndexed { index, task ->
                    if (index > 0) SpatialHairlineDivider()
                    ItemBlock(
                        title = task.title,
                        explanation = task.statusReason?.takeIf { it.isNotBlank() }
                            ?: localizedText("Status comes from the saved task record.", "状态来自已保存的任务记录。"),
                        quote = null,
                        trailing = { OutcomeStatusPill(task.status) },
                    )
                }
                brief != null && brief.proposedTasks.isNotEmpty() -> {
                    Text(
                        localizedText("Suggested steps, not scheduled work items.", "以下为建议步骤，尚未创建为工作项。"),
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textTertiary,
                    )
                    brief.proposedTasks.forEachIndexed { index, task ->
                        if (index > 0) SpatialHairlineDivider()
                        ItemBlock(
                            title = task.title,
                            explanation = task.explanation,
                            quote = task.quote,
                            trailing = { OutcomeBadgePill(localizedText("Suggested", "建议")) },
                        )
                    }
                }
                else -> Text(
                    localizedText(
                        "No task breakdown is saved. Acceptance criteria are not execution tasks.",
                        "尚未保存任务拆分。验收标准不等同于执行任务。",
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textSecondary,
                )
            }
        }

        if (state.failed) {
            SpatialHairlineDivider()
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Info, contentDescription = null, tint = colors.textTertiary, modifier = Modifier.size(15.dp))
                Spacer(Modifier.size(6.dp))
                Text(unavailable, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary, modifier = Modifier.weight(1f))
                TextButton(onClick = onRetry) { Text(localizedText("Retry summary", "重试概览")) }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------

/** One independently expandable row: label + one-line preview collapsed, detail when opened. */
@Composable
private fun BriefRow(
    key: String,
    outcomeId: String,
    icon: ImageVector,
    tint: Color,
    label: String,
    preview: String? = null,
    previewContent: (@Composable androidx.compose.foundation.layout.RowScope.() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    var expanded by rememberSaveable(outcomeId, key) { mutableStateOf(false) }
    Column {
        DisclosureHeader(
            icon = icon,
            tint = tint,
            label = label,
            preview = preview,
            previewContent = previewContent,
            expanded = expanded,
            onToggle = { expanded = !expanded },
        )
        DisclosureBody(visible = expanded) {
            Column(
                modifier = Modifier.padding(start = 14.dp, end = 14.dp, bottom = 14.dp),
                verticalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
            ) { content() }
        }
    }
}

@Composable
private fun DisclosureHeader(
    icon: ImageVector,
    tint: Color,
    label: String,
    expanded: Boolean,
    onToggle: () -> Unit,
    preview: String? = null,
    previewContent: (@Composable androidx.compose.foundation.layout.RowScope.() -> Unit)? = null,
) {
    val colors = SpatialTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onToggle)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.sm),
    ) {
        Box(
            modifier = Modifier.size(32.dp).clip(CircleShape).background(tint.copy(alpha = 0.14f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(17.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                label,
                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                color = colors.textPrimary,
            )
            if (previewContent != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    previewContent()
                }
            } else if (preview != null) {
                Text(
                    preview,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Icon(
            imageVector = if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
            contentDescription = if (expanded) localizedText("Collapse", "收起") else localizedText("Expand", "展开"),
            tint = colors.textTertiary,
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
private fun DisclosureBody(visible: Boolean, content: @Composable () -> Unit) {
    AnimatedVisibility(
        visible = visible,
        enter = expandVertically() + fadeIn(),
        exit = shrinkVertically() + fadeOut(),
    ) { content() }
}

/** Title + status on one line, short explanation below, original text only when asked for. */
@Composable
private fun ItemBlock(
    title: String,
    explanation: String,
    quote: String?,
    trailing: @Composable () -> Unit,
) {
    val colors = SpatialTheme.colors
    Column(
        modifier = Modifier.padding(vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs)) {
            Text(
                title,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                color = colors.textPrimary,
                modifier = Modifier.weight(1f),
            )
            trailing()
        }
        if (explanation.isNotBlank()) {
            Text(explanation, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
        }
        if (!quote.isNullOrBlank()) SourceReveal(text = quote, label = title)
    }
}

/** Third level: the saved original text, shown in place instead of a desktop hover popover. */
@Composable
private fun SourceReveal(text: String, label: String) {
    if (text.isBlank()) return
    val colors = SpatialTheme.colors
    var open by rememberSaveable(text) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(SpatialRadii.pill))
                .clickable { open = !open }
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(Icons.Outlined.Info, contentDescription = null, tint = colors.accent, modifier = Modifier.size(14.dp))
            Text(
                text = if (open) localizedText("Hide source", "收起原文") else localizedText("View source", "查看原文"),
                style = MaterialTheme.typography.labelMedium,
                color = colors.accent,
            )
        }
        DisclosureBody(visible = open) {
            Surface(
                shape = RoundedCornerShape(SpatialRadii.sm),
                color = colors.codeSurface,
                border = BorderStroke(0.5.dp, colors.hairline),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(SpatialSpacing.sm), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(label, style = MaterialTheme.typography.labelSmall, color = colors.textTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(text, style = MaterialTheme.typography.bodySmall, color = colors.textPrimary)
                }
            }
        }
    }
}

@Composable
private fun ReadinessPill(value: Readiness) {
    val colors = SpatialTheme.colors
    when (value) {
        Readiness.Met -> OutcomeBadgePill(localizedText("Met", "已满足"), Icons.Outlined.CheckCircle, colors.success)
        Readiness.Unmet -> OutcomeBadgePill(localizedText("Not met", "未满足"), Icons.Outlined.ErrorOutline, colors.warning)
        Readiness.Unknown -> OutcomeBadgePill(localizedText("Not verified", "待核实"), Icons.Outlined.Circle, colors.textTertiary)
    }
}

@Composable
private fun ScopeGroup(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            title,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
            color = SpatialTheme.colors.textTertiary,
        )
        content()
    }
}

@Composable
private fun BulletLine(text: String, tint: Color, textColor: Color = SpatialTheme.colors.textPrimary) {
    Row(horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs), verticalAlignment = Alignment.Top) {
        Box(
            modifier = Modifier.padding(top = 8.dp).size(6.dp).clip(CircleShape).background(tint),
        )
        Text(text, style = MaterialTheme.typography.bodyMedium, color = textColor, modifier = Modifier.weight(1f))
    }
}
