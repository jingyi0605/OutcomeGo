package com.outcomego.android.ui.screens.details

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.outcomego.android.data.Conversation
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialFloatingTopBar
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
import com.outcomego.android.ui.formatRoutineStatus
import com.outcomego.android.ui.screens.directory.BotAvatar
import com.outcomego.android.ui.screens.directory.ConversationAvatar
import com.outcomego.android.ui.screens.directory.ServerBotAvatar
import com.outcomego.android.ui.screens.directory.toComposeColor
import com.outcomego.features.AppSettings
import com.outcomego.features.BotAvatarColorOption
import com.outcomego.features.BotAvatarShapeOption
import com.outcomego.features.DropdownSelectorField
import com.outcomego.features.FeatureLoadState
import com.outcomego.features.HapticEffect
import com.outcomego.features.LocalAppHaptics
import com.outcomego.features.LocalAppLanguage
import com.outcomego.features.PickerCatalogs
import com.outcomego.features.Routine
import com.outcomego.features.SelectorFieldStyle
import com.outcomego.features.VolcengineVoiceSelector
import com.outcomego.features.localizedText

@Composable
internal fun BotDetailsScreen(
    conversation: Conversation?,
    routinesState: FeatureLoadState<List<Routine>>? = null,
    onBack: () -> Unit,
    onOpenChat: () -> Unit,
    onComputer: () -> Unit,
    onRoutines: () -> Unit,
    onEdit: () -> Unit,
    onHide: (Conversation) -> Unit,
    onDelete: (Conversation) -> Unit,
    onDuplicate: (Conversation) -> Unit,
    onNotifications: (Conversation, Boolean) -> Unit,
    onShare: () -> Unit,
) {
    var moreMenuVisible by remember { mutableStateOf(false) }
    var notificationsEnabled by remember(conversation?.id, conversation?.notificationsEnabled) {
        mutableStateOf(conversation?.notificationsEnabled ?: true)
    }
    val colors = SpatialTheme.colors

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.xs),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
            ) {
                SpatialIconOrb(
                    icon = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = localizedText("Back to conversations", "返回对话列表"),
                    onClick = onBack,
                )
                Spacer(Modifier.weight(1f))
                SpatialIconOrb(
                    icon = Icons.Default.Share,
                    contentDescription = localizedText("Share bot", "分享机器人"),
                    onClick = onShare,
                )
                Box {
                    SpatialIconOrb(
                        icon = Icons.Default.MoreHoriz,
                        contentDescription = localizedText("More settings", "更多设置"),
                        onClick = { moreMenuVisible = true },
                    )
                    DropdownMenu(
                        expanded = moreMenuVisible,
                        onDismissRequest = { moreMenuVisible = false },
                    ) {
                        DropdownMenuItem(
                            text = { Text(localizedText("Open conversation", "打开对话")) },
                            onClick = { moreMenuVisible = false; onOpenChat() },
                        )
                        DropdownMenuItem(
                            text = { Text(localizedText("Edit profile", "编辑资料")) },
                            onClick = { moreMenuVisible = false; onEdit() },
                        )
                        conversation?.let { row ->
                            DropdownMenuItem(
                                text = { Text(localizedText("Duplicate bot", "复制机器人")) },
                                onClick = { moreMenuVisible = false; onDuplicate(row) },
                            )
                            DropdownMenuItem(
                                text = { Text(localizedText("Hide from sidebar", "从侧边栏隐藏")) },
                                onClick = { moreMenuVisible = false; onHide(row) },
                            )
                            DropdownMenuItem(
                                text = { Text(localizedText("Delete", "删除"), color = colors.danger) },
                                onClick = { moreMenuVisible = false; onDelete(row) },
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(22.dp))
            conversation?.let {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    SpatialGlassSurface(
                        tier = GlassTier.Card,
                        shape = CircleShape,
                        shadowElevation = 10.dp,
                        modifier = Modifier.size(106.dp),
                    ) {
                        Box(Modifier.fillMaxSize().padding(4.dp), contentAlignment = Alignment.Center) {
                            BotAvatar(it, 96.dp)
                        }
                    }
                    Spacer(Modifier.height(14.dp))
                    Text(
                        it.title,
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = colors.textPrimary,
                    )
                    if (it.subtitle.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            it.subtitle,
                            style = MaterialTheme.typography.bodyMedium,
                            color = colors.textSecondary,
                        )
                    }
                    Spacer(Modifier.height(14.dp))
                    SpatialGlassSurface(
                        tier = GlassTier.Floating,
                        shape = CircleShape,
                        onClick = onEdit,
                    ) {
                        Row(
                            Modifier.padding(horizontal = 18.dp, vertical = 9.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(16.dp), tint = colors.accent)
                            Spacer(Modifier.width(6.dp))
                            Text(
                                localizedText("Edit", "编辑"),
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.Medium,
                                color = colors.textPrimary,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(26.dp))
            val routinesStatus = formatRoutineStatus(
                state = routinesState,
                isChinese = LocalAppLanguage.current == AppSettings.Language.Chinese,
            )
            SpatialGroupedSection(tier = GlassTier.Card) {
                CapabilityRow(
                    icon = Icons.Default.AccessTime,
                    title = localizedText("Scheduled routines", "定时任务"),
                    status = routinesStatus,
                    onClick = onRoutines,
                )
                SpatialHairlineDivider(insetStart = 54.dp)
                CapabilityRow(
                    icon = Icons.Default.FolderOpen,
                    title = localizedText("Library", "资料库"),
                    status = null,
                    onClick = onOpenChat,
                )
                SpatialHairlineDivider(insetStart = 54.dp)
                CapabilityRow(
                    icon = Icons.Default.Computer,
                    title = localizedText("Cloud computer", "云电脑"),
                    status = localizedText("Idle", "空闲"),
                    onClick = onComputer,
                )
            }

            Spacer(Modifier.height(18.dp))
            SpatialGroupedSection(
                tier = GlassTier.Card,
                footer = localizedText(
                    "The bot will notify you when work is ready for your attention.",
                    "机器人完成任务或需要你处理时通知你。",
                ),
            ) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Notifications, contentDescription = null, tint = colors.textSecondary)
                    Spacer(Modifier.width(14.dp))
                    Text(
                        localizedText("Notifications", "通知"),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                        color = colors.textPrimary,
                        modifier = Modifier.weight(1f),
                    )
                    Switch(
                        checked = notificationsEnabled,
                        onCheckedChange = {
                            notificationsEnabled = it
                            conversation?.let { row -> onNotifications(row, it) }
                        },
                    )
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun CapabilityRow(
    icon: ImageVector,
    title: String,
    status: String?,
    onClick: () -> Unit,
) {
    val colors = SpatialTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 15.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = colors.textSecondary, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(16.dp))
        Text(
            title,
            style = MaterialTheme.typography.bodyLarge,
            color = colors.textPrimary,
            modifier = Modifier.weight(1f),
        )
        if (!status.isNullOrBlank()) {
            Text(status, style = MaterialTheme.typography.bodyMedium, color = colors.textSecondary)
            Spacer(Modifier.width(8.dp))
        }
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = colors.textTertiary,
        )
    }
}

@Composable
internal fun CreateConversationScreen(
    bots: List<Conversation>,
    onCreateBot: (String, String, String, String, String) -> Unit,
    onCreateGroup: (String, List<String>) -> Unit,
    onBack: () -> Unit,
) {
    val haptic = LocalAppHaptics.current
    val colors = SpatialTheme.colors
    var group by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var instructions by remember { mutableStateOf("") }
    var icon by remember { mutableStateOf("chip") }
    var color by remember { mutableStateOf("#A47952") }
    val selected = remember { mutableStateOf(emptySet<String>()) }

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(top = 74.dp, bottom = 32.dp, start = SpatialSpacing.md, end = SpatialSpacing.md),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf(false to localizedText("Bot", "机器人"), true to localizedText("Group", "群聊")).forEach { (isGroup, label) ->
                    val active = group == isGroup
                    SpatialGlassSurface(
                        tier = if (active) GlassTier.Floating else GlassTier.Subtle,
                        shape = CircleShape,
                        containerColor = if (active) colors.accent else colors.glassSubtle,
                        onClick = { group = isGroup },
                    ) {
                        Text(
                            label,
                            color = if (active) colors.onAccent else colors.textPrimary,
                            style = MaterialTheme.typography.labelLarge,
                            modifier = Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
                        )
                    }
                }
            }
            SpatialGroupedSection(tier = GlassTier.Card) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SpatialGlassTextField(name, { name = it }, label = localizedText("Name", "名称"), singleLine = true)
                    SpatialGlassTextField(description, { description = it }, label = localizedText("Description", "描述"), singleLine = false)
                    if (group) {
                        Text(
                            localizedText("Members", "成员"),
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = colors.textPrimary,
                        )
                        bots.forEach { bot ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(
                                    checked = bot.botId?.let(selected.value::contains) == true,
                                    onCheckedChange = { checked ->
                                        selected.value = if (checked) selected.value + bot.botId.orEmpty() else selected.value - bot.botId.orEmpty()
                                    },
                                )
                                Text(bot.title, color = colors.textPrimary)
                            }
                        }
                    } else {
                        SpatialGlassTextField(
                            instructions,
                            { instructions = it },
                            label = localizedText("Instructions", "说明"),
                            singleLine = false,
                            minLines = 5,
                        )
                        BotAvatarFields(
                            icon = icon,
                            onIconChange = { icon = it },
                            color = color,
                            onColorChange = { color = it },
                        )
                    }
                }
            }
            SpatialPrimaryButton(
                label = localizedText("Create", "创建"),
                onClick = {
                    haptic.play(HapticEffect.Light)
                    if (group) onCreateGroup(name, selected.value.filter(String::isNotBlank))
                    else onCreateBot(name, description, instructions, icon, color)
                },
                enabled = name.isNotBlank() && (!group || selected.value.isNotEmpty()),
            )
        }
        SpatialFloatingTopBar(
            title = if (group) localizedText("Create group", "创建群聊") else localizedText("Create bot", "创建机器人"),
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

@Composable
internal fun ConversationProfileScreen(
    conversation: Conversation?,
    bots: List<Conversation>,
    accountName: String = "",
    voiceProvider: String = "volcengine",
    onSaveBot: (Conversation, String, String, String, String, String, String?, String?, Boolean) -> Unit,
    onSaveGroup: (Conversation, String, String, List<String>) -> Unit,
    onBack: () -> Unit,
) {
    val haptic = LocalAppHaptics.current
    val colors = SpatialTheme.colors
    if (conversation == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(localizedText("Conversation is unavailable.", "对话不可用。"), color = colors.textSecondary)
        }
        return
    }
    var synced by remember(conversation.id) { mutableStateOf(conversation) }
    var name by remember(conversation.id) { mutableStateOf(conversation.title) }
    var botTitle by remember(conversation.id) { mutableStateOf(conversation.botTitle) }
    var description by remember(conversation.id) { mutableStateOf(conversation.subtitle) }
    var instructions by remember(conversation.id) { mutableStateOf(conversation.botInstructions) }
    var voice by remember(conversation.id) { mutableStateOf(conversation.botVoice) }
    var icon by remember(conversation.id) { mutableStateOf(conversation.botIcon.ifBlank { "chip" }) }
    var color by remember(conversation.id) { mutableStateOf(conversation.avatarColor.ifBlank { "#A47952" }) }
    var resetAvatar by remember(conversation.id) { mutableStateOf(false) }
    val selected = remember(conversation.id) { mutableStateOf(conversation.memberBotIds.toSet()) }

    LaunchedEffect(conversation) {
        val previous = synced
        if (conversation == previous) return@LaunchedEffect
        if (name == previous.title) name = conversation.title
        if (botTitle == previous.botTitle) botTitle = conversation.botTitle
        if (description == previous.subtitle) description = conversation.subtitle
        if (instructions == previous.botInstructions) instructions = conversation.botInstructions
        if (voice == previous.botVoice) voice = conversation.botVoice
        val previousIcon = previous.botIcon.ifBlank { "chip" }
        val previousColor = previous.avatarColor.ifBlank { "#A47952" }
        if (!resetAvatar && icon.trim().equals(previousIcon.trim(), ignoreCase = true)) {
            icon = conversation.botIcon.ifBlank { "chip" }
        }
        if (!resetAvatar && color.trim().equals(previousColor.trim(), ignoreCase = true)) {
            color = conversation.avatarColor.ifBlank { "#A47952" }
        }
        if (selected.value == previous.memberBotIds.toSet()) {
            selected.value = conversation.memberBotIds.toSet()
        }
        synced = conversation
    }

    val initialIcon = conversation.botIcon.ifBlank { "chip" }
    val initialColor = conversation.avatarColor.ifBlank { "#A47952" }
    val hasCustomAvatar = conversation.hasCustomAvatar
    val avatarChanged = !icon.trim().equals(initialIcon.trim(), ignoreCase = true) ||
        !color.trim().equals(initialColor.trim(), ignoreCase = true)
    val showingCustomAvatar = hasCustomAvatar && !resetAvatar && !avatarChanged

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(top = 78.dp, bottom = 32.dp, start = SpatialSpacing.md, end = SpatialSpacing.md),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                SpatialGlassSurface(
                    tier = GlassTier.Card,
                    shape = CircleShape,
                    shadowElevation = 8.dp,
                    modifier = Modifier.size(92.dp),
                ) {
                    Box(Modifier.fillMaxSize().padding(4.dp), contentAlignment = Alignment.Center) {
                        if (conversation.isGroup) {
                            val members = conversation.memberBotIds.mapNotNull { memberId ->
                                bots.firstOrNull { it.botId == memberId }
                            }
                            ConversationAvatar(conversation, accountName, members, size = 80.dp)
                        } else if (showingCustomAvatar) {
                            BotAvatar(conversation, size = 80.dp)
                        } else {
                            ServerBotAvatar(icon, color.toComposeColor() ?: Color(0xFFA47952), 80.dp)
                        }
                    }
                }
            }
            SpatialGroupedSection(tier = GlassTier.Card) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SpatialGlassTextField(name, { name = it }, label = localizedText("Name", "名称"), singleLine = true)
                    if (!conversation.isGroup) {
                        SpatialGlassTextField(
                            botTitle,
                            { botTitle = it },
                            label = localizedText("Label (optional)", "标签（可选）"),
                            singleLine = true,
                        )
                    }
                    SpatialGlassTextField(description, { description = it }, label = localizedText("Description", "描述"), singleLine = false)
                    if (conversation.isGroup) {
                        Text(
                            localizedText("Members", "成员"),
                            fontWeight = FontWeight.SemiBold,
                            color = colors.textPrimary,
                        )
                        bots.forEach { bot ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(
                                    checked = bot.botId?.let(selected.value::contains) == true,
                                    onCheckedChange = { checked ->
                                        selected.value = if (checked) selected.value + bot.botId.orEmpty() else selected.value - bot.botId.orEmpty()
                                    },
                                )
                                Text(bot.title, color = colors.textPrimary)
                            }
                        }
                    } else {
                        SpatialGlassTextField(
                            instructions,
                            { instructions = it },
                            label = localizedText("Instructions", "说明"),
                            singleLine = false,
                            minLines = 5,
                        )
                        if (voiceProvider == "volcengine") {
                            VolcengineVoiceSelector(
                                selectedVoiceId = voice,
                                automaticLabel = localizedText("Server default", "服务器默认"),
                                onSelectVoice = { voice = it },
                                label = localizedText("Realtime voice", "实时语音"),
                                supportingText = localizedText("Speaker voice for realtime calls. Leave as Server default to follow global voice settings.", "实时通话音色。保持“服务器默认”以跟随全局语音设置。"),
                                style = SelectorFieldStyle.Outlined,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        } else {
                            SpatialGlassTextField(
                                voice,
                                { voice = it },
                                label = localizedText("Realtime voice", "实时语音"),
                                placeholder = localizedText("Provider-specific voice or speaker ID.", "服务商专用的声音或说话人 ID。"),
                                singleLine = true,
                            )
                        }
                        BotAvatarFields(
                            icon = icon,
                            onIconChange = { icon = it },
                            color = color,
                            onColorChange = { color = it },
                        )
                        if (hasCustomAvatar) {
                            if (showingCustomAvatar) {
                                Text(
                                    localizedText(
                                        "Using custom avatar. Changing Icon or Color will replace it with the robot avatar.",
                                        "当前使用自定义头像。修改图标或颜色将替换为默认机器人头像。",
                                    ),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textSecondary,
                                )
                                SpatialSecondaryButton(
                                    label = localizedText("Reset to default avatar", "恢复默认机器人头像"),
                                    onClick = {
                                        icon = "chip"
                                        color = "#A47952"
                                        resetAvatar = true
                                    },
                                )
                            } else {
                                Text(
                                    localizedText(
                                        "Saving will replace the current custom avatar with this robot avatar.",
                                        "保存后将使用此机器人头像替换当前自定义头像。",
                                    ),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textSecondary,
                                )
                                TextButton(
                                    onClick = {
                                        icon = initialIcon
                                        color = initialColor
                                        resetAvatar = false
                                    },
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text(localizedText("Keep custom avatar", "保留自定义头像"), color = colors.accent)
                                }
                            }
                        }
                    }
                }
            }
            SpatialPrimaryButton(
                label = localizedText("Save", "保存"),
                onClick = {
                    haptic.play(HapticEffect.Light)
                    if (conversation.isGroup) onSaveGroup(conversation, name, description, selected.value.toList())
                    else {
                        val sendAvatar = resetAvatar || avatarChanged
                        onSaveBot(
                            conversation,
                            name,
                            botTitle,
                            description,
                            instructions,
                            voice,
                            if (sendAvatar) icon else null,
                            if (sendAvatar) color else null,
                            resetAvatar,
                        )
                    }
                },
                enabled = name.isNotBlank(),
            )
        }
        SpatialFloatingTopBar(
            title = localizedText("Edit profile", "编辑资料"),
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

@Composable
private fun BotAvatarFields(
    icon: String,
    onIconChange: (String) -> Unit,
    color: String,
    onColorChange: (String) -> Unit,
) {
    val useChinese = localizedText("en", "zh") == "zh"
    val previewFill = color.toComposeColor() ?: Color(0xFFA47952)
    val shapeOptions = remember(icon) {
        val trimmed = icon.trim()
        if (trimmed.isNotEmpty() && PickerCatalogs.robotAvatarShapes.none { it.id.equals(trimmed, ignoreCase = true) }) {
            listOf(BotAvatarShapeOption(trimmed, trimmed, trimmed)) + PickerCatalogs.robotAvatarShapes
        } else {
            PickerCatalogs.robotAvatarShapes
        }
    }
    val selectedShape = shapeOptions.firstOrNull { it.id.equals(icon.trim(), ignoreCase = true) }
        ?: shapeOptions.first()

    val colorOptions = remember(color) {
        val trimmed = color.trim()
        if (trimmed.isNotEmpty() && PickerCatalogs.botAvatarColors.none { it.hex.equals(trimmed, ignoreCase = true) }) {
            listOf(BotAvatarColorOption(trimmed, trimmed, trimmed)) + PickerCatalogs.botAvatarColors
        } else {
            PickerCatalogs.botAvatarColors
        }
    }
    val selectedColor = colorOptions.firstOrNull { it.hex.equals(color.trim(), ignoreCase = true) }
        ?: colorOptions.first()

    DropdownSelectorField(
        selectedValue = selectedShape,
        options = shapeOptions,
        optionLabel = { if (useChinese) it.labelZh else it.labelEn },
        onSelect = { onIconChange(it.id) },
        label = localizedText("Icon", "图标"),
        isSameValue = { a, b -> a.id.equals(b.id, ignoreCase = true) },
        leadingContent = { option -> ServerBotAvatar(option.id, previewFill, 22.dp) },
        modifier = Modifier.fillMaxWidth(),
    )

    DropdownSelectorField(
        selectedValue = selectedColor,
        options = colorOptions,
        optionLabel = { option ->
            val name = if (useChinese) option.labelZh else option.labelEn
            if (name.equals(option.hex, ignoreCase = true)) option.hex else "$name (${option.hex})"
        },
        onSelect = { onColorChange(it.hex) },
        label = localizedText("Color", "颜色"),
        isSameValue = { a, b -> a.hex.equals(b.hex, ignoreCase = true) },
        leadingContent = { option ->
            Box(
                Modifier
                    .size(18.dp)
                    .clip(CircleShape)
                    .background(option.hex.toComposeColor() ?: previewFill),
            )
        },
        modifier = Modifier.fillMaxWidth(),
    )
}
