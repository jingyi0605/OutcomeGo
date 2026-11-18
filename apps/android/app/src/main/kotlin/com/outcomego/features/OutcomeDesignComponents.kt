package com.outcomego.features

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
internal fun OutcomeStatusPill(
    status: String?,
    modifier: Modifier = Modifier,
) {
    val colors = SpatialTheme.colors
    val (tint, icon) = when (status) {
        "running", "in_progress" -> colors.accent to Icons.Outlined.PlayCircle
        "accepted", "completed", "approved", "PASS" -> colors.success to Icons.Outlined.CheckCircle
        "pending_approval", "review_pending", "needs_review",
        "decision_pending", "waiting_decision", "human_action_pending",
        "waiting_human", "planning", "queued", "retry_pending", "submitted", "ready",
        -> colors.warning to Icons.Outlined.HourglassEmpty
        "paused" -> colors.warning to Icons.Outlined.PauseCircle
        "failed", "rejected", "FAIL" -> colors.danger to Icons.Outlined.ErrorOutline
        "cancelled" -> colors.textTertiary to Icons.Outlined.Cancel
        "draft" -> colors.textSecondary to Icons.Outlined.EditNote
        else -> colors.textTertiary to Icons.Outlined.Schedule
    }
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(SpatialRadii.pill),
        color = tint.copy(alpha = 0.14f),
        border = BorderStroke(0.75.dp, tint.copy(alpha = 0.30f)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(13.dp),
            )
            Text(
                text = outcomeStatusLabel(status),
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                color = tint,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
internal fun OutcomeBadgePill(
    text: String,
    icon: ImageVector? = null,
    tint: Color = SpatialTheme.colors.textSecondary,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(SpatialRadii.pill),
        color = SpatialTheme.colors.glassSubtle,
        border = BorderStroke(0.5.dp, SpatialTheme.colors.hairline),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (icon != null) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = tint,
                    modifier = Modifier.size(12.dp),
                )
            }
            Text(
                text = text,
                style = MaterialTheme.typography.labelSmall,
                color = tint,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
internal fun OutcomeMetricTile(
    label: String,
    value: String,
    icon: ImageVector,
    tint: Color,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
) {
    val colors = SpatialTheme.colors
    SpatialGlassSurface(
        modifier = modifier,
        tier = GlassTier.Subtle,
        shape = RoundedCornerShape(SpatialRadii.md),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(22.dp)
                        .clip(CircleShape)
                        .background(tint.copy(alpha = 0.16f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = tint,
                        modifier = Modifier.size(13.dp),
                    )
                }
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = value,
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                    color = colors.textPrimary,
                    maxLines = 1,
                )
                if (!subtitle.isNullOrBlank()) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.textTertiary,
                        modifier = Modifier.padding(bottom = 2.dp),
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

@Composable
internal fun OutcomeSegmentedTabs(
    tabs: List<Pair<ImageVector, String>>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = SpatialTheme.colors
    SpatialGlassSurface(
        modifier = modifier.fillMaxWidth(),
        tier = GlassTier.Subtle,
        shape = RoundedCornerShape(SpatialRadii.pill),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            tabs.forEachIndexed { index, (icon, label) ->
                val selected = index == selectedIndex
                val bg by animateColorAsState(
                    targetValue = if (selected) colors.glassCard else Color.Transparent,
                    animationSpec = tween(180),
                    label = "segTabBg",
                )
                val borderModifier = if (selected) {
                    Modifier.border(0.75.dp, colors.glassBorderMid, RoundedCornerShape(SpatialRadii.pill))
                } else {
                    Modifier
                }
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(SpatialRadii.pill))
                        .background(bg)
                        .then(borderModifier)
                        .clickable { onSelect(index) }
                        .padding(horizontal = 8.dp, vertical = 9.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = if (selected) colors.textPrimary else colors.textSecondary,
                        modifier = Modifier.size(15.dp),
                    )
                    Spacer(Modifier.width(5.dp))
                    Text(
                        text = label,
                        style = MaterialTheme.typography.labelMedium.copy(
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                        ),
                        color = if (selected) colors.textPrimary else colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

private val outcomeShortFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("MM-dd HH:mm").withZone(ZoneId.systemDefault())

internal fun formatOutcomeTimestamp(iso: String): String =
    runCatching { outcomeShortFormatter.format(Instant.parse(iso)) }
        .getOrElse { iso.take(16).replace('T', ' ') }
