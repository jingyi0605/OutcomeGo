package com.outcomego.android.ui.screens.directory

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import com.outcomego.android.data.Conversation
import com.outcomego.android.data.SearchResult
import com.outcomego.android.data.SidebarSection
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialGlassTextField
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialMotion
import com.outcomego.android.ui.designsystem.SpatialPulseOrb
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.android.ui.designsystem.spatialPressScale
import com.outcomego.features.HapticEffect
import com.outcomego.features.LocalAppHaptics
import com.outcomego.features.localizedText
import com.outcomego.features.rememberDecodedBitmap
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

internal enum class SearchFilter(
    val apiValue: String,
    val englishLabel: String,
    val chineseLabel: String,
) {
    All("all", "All", "全部"),
    Messages("messages", "Messages", "消息"),
    Robots("bots", "Robots", "机器人"),
    Groups("channels", "Group chats", "群聊"),
    Files("files", "Files", "文件"),
    ScheduledTasks("routines", "Scheduled tasks", "定时任务"),
    Other("links", "Other", "其他"),
}

internal fun groupMembers(group: Conversation, rows: List<Conversation>): List<Conversation> {
    if (!group.isGroup) return emptyList()
    val botsById = rows
        .filter { it.isBot && !it.botId.isNullOrBlank() }
        .associateBy { it.botId }
    return group.memberBotIds.mapNotNull(botsById::get)
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun PinnedBotCard(
    conversation: Conversation,
    accountName: String,
    members: List<Conversation>,
    unread: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    val haptic = LocalAppHaptics.current
    val colors = SpatialTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    Column(
        modifier = Modifier
            .width(96.dp)
            .spatialPressScale(interactionSource, hapticEffect = HapticEffect.Light)
            .testTag("pinned-${conversation.id}")
            .combinedClickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = { haptic.play(HapticEffect.Light); onClick() },
                onLongClick = { haptic.play(HapticEffect.Medium); onLongClick() },
            ),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        ConversationAvatar(
            conversation = conversation,
            accountName = accountName,
            members = members,
            size = 76.dp,
            showWorking = true,
            ringColor = colors.canvasBase,
        )
        Spacer(Modifier.height(8.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Text(
                text = conversation.title,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Medium,
                color = colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (unread) {
                SpatialPulseOrb(color = colors.accent, size = 7.dp)
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun DirectoryConversationRow(
    row: Conversation,
    accountName: String,
    members: List<Conversation>,
    unread: Boolean,
    pinned: Boolean,
    sections: List<SidebarSection>,
    menuExpanded: Boolean,
    onOpen: () -> Unit,
    onBotDetails: () -> Unit,
    onTogglePin: () -> Unit,
    onMoveToSection: (String?) -> Unit,
    onOpenMenu: () -> Unit,
    onDismissMenu: () -> Unit,
) {
    val colors = SpatialTheme.colors
    val timestamp = conversationTimestampLabel(
        row.updatedAt,
        yesterday = localizedText("Yesterday", "昨天"),
    )
    val haptic = LocalAppHaptics.current
    val interactionSource = remember { MutableInteractionSource() }
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(SpatialRadii.md))
                .spatialPressScale(interactionSource, hapticEffect = HapticEffect.Light)
                .testTag("conversation-${row.id}")
                .combinedClickable(
                    interactionSource = interactionSource,
                    indication = null,
                    onClick = { haptic.play(HapticEffect.Light); onOpen() },
                    onLongClick = { haptic.play(HapticEffect.Medium); onOpenMenu() },
                )
                .padding(horizontal = 4.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ConversationAvatar(
                conversation = row,
                accountName = accountName,
                members = members,
                size = 50.dp,
                showWorking = true,
                ringColor = colors.canvasBase,
            )
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = row.title,
                        style = MaterialTheme.typography.titleSmall.copy(
                            fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Medium,
                        ),
                        color = colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (timestamp != null) {
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = timestamp,
                            style = MaterialTheme.typography.labelSmall,
                            color = colors.textTertiary,
                        )
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = row.preview ?: localizedText("No messages yet", "还没有消息"),
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (unread) colors.textPrimary.copy(alpha = 0.85f) else colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (unread) {
                        Spacer(Modifier.width(8.dp))
                        SpatialPulseOrb(color = colors.accent, size = 8.dp)
                    }
                }
            }
        }
        DropdownMenu(expanded = menuExpanded, onDismissRequest = onDismissMenu) {
            DropdownMenuItem(
                text = {
                    Text(
                        if (pinned) localizedText("Unpin", "取消置顶")
                        else localizedText("Pin to top", "置顶"),
                    )
                },
                onClick = { onDismissMenu(); onTogglePin() },
            )
            DropdownMenuItem(
                text = {
                    Text(
                        if (row.isGroup) localizedText("Group settings", "群聊设置")
                        else localizedText("Bot details", "机器人详情"),
                    )
                },
                onClick = { onDismissMenu(); onBotDetails() },
            )
            sections.forEach { section ->
                DropdownMenuItem(
                    text = { Text(localizedText("Move to \"${section.name}\"", "移动到「${section.name}」")) },
                    onClick = { onDismissMenu(); onMoveToSection(section.id) },
                )
            }
            DropdownMenuItem(
                text = { Text(localizedText("Unassigned", "未分组")) },
                onClick = { onDismissMenu(); onMoveToSection(null) },
            )
        }
    }
}

@Composable
internal fun DirectorySectionHeader(
    name: String,
    collapsed: Boolean,
    count: Int,
    onClick: () -> Unit,
) {
    val colors = SpatialTheme.colors
    val rotation by animateFloatAsState(
        targetValue = if (collapsed) 0f else 90f,
        animationSpec = SpatialMotion.SnappySpring,
        label = "sectionChevron",
    )
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(SpatialRadii.sm))
            .clickable(onClick = onClick)
            .padding(horizontal = 4.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = name,
            style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium),
            color = colors.textSecondary,
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text = "$count",
            style = MaterialTheme.typography.labelSmall,
            color = colors.textTertiary,
        )
        Spacer(Modifier.width(4.dp))
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = colors.textTertiary,
            modifier = Modifier.size(16.dp).rotate(rotation),
        )
    }
}

@Composable
internal fun SearchFilterRow(selected: SearchFilter, onSelected: (SearchFilter) -> Unit) {
    val colors = SpatialTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        SearchFilter.values().forEach { filter ->
            val active = filter == selected
            SpatialGlassSurface(
                tier = if (active) GlassTier.Floating else GlassTier.Subtle,
                shape = CircleShape,
                containerColor = if (active) colors.accent else colors.glassSubtle,
                shadowElevation = if (active) 4.dp else 0.dp,
                onClick = { onSelected(filter) },
            ) {
                Text(
                    text = localizedText(filter.englishLabel, filter.chineseLabel),
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 9.dp),
                    color = if (active) colors.onAccent else colors.textPrimary,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}

@Composable
internal fun SearchResultsList(
    results: List<SearchResult>,
    loading: Boolean,
    error: String?,
    conversations: List<Conversation>,
    accountName: String,
    onSelect: (SearchResult) -> Unit,
) {
    val colors = SpatialTheme.colors
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(top = 6.dp, bottom = 104.dp),
    ) {
        if (loading) {
            item(key = "search-loading") {
                Box(Modifier.fillMaxWidth().padding(28.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = colors.accent)
                }
            }
        }
        if (error != null) {
            item(key = "search-error") {
                Text(
                    error,
                    modifier = Modifier.fillMaxWidth().padding(20.dp),
                    color = colors.danger,
                )
            }
        }
        items(results, key = { "search-${it.kind}-${it.id}" }) { result ->
            SearchResultRow(
                result = result,
                conversation = conversations.firstOrNull { it.id == result.channelId },
                accountName = accountName,
                members = conversations.firstOrNull { it.id == result.channelId }?.let { groupMembers(it, conversations) }.orEmpty(),
                onClick = { onSelect(result) },
            )
        }
        if (!loading && error == null && results.isEmpty()) {
            item(key = "search-empty") {
                Text(
                    localizedText("No results", "没有找到结果"),
                    modifier = Modifier.fillMaxWidth().padding(20.dp),
                    color = colors.textSecondary,
                )
            }
        }
    }
}

@Composable
private fun SearchResultRow(
    result: SearchResult,
    conversation: Conversation?,
    accountName: String,
    members: List<Conversation>,
    onClick: () -> Unit,
) {
    val colors = SpatialTheme.colors
    SpatialGlassSurface(
        tier = GlassTier.Subtle,
        shape = RoundedCornerShape(SpatialRadii.lg),
        enabled = result.channelId != null,
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (conversation != null) {
                ConversationAvatar(conversation, accountName, members, size = 44.dp)
            } else {
                Box(
                    Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(colors.glassFloating),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(result.title.take(1).uppercase().ifBlank { "O" }, color = colors.textPrimary)
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        result.title,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Medium,
                        color = colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        localizedSearchResultKind(result.kind),
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.textTertiary,
                    )
                }
                if (result.subtitle.isNotBlank()) {
                    Text(
                        result.subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
internal fun FloatingSearchBar(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = SpatialTheme.colors
    SpatialGlassSurface(
        tier = GlassTier.Floating,
        shape = CircleShape,
        shadowElevation = 10.dp,
        onClick = onClick,
        modifier = modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.sm),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Default.Search, contentDescription = null, tint = colors.textSecondary)
            Spacer(Modifier.width(12.dp))
            Text(
                localizedText("Search", "搜索"),
                color = colors.textSecondary,
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
}

@Composable
internal fun ExpandedSearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    focusRequester: FocusRequester,
    onClear: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .imePadding()
            .padding(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.xs),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SpatialGlassTextField(
            value = query,
            onValueChange = onQueryChange,
            modifier = Modifier
                .weight(1f)
                .focusRequester(focusRequester),
            singleLine = true,
            placeholder = localizedText("Search", "搜索"),
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            trailingIcon = {
                if (query.isNotEmpty()) {
                    IconButton(onClick = onClear) {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = localizedText("Clear", "清除"),
                        )
                    }
                }
            },
        )
        SpatialIconOrb(
            icon = Icons.Default.Close,
            contentDescription = localizedText("Close search", "关闭搜索"),
            onClick = onClose,
            size = 50.dp,
        )
    }
}

@Composable
internal fun ConversationAvatar(
    conversation: Conversation,
    accountName: String,
    members: List<Conversation>,
    size: Dp,
    showWorking: Boolean = false,
    ringColor: Color = SpatialTheme.colors.canvasBase,
) {
    if (conversation.isGroup) {
        GroupAvatar(
            conversation = conversation,
            accountName = accountName,
            members = members,
            size = size,
            showWorking = showWorking,
            ringColor = ringColor,
        )
    } else {
        BotAvatar(conversation, size = size, showWorking = showWorking, ringColor = ringColor)
    }
}

@Composable
internal fun GroupAvatar(
    conversation: Conversation,
    accountName: String,
    members: List<Conversation>,
    size: Dp,
    showWorking: Boolean = false,
    ringColor: Color = SpatialTheme.colors.canvasBase,
) {
    val colors = SpatialTheme.colors
    val avatar = rememberDecodedBitmap(conversation.avatarPath, maxSizePx = (size.value * 4).toInt())
    val visibleMembers = members.take(2)
    val memberSize = if (visibleMembers.size == 1) size * (2f / 3f) else size * (5f / 9f)
    val accountSize = if (visibleMembers.isEmpty()) size else memberSize
    Box(Modifier.size(size)) {
        if (avatar != null) {
            Image(
                bitmap = avatar,
                contentDescription = conversation.title,
                modifier = Modifier.size(size).clip(CircleShape),
                contentScale = ContentScale.Crop,
            )
        } else if (visibleMembers.isEmpty()) {
            Box(
                Modifier
                    .size(size)
                    .clip(CircleShape)
                    .background(colors.glassFloating)
                    .border(0.75.dp, colors.glassBorderStart, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.Group,
                    contentDescription = null,
                    tint = colors.textPrimary,
                    modifier = Modifier.size(size * 0.52f),
                )
            }
        } else {
            Box(
                Modifier
                    .align(if (visibleMembers.size == 1) Alignment.TopStart else Alignment.TopCenter)
                    .size(accountSize)
                    .clip(CircleShape)
                    .background(colors.glassFloating)
                    .border(0.75.dp, colors.glassBorderStart, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    accountInitials(accountName),
                    color = colors.textSecondary,
                    fontSize = (size.value * if (visibleMembers.size == 1) 0.17f else 0.11f).sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                )
            }
            visibleMembers.forEachIndexed { index, member ->
                Box(
                    Modifier
                        .align(if (visibleMembers.size == 1 || index == 1) Alignment.BottomEnd else Alignment.BottomStart)
                        .size(memberSize)
                        .clip(CircleShape),
                ) {
                    BotAvatar(member, size = memberSize)
                }
            }
        }
        if (showWorking && conversation.working) {
            val dot = (size.value * 0.26f).coerceIn(10f, 18f).dp
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .size(dot)
                    .clip(CircleShape)
                    .background(colors.success)
                    .border(2.dp, ringColor, CircleShape)
                    .semantics { contentDescription = "Working" },
            )
        }
    }
}

@Composable
internal fun BotAvatar(
    conversation: Conversation,
    size: Dp,
    showWorking: Boolean = false,
    ringColor: Color = SpatialTheme.colors.canvasBase,
) {
    val colors = SpatialTheme.colors
    val fill = conversation.avatarColor.toComposeColor() ?: colors.glassFloating
    val avatar = rememberDecodedBitmap(conversation.avatarPath, maxSizePx = (size.value * 4).toInt())
    Box {
        if (avatar != null) {
            Image(
                bitmap = avatar,
                contentDescription = conversation.title,
                modifier = Modifier.size(size).clip(CircleShape),
                contentScale = ContentScale.Crop,
            )
        } else {
            ServerBotAvatar(conversation.botIcon, fill, size)
        }
        if (showWorking && conversation.working) {
            val dot = (size.value * 0.26f).coerceIn(10f, 18f).dp
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .size(dot)
                    .clip(CircleShape)
                    .background(colors.success)
                    .border(2.dp, ringColor, CircleShape)
                    .semantics { contentDescription = "Working" },
            )
        }
    }
}

@Composable
internal fun ServerBotAvatar(icon: String, fill: Color, size: Dp) {
    Canvas(Modifier.size(size).clip(CircleShape)) {
        drawCircle(fill)
        val edge = this.size.minDimension
        val face = if (fill.luminance() < 0.45f) Color.White else Color.Black
        val left = edge * 0.2f
        val top = edge * 0.2f
        val width = edge * 0.6f
        val height = edge * 0.57f
        when (icon.trim().lowercase()) {
            "tv-head", "dual-screen" -> drawRect(face, Offset(left, top), Size(width, height))
            "pod", "owl" -> drawOval(face, Offset(left, top), Size(width, height))
            else -> drawRoundRect(
                face,
                Offset(left, top),
                Size(width, height),
                CornerRadius(edge * 0.14f),
            )
        }
        if (icon.trim().lowercase() in setOf("terminal", "periscope", "helmet")) {
            drawLine(face, Offset(edge * 0.5f, top), Offset(edge * 0.5f, edge * 0.08f), strokeWidth = edge * 0.05f)
            drawCircle(face, radius = edge * 0.06f, center = Offset(edge * 0.5f, edge * 0.06f))
        }
        val eyeY = edge * 0.42f
        drawCircle(fill, radius = edge * 0.07f, center = Offset(edge * 0.38f, eyeY))
        drawCircle(fill, radius = edge * 0.07f, center = Offset(edge * 0.62f, eyeY))
        drawRoundRect(
            fill,
            Offset(edge * 0.38f, edge * 0.58f),
            Size(edge * 0.24f, edge * 0.06f),
            CornerRadius(edge * 0.03f),
        )
    }
}

internal fun String.toComposeColor(): Color? {
    val value = trim().removePrefix("#")
    if (value.length != 6) return null
    return value.toLongOrNull(16)?.let { Color(it.toInt() or 0xFF000000.toInt()) }
}

private fun accountInitials(accountName: String): String {
    val parts = accountName.trim().split(Regex("\\s+")).filter(String::isNotBlank)
    return parts
        .take(2)
        .mapNotNull { it.firstOrNull()?.uppercaseChar() }
        .joinToString("")
        .ifBlank { accountName.trim().take(1).uppercase().ifBlank { "U" } }
}

private fun conversationTimestampLabel(iso: String?, yesterday: String): String? {
    if (iso.isNullOrBlank()) return null
    val zoned = runCatching { Instant.parse(iso).atZone(ZoneId.systemDefault()) }.getOrNull() ?: return null
    val date = zoned.toLocalDate()
    val today = LocalDate.now(zoned.zone)
    return when {
        date == today -> DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault()).format(zoned)
        date == today.minusDays(1) -> yesterday
        date.isAfter(today.minusDays(7)) -> DateTimeFormatter.ofPattern("EEEE", Locale.getDefault()).format(zoned)
        else -> DateTimeFormatter.ofPattern("M/d/yy", Locale.getDefault()).format(zoned)
    }
}

@Composable
private fun localizedSearchResultKind(kind: String): String = when (kind.lowercase(Locale.ROOT)) {
    "messages" -> localizedText("Messages", "消息")
    "bots" -> localizedText("Robots", "机器人")
    "channels" -> localizedText("Group chats", "群聊")
    "files" -> localizedText("Files", "文件")
    "routines" -> localizedText("Scheduled tasks", "定时任务")
    "links" -> localizedText("Other", "其他")
    else -> kind.replaceFirstChar { it.uppercase() }
}
