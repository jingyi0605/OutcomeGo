package com.outcomego.android.ui.screens.system

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.outcomego.android.data.Conversation
import com.outcomego.android.data.PendingSend
import com.outcomego.android.data.SidebarPreferences
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialFloatingTopBar
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.android.ui.groupConversations
import com.outcomego.android.ui.screens.directory.BotAvatar
import com.outcomego.features.HapticEffect
import com.outcomego.features.LocalAppHaptics
import com.outcomego.features.localizedText
import com.outcomego.platform.SharePayload

@Composable
internal fun ShareTargetScreen(
    share: SharePayload?,
    rows: List<Conversation>,
    sidebar: SidebarPreferences,
    error: String?,
    onSelect: (String) -> Boolean,
    onStay: (Conversation) -> Unit,
    onReturn: (Conversation) -> Unit,
    onCancel: () -> Unit,
) {
    var received by remember { mutableStateOf(share) }
    LaunchedEffect(share) { if (share != null) received = share }
    var sentTo by remember { mutableStateOf<Conversation?>(null) }
    val grouped = remember(rows, sidebar) { groupConversations(rows, sidebar) }
    val ordered = remember(grouped) {
        grouped.pinned + grouped.sections.flatMap { it.conversations } + grouped.unassigned
    }
    val colors = SpatialTheme.colors
    BackHandler(enabled = sentTo == null, onBack = onCancel)

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier
                .fillMaxSize()
                .testTag("share-target-list"),
            contentPadding = PaddingValues(
                top = 82.dp,
                bottom = 32.dp,
                start = SpatialSpacing.md,
                end = SpatialSpacing.md,
            ),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item(key = "received") {
                received?.let { ShareReceivedCard(it) }
            }
            if (error != null) {
                item(key = "error") {
                    Text(error, color = colors.danger, style = MaterialTheme.typography.bodySmall)
                }
            }
            item(key = "choose") {
                Text(
                    localizedText("Send to", "发送给"),
                    Modifier.padding(start = 4.dp, top = 12.dp, bottom = 4.dp),
                    style = MaterialTheme.typography.labelLarge,
                    color = colors.textSecondary,
                )
            }
            items(ordered, key = { "share-${it.id}" }) { row ->
                SpatialGlassSurface(
                    tier = GlassTier.Subtle,
                    shape = RoundedCornerShape(SpatialRadii.lg),
                    onClick = { if (onSelect(row.id)) sentTo = row },
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("share-target-${row.id}"),
                ) {
                    Row(
                        Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        BotAvatar(row, size = 44.dp, showWorking = true)
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text(row.title, fontWeight = FontWeight.Medium, maxLines = 1, color = colors.textPrimary)
                            if (row.subtitle.isNotBlank()) {
                                Text(
                                    row.subtitle,
                                    maxLines = 1,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textSecondary,
                                )
                            }
                        }
                    }
                }
            }
        }
        SpatialFloatingTopBar(
            title = localizedText("Share to OutcomeGo", "分享到 OutcomeGo"),
            navigationIcon = {
                SpatialIconOrb(
                    icon = Icons.Default.Close,
                    contentDescription = localizedText("Cancel", "取消"),
                    onClick = onCancel,
                )
            },
        )
    }

    sentTo?.let { target ->
        AlertDialog(
            onDismissRequest = { onStay(target) },
            containerColor = colors.glassOverlay,
            title = { Text(localizedText("Shared to ${target.title}", "已分享给 ${target.title}"), color = colors.textPrimary) },
            text = {
                Text(
                    localizedText(
                        "Stay in OutcomeGo to see the conversation, or go back to the app you shared from?",
                        "要留在 OutcomeGo 查看对话,还是回到分享来源的上一个应用?",
                    ),
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(onClick = { onStay(target) }, modifier = Modifier.testTag("share-stay")) {
                    Text(localizedText("Stay in OutcomeGo", "留在 OutcomeGo"), color = colors.accent)
                }
            },
            dismissButton = {
                TextButton(onClick = { onReturn(target) }, modifier = Modifier.testTag("share-return")) {
                    Text(localizedText("Back to previous app", "回到上一个应用"), color = colors.textSecondary)
                }
            },
        )
    }
}

@Composable
private fun ShareReceivedCard(share: SharePayload) {
    val context = LocalContext.current
    val streams = share.streams.ifEmpty { listOfNotNull(share.stream) }
    val names = remember(streams) { streams.map { shareStreamLabel(context, it) } }
    val colors = SpatialTheme.colors
    SpatialGlassSurface(
        tier = GlassTier.Card,
        shape = RoundedCornerShape(SpatialRadii.lg),
        modifier = Modifier
            .fillMaxWidth()
            .testTag("share-received"),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                localizedText("Received content", "收到的内容"),
                style = MaterialTheme.typography.labelMedium,
                color = colors.textSecondary,
            )
            share.text?.takeIf(String::isNotBlank)?.let {
                Text(it.trim(), maxLines = 6, overflow = TextOverflow.Ellipsis, color = colors.textPrimary)
            }
            names.take(5).forEach { name ->
                Text("📎 $name", maxLines = 1, overflow = TextOverflow.Ellipsis, color = colors.textPrimary)
            }
            if (names.size > 5) {
                Text(
                    localizedText("and ${names.size - 5} more", "另外 ${names.size - 5} 个"),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            }
        }
    }
}

private fun shareStreamLabel(context: Context, uri: Uri): String =
    runCatching {
        context.contentResolver
            .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
    }.getOrNull()?.takeIf(String::isNotBlank) ?: uri.lastPathSegment ?: uri.toString()

@Composable
internal fun OutboxScreen(
    items: List<PendingSend>,
    onRetry: (String) -> Unit,
    onDiscard: (String) -> Unit,
    onBack: () -> Unit,
) {
    val haptic = LocalAppHaptics.current
    val colors = SpatialTheme.colors
    Box(Modifier.fillMaxSize()) {
        if (items.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    localizedText("All messages have been delivered.", "所有消息都已发送。"),
                    color = colors.textSecondary,
                )
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = PaddingValues(
                    top = 82.dp,
                    bottom = 32.dp,
                    start = SpatialSpacing.md,
                    end = SpatialSpacing.md,
                ),
            ) {
                items(items, key = PendingSend::id) { item ->
                    SpatialGlassSurface(
                        tier = GlassTier.Card,
                        shape = RoundedCornerShape(SpatialRadii.lg),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                item.content.ifBlank { "Attachment-only message" },
                                fontWeight = FontWeight.Medium,
                                color = colors.textPrimary,
                            )
                            Text(
                                localizedText("Conversation: ${item.channelId}", "对话：${item.channelId}"),
                                style = MaterialTheme.typography.labelSmall,
                                color = colors.textSecondary,
                            )
                            if (item.attachments.isNotEmpty()) {
                                Text(
                                    item.attachments.joinToString(", ") { attachment ->
                                        "${attachment.fileName} (${attachment.mimeType})"
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textSecondary,
                                )
                            }
                            Text(
                                item.failure?.let { localizedText("Failed: $it", "失败：$it") }
                                    ?: localizedText("Queued for delivery", "已排队等待发送"),
                                color = if (item.failure == null) colors.textSecondary else colors.danger,
                                style = MaterialTheme.typography.bodySmall,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextButton(onClick = { haptic.play(HapticEffect.Light); onRetry(item.id) }) {
                                    Text(localizedText("Retry", "重试"), color = colors.accent)
                                }
                                TextButton(onClick = { haptic.play(HapticEffect.Warning); onDiscard(item.id) }) {
                                    Text(localizedText("Discard", "丢弃"), color = colors.danger)
                                }
                            }
                        }
                    }
                }
            }
        }
        SpatialFloatingTopBar(
            title = localizedText("Outbox", "发件箱"),
            navigationIcon = {
                SpatialIconOrb(
                    icon = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = localizedText("Back", "返回"),
                    onClick = onBack,
                )
            },
        )
    }
}
