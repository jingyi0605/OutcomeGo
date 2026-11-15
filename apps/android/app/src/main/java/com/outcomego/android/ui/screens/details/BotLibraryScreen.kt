package com.outcomego.android.ui.screens.details

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.outcomego.android.data.Conversation
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialFloatingTopBar
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialGroupedSection
import com.outcomego.android.ui.designsystem.SpatialHairlineDivider
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialPrimaryButton
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSecondaryButton
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.android.ui.screens.chat.AttachmentGalleryDialog
import com.outcomego.features.Attachment
import com.outcomego.features.AttachmentState
import com.outcomego.features.ChannelLibraryItem
import com.outcomego.features.ChannelLibrarySection
import com.outcomego.features.ChannelLibraryState
import com.outcomego.features.FileGlyph
import com.outcomego.features.formatAttachmentSize
import com.outcomego.features.groupChannelLibraryItems
import com.outcomego.features.localizedText
import com.outcomego.features.rememberDecodedBitmap
import com.outcomego.platform.NativeAttachmentPreview
import java.time.Instant

private enum class PendingLibraryActionType { OpenExternally, Save, Share, Forward }

private data class PendingLibraryAction(
    val attachmentId: String,
    val type: PendingLibraryActionType,
)

@Composable
internal fun BotLibraryScreen(
    conversation: Conversation?,
    conversations: List<Conversation>,
    state: ChannelLibraryState,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onTogglePin: (ChannelLibraryItem) -> Unit,
    onDownloadAttachment: (Attachment) -> Unit,
    onSaveAttachmentToUri: (Attachment, Uri) -> Unit,
    onShareAttachment: (Attachment) -> Unit,
    onForwardAttachment: (Attachment, String) -> Unit,
) {
    val colors = SpatialTheme.colors
    val context = LocalContext.current
    var selectedAttachmentId by remember { mutableStateOf<String?>(null) }
    var forwardingAttachment by remember { mutableStateOf<Attachment?>(null) }
    var savingAttachment by remember { mutableStateOf<Attachment?>(null) }
    var pendingAction by remember { mutableStateOf<PendingLibraryAction?>(null) }

    val saveDocumentLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("*/*"),
    ) { destinationUri ->
        val target = savingAttachment
        savingAttachment = null
        if (destinationUri != null && target != null) {
            onSaveAttachmentToUri(target, destinationUri)
        }
    }

    val grouped = remember(state.items, state.pinnedItems) {
        groupChannelLibraryItems(state)
    }
    val pinnedIds = remember(state.pinnedItems) {
        state.pinnedItems.mapTo(HashSet()) { it.id }
    }
    val visibleAttachments = remember(grouped) {
        grouped.values.flatten().map { it.attachment }.distinctBy { it.id }
    }
    val attachmentsById = remember(visibleAttachments) {
        visibleAttachments.associateBy { it.id }
    }

    fun dispatchAttachmentAction(attachment: Attachment, type: PendingLibraryActionType) {
        val current = attachmentsById[attachment.id] ?: attachment
        if (current.localUri == null) {
            pendingAction = PendingLibraryAction(current.id, type)
            onDownloadAttachment(current)
            return
        }
        when (type) {
            PendingLibraryActionType.OpenExternally -> NativeAttachmentPreview.open(context, current)
            PendingLibraryActionType.Save -> {
                savingAttachment = current
                saveDocumentLauncher.launch(current.name.ifBlank { "attachment" })
            }
            PendingLibraryActionType.Share -> onShareAttachment(current)
            PendingLibraryActionType.Forward -> forwardingAttachment = current
        }
    }

    LaunchedEffect(attachmentsById, pendingAction) {
        val action = pendingAction ?: return@LaunchedEffect
        val latest = attachmentsById[action.attachmentId] ?: return@LaunchedEffect
        if (latest.localUri != null) {
            pendingAction = null
            dispatchAttachmentAction(latest, action.type)
        } else if (latest.state == AttachmentState.Failed) {
            pendingAction = null
        }
    }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding(),
            contentPadding = PaddingValues(
                top = 74.dp,
                bottom = 32.dp,
                start = SpatialSpacing.md,
                end = SpatialSpacing.md,
            ),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (grouped.isEmpty() && state.loading && !state.hasLoaded) {
                item("loading") {
                    SpatialGlassSurface(
                        tier = GlassTier.Card,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(SpatialRadii.lg),
                    ) {
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 32.dp, horizontal = 20.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(28.dp),
                                color = colors.textPrimary,
                                strokeWidth = 2.5.dp,
                            )
                            Text(
                                localizedText("Loading Library…", "正在加载资料库…"),
                                style = MaterialTheme.typography.bodyMedium,
                                color = colors.textSecondary,
                            )
                        }
                    }
                }
            } else if (grouped.isEmpty() && !state.loading && state.error == null) {
                item("empty") {
                    SpatialGlassSurface(
                        tier = GlassTier.Card,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(SpatialRadii.lg),
                    ) {
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 36.dp, horizontal = 24.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Icon(
                                Icons.Outlined.FolderOpen,
                                contentDescription = null,
                                tint = colors.textTertiary,
                                modifier = Modifier.size(34.dp),
                            )
                            Text(
                                localizedText("Library", "资料库"),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = colors.textPrimary,
                            )
                            Text(
                                localizedText(
                                    "Pages, files, and apps this Bot makes show up here",
                                    "此机器人生成的页面、文件和应用会显示在这里",
                                ),
                                style = MaterialTheme.typography.bodyMedium,
                                color = colors.textSecondary,
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                }
            }

            grouped.forEach { (section, sectionItems) ->
                item(key = "section_${section.name}") {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            text = sectionLabel(section),
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold,
                            color = colors.textSecondary,
                            modifier = Modifier.padding(horizontal = 4.dp),
                        )
                        SpatialGroupedSection(tier = GlassTier.Card) {
                            sectionItems.forEachIndexed { index, item ->
                                if (index > 0) {
                                    SpatialHairlineDivider(insetStart = 68.dp)
                                }
                                LibraryItemRow(
                                    item = item,
                                    pinned = item.id in pinnedIds,
                                    onClick = { selectedAttachmentId = item.attachment.id },
                                    onDownloadThumbnail = { onDownloadAttachment(item.attachment) },
                                    onTogglePin = { onTogglePin(item) },
                                    onOpenExternally = {
                                        dispatchAttachmentAction(item.attachment, PendingLibraryActionType.OpenExternally)
                                    },
                                    onSave = {
                                        dispatchAttachmentAction(item.attachment, PendingLibraryActionType.Save)
                                    },
                                    onShare = {
                                        dispatchAttachmentAction(item.attachment, PendingLibraryActionType.Share)
                                    },
                                    onForward = {
                                        dispatchAttachmentAction(item.attachment, PendingLibraryActionType.Forward)
                                    },
                                )
                            }
                        }
                    }
                }
            }

            if (state.error != null) {
                item("error") {
                    SpatialGlassSurface(
                        tier = GlassTier.Card,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(SpatialRadii.lg),
                    ) {
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Text(
                                state.error,
                                style = MaterialTheme.typography.bodyMedium,
                                color = colors.danger,
                                textAlign = TextAlign.Center,
                            )
                            SpatialPrimaryButton(
                                label = localizedText("Try again", "重试"),
                                onClick = { if (state.items.isEmpty()) onRefresh() else onLoadMore() },
                            )
                        }
                    }
                }
            }

            if (state.nextCursor != null && state.error == null) {
                item("load_more") {
                    SpatialSecondaryButton(
                        label = if (state.loading) {
                            localizedText("Loading…", "正在加载…")
                        } else {
                            localizedText("Load more", "加载更多")
                        },
                        onClick = onLoadMore,
                        enabled = !state.loading,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }

        SpatialFloatingTopBar(
            title = localizedText("Library", "资料库"),
            subtitle = conversation?.title,
            navigationIcon = {
                SpatialIconOrb(
                    icon = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = localizedText("Back", "返回"),
                    onClick = onBack,
                )
            },
            actions = {
                SpatialIconOrb(
                    icon = Icons.Default.Refresh,
                    contentDescription = localizedText("Refresh", "刷新"),
                    onClick = onRefresh,
                )
            },
        )
    }

    selectedAttachmentId?.let { initialId ->
        if (visibleAttachments.any { it.id == initialId }) {
            AttachmentGalleryDialog(
                attachments = visibleAttachments,
                initialId = initialId,
                onDismiss = { selectedAttachmentId = null },
                onOpenDocument = { dispatchAttachmentAction(it, PendingLibraryActionType.OpenExternally) },
                onSave = { attachment ->
                    if (attachment.localUri == null) {
                        onDownloadAttachment(attachment)
                    } else {
                        dispatchAttachmentAction(attachment, PendingLibraryActionType.Save)
                    }
                },
                onShare = { dispatchAttachmentAction(it, PendingLibraryActionType.Share) },
                onForward = { dispatchAttachmentAction(it, PendingLibraryActionType.Forward) },
                onEnsureDownloaded = onDownloadAttachment,
            )
        }
    }

    forwardingAttachment?.let { attachment ->
        AlertDialog(
            onDismissRequest = { forwardingAttachment = null },
            title = { Text(localizedText("Forward to conversation", "转发到对话")) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        "${localizedText("Forward", "转发")}: ${attachment.name}",
                        color = colors.textSecondary,
                    )
                    conversations.forEach { target ->
                        TextButton(
                            onClick = {
                                onForwardAttachment(attachment, target.id)
                                forwardingAttachment = null
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                target.title,
                                modifier = Modifier.fillMaxWidth(),
                                textAlign = TextAlign.Start,
                                color = colors.textPrimary,
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { forwardingAttachment = null }) {
                    Text(localizedText("Cancel", "取消"))
                }
            },
        )
    }
}

@Composable
private fun LibraryItemRow(
    item: ChannelLibraryItem,
    pinned: Boolean,
    onClick: () -> Unit,
    onDownloadThumbnail: () -> Unit,
    onTogglePin: () -> Unit,
    onOpenExternally: () -> Unit,
    onSave: () -> Unit,
    onShare: () -> Unit,
    onForward: () -> Unit,
) {
    val colors = SpatialTheme.colors
    var menuExpanded by remember(item.id) { mutableStateOf(false) }

    LaunchedEffect(item.attachment.id, item.attachment.localUri, item.attachment.state) {
        if (item.attachment.isImage &&
            item.attachment.localUri == null &&
            item.attachment.state == AttachmentState.Available
        ) {
            onDownloadThumbnail()
        }
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LibraryLeadingPreview(item.attachment)
        Spacer(Modifier.width(12.dp))
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = item.attachment.name.ifBlank { localizedText("Untitled file", "未命名文件") },
                style = MaterialTheme.typography.bodyLarge,
                color = colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            val meta = buildString {
                if (item.attachment.sizeBytes > 0L) {
                    append(formatAttachmentSize(item.attachment.sizeBytes))
                }
                val age = formatLibraryAgeLabel(item.createdAt)
                if (age.isNotBlank()) {
                    if (isNotEmpty()) append(" · ")
                    append(age)
                }
            }
            if (meta.isNotEmpty()) {
                Text(
                    text = meta,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Box {
            IconButton(onClick = { menuExpanded = true }) {
                Icon(
                    Icons.Default.MoreHoriz,
                    contentDescription = localizedText("More actions", "更多操作"),
                    tint = colors.textSecondary,
                )
            }
            DropdownMenu(
                expanded = menuExpanded,
                onDismissRequest = { menuExpanded = false },
            ) {
                DropdownMenuItem(
                    text = {
                        Text(if (pinned) localizedText("Unpin", "取消置顶") else localizedText("Pin", "置顶"))
                    },
                    onClick = {
                        menuExpanded = false
                        onTogglePin()
                    },
                )
                DropdownMenuItem(
                    text = { Text(localizedText("Save to device", "保存到设备")) },
                    onClick = {
                        menuExpanded = false
                        onSave()
                    },
                )
                DropdownMenuItem(
                    text = { Text(localizedText("Share", "分享")) },
                    onClick = {
                        menuExpanded = false
                        onShare()
                    },
                )
                DropdownMenuItem(
                    text = { Text(localizedText("Forward", "转发")) },
                    onClick = {
                        menuExpanded = false
                        onForward()
                    },
                )
                DropdownMenuItem(
                    text = { Text(localizedText("Open with…", "使用其他应用打开")) },
                    onClick = {
                        menuExpanded = false
                        onOpenExternally()
                    },
                )
            }
        }
    }
}

@Composable
private fun LibraryLeadingPreview(attachment: Attachment) {
    val colors = SpatialTheme.colors
    if (attachment.isImage) {
        val thumbnail = rememberDecodedBitmap(attachment.localUri, maxSizePx = 128)
        Box(
            modifier = Modifier
                .size(42.dp)
                .clip(RoundedCornerShape(SpatialRadii.xs))
                .background(colors.glassSubtle),
            contentAlignment = Alignment.Center,
        ) {
            if (thumbnail != null) {
                Image(
                    bitmap = thumbnail,
                    contentDescription = attachment.alt ?: attachment.name,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
            } else {
                Icon(
                    Icons.Outlined.Image,
                    contentDescription = null,
                    tint = colors.textTertiary,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    } else {
        FileGlyph(
            fileName = attachment.name,
            modifier = Modifier.size(42.dp),
        )
    }
}

@Composable
private fun sectionLabel(section: ChannelLibrarySection): String = when (section) {
    ChannelLibrarySection.Pinned -> localizedText("Pinned", "已置顶")
    ChannelLibrarySection.Today -> localizedText("Today", "今天")
    ChannelLibrarySection.Yesterday -> localizedText("Yesterday", "昨天")
    ChannelLibrarySection.Last7Days -> localizedText("Last 7 days", "最近 7 天")
    ChannelLibrarySection.Older -> localizedText("Older", "更早")
}

@Composable
private fun formatLibraryAgeLabel(createdAt: String): String {
    val createdMillis = runCatching { Instant.parse(createdAt).toEpochMilli() }.getOrNull() ?: return ""
    val age = (System.currentTimeMillis() - createdMillis).coerceAtLeast(0L)
    return when {
        age >= 86_400_000L -> {
            val days = age / 86_400_000L
            localizedText("${days}d", "$days 天")
        }
        age >= 3_600_000L -> {
            val hours = age / 3_600_000L
            localizedText("${hours}h", "$hours 小时")
        }
        else -> localizedText("now", "刚刚")
    }
}
