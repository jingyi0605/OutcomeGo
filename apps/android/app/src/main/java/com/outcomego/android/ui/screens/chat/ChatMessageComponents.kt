package com.outcomego.android.ui.screens.chat

import android.icu.text.BreakIterator
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitHorizontalTouchSlopOrCancellation
import androidx.compose.foundation.gestures.horizontalDrag
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material.icons.outlined.IosShare
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.outcomego.android.R
import com.outcomego.android.data.ChannelActivity
import com.outcomego.android.data.ChatMessage
import com.outcomego.android.data.Conversation
import com.outcomego.android.data.Delivery
import com.outcomego.android.data.OutcomeUpdateCard
import com.outcomego.android.data.RoutineEvent
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialMotion
import com.outcomego.android.ui.designsystem.SpatialPulseOrb
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.android.ui.screens.directory.ConversationAvatar
import com.outcomego.features.Attachment
import com.outcomego.features.AttachmentState
import com.outcomego.features.ChatAttachmentStrip
import com.outcomego.features.DocumentPreview
import com.outcomego.features.FeatureOperationState
import com.outcomego.features.HapticEffect
import com.outcomego.features.LocalAppHaptics
import com.outcomego.features.MarkdownMessage
import com.outcomego.features.MessageAction
import com.outcomego.features.ReactionState
import com.outcomego.features.ReactionsAndActionsRow
import com.outcomego.features.RichMessageCardScreen
import com.outcomego.features.isQuestion
import com.outcomego.features.isSecretRequest
import com.outcomego.features.localizedText
import com.outcomego.features.rememberDecodedBitmap
import com.outcomego.platform.NativeAttachmentPreview
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
private fun streamedReplyBody(source: String, streaming: Boolean): String {
    val wasStreamed = remember { streaming }
    if (!wasStreamed) return source
    val boundaries = remember(source) {
        val iterator = BreakIterator.getCharacterInstance()
        iterator.setText(source)
        buildList {
            var end = iterator.next()
            while (end != BreakIterator.DONE) {
                add(end)
                end = iterator.next()
            }
        }
    }
    var shown by remember { mutableStateOf(source.take(boundaries.firstOrNull() ?: 0)) }
    LaunchedEffect(source) {
        if (source == shown) return@LaunchedEffect
        if (coroutineContext[MotionDurationScale]?.scaleFactor == 0f || !source.startsWith(shown)) {
            shown = source
            return@LaunchedEffect
        }
        val pending = boundaries.dropWhile { it <= shown.length }
        val batch = (pending.size + 4) / 5
        var offset = 0
        while (offset < pending.size) {
            delay(24)
            offset = (offset + batch).coerceAtMost(pending.size)
            shown = source.take(pending[offset - 1])
        }
    }
    return if (source.startsWith(shown)) shown else source
}

@Composable
internal fun MessageBubble(
    message: ChatMessage,
    onRetry: (String) -> Unit,
    isTarget: Boolean,
    operation: FeatureOperationState,
    onDownload: (String, Attachment) -> Unit,
    onSaveAttachment: (String, Attachment) -> Unit,
    onShareAttachment: (Attachment) -> Unit,
    onForwardAttachment: (Attachment) -> Unit,
    onAction: (String, String, Map<String, String>) -> Unit,
    onReaction: (String, String) -> Unit,
    onMessageAction: (String, MessageAction) -> Unit,
    onContext: (String) -> Unit,
    onReply: (String) -> Unit,
    onOpenRoutine: () -> Unit,
    replyOriginal: ChatMessage?,
    onOpenOriginal: (String) -> Unit,
    onOpenOutcome: (String) -> Unit = {},
    loadOutcomeStatus: suspend (String) -> String? = { null },
    streaming: Boolean = false,
) {
    message.routineEvent?.let { event ->
        RoutineEventRow(message.id, event, onOpenRoutine)
        return
    }
    message.outcomeUpdateCard?.let { card ->
        OutcomeUpdateCardRow(message.id, card, loadOutcomeStatus, onOpenOutcome) { onReply(message.id) }
        return
    }
    var previewAttachment by remember(message.id) { mutableStateOf<Attachment?>(null) }
    val context = LocalContext.current
    previewAttachment?.let { attachment ->
        AttachmentGalleryDialog(
            attachments = message.attachments,
            initialId = attachment.id,
            onDismiss = { previewAttachment = null },
            onOpenDocument = { item ->
                NativeAttachmentPreview.open(context, item).onFailure {
                    previewAttachment = null
                }
            },
            onSave = { onSaveAttachment(message.id, it) },
            onShare = onShareAttachment,
            onForward = onForwardAttachment,
        )
    }
    val swipeScope = rememberCoroutineScope()
    val haptics = LocalAppHaptics.current
    val density = LocalDensity.current
    val colors = SpatialTheme.colors
    val replyThresholdPx = with(density) { 56.dp.toPx() }
    val maxSwipePx = with(density) { 84.dp.toPx() }
    val swipe = remember(message.id) { Animatable(0f) }
    val canSwipeReply = !streaming && !message.isMine && message.delivery == Delivery.SENT
    val animateReplySize = remember { streaming }

    Box(Modifier.fillMaxWidth()) {
        Icon(
            Icons.AutoMirrored.Filled.Reply,
            contentDescription = null,
            tint = colors.accent,
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .padding(end = 8.dp)
                .size(22.dp)
                .alpha((-swipe.value / replyThresholdPx).coerceIn(0f, 1f)),
        )
        Row(
            Modifier
                .fillMaxWidth()
                .offset { IntOffset(swipe.value.roundToInt(), 0) }
                .then(
                    if (!canSwipeReply) Modifier else Modifier.pointerInput(message.id) {
                        awaitEachGesture {
                            var crossed = false
                            val down = awaitFirstDown(requireUnconsumed = false)
                            fun drag(delta: Float) {
                                val next = (swipe.value + delta).coerceIn(-maxSwipePx, 0f)
                                swipeScope.launch { swipe.snapTo(next) }
                                val nowCrossed = -next >= replyThresholdPx
                                if (nowCrossed && !crossed) haptics.play(HapticEffect.Light)
                                crossed = nowCrossed
                            }
                            // Only a leftward drag belongs to reply; a rightward drag stays unconsumed
                            // so the screen-level swipe-back gesture can take it.
                            val start = awaitHorizontalTouchSlopOrCancellation(down.id) { change, over ->
                                if (over < 0f) {
                                    change.consume()
                                    drag(over)
                                }
                            }
                            if (start != null) {
                                horizontalDrag(start.id) { change ->
                                    change.consume()
                                    drag(change.positionChange().x)
                                }
                                if (crossed) onReply(message.id)
                            }
                            swipeScope.launch { swipe.animateTo(0f) }
                        }
                    },
                ),
            horizontalArrangement = if (message.isMine) Arrangement.End else Arrangement.Start,
        ) {
            Column(
                Modifier.fillMaxWidth(if (message.isMine) 0.82f else 0.88f),
                horizontalAlignment = if (message.isMine) Alignment.End else Alignment.Start,
            ) {
                if (!message.isMine) {
                    Text(
                        message.author,
                        Modifier.padding(start = 6.dp, bottom = 4.dp),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = 0.2.sp,
                        ),
                        color = colors.textSecondary,
                    )
                }
                val bubbleShape = RoundedCornerShape(
                    topStart = 20.dp,
                    topEnd = 20.dp,
                    bottomStart = if (message.isMine) 20.dp else 6.dp,
                    bottomEnd = if (message.isMine) 6.dp else 20.dp,
                )
                val bubbleBorder = when {
                    isTarget -> BorderStroke(1.25.dp, colors.accent)
                    message.isMine -> {
                        val isLightNeutral = !colors.isDark && colors.userBubbleStart.luminance() > 0.7f
                        val topRim = when {
                            isLightNeutral -> Color(0xFF0F172A).copy(alpha = 0.09f)
                            colors.isDark -> Color.White.copy(alpha = 0.16f)
                            else -> Color.White.copy(alpha = 0.26f)
                        }
                        val bottomRim = when {
                            isLightNeutral -> Color(0xFF0F172A).copy(alpha = 0.04f)
                            colors.isDark -> Color.White.copy(alpha = 0.05f)
                            else -> Color.White.copy(alpha = 0.06f)
                        }
                        BorderStroke(0.75.dp, Brush.verticalGradient(listOf(topRim, bottomRim)))
                    }
                    else -> BorderStroke(
                        0.75.dp,
                        Brush.verticalGradient(listOf(colors.glassBorderStart, colors.glassBorderEnd)),
                    )
                }
                val assistantFill = if (isTarget) {
                    lerp(colors.assistantSurface, colors.accent, 0.10f)
                } else {
                    colors.assistantSurface
                }
                val lightShadowColor = Color(0xFF0F172A)
                val containerModifier = Modifier
                    .then(
                        if (!colors.isDark) {
                            Modifier.shadow(
                                elevation = 2.dp,
                                shape = bubbleShape,
                                ambientColor = lightShadowColor.copy(alpha = 0.05f),
                                spotColor = lightShadowColor.copy(alpha = 0.07f),
                            )
                        } else {
                            Modifier
                        },
                    )
                    .clip(bubbleShape)
                    .then(
                        if (message.isMine) {
                            Modifier.background(
                                Brush.verticalGradient(listOf(colors.userBubbleStart, colors.userBubbleEnd)),
                                bubbleShape,
                            )
                        } else {
                            Modifier.background(assistantFill, bubbleShape)
                        },
                    )

                Surface(
                    modifier = containerModifier
                        .then(if (animateReplySize) Modifier.animateContentSize(SpatialMotion.ContentSizeSpring) else Modifier)
                        .testTag("message-row-${message.body.hashCode()}"),
                    shape = bubbleShape,
                    color = Color.Transparent,
                    border = bubbleBorder,
                ) {
                    Column(
                        Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        message.replyToMessageId?.let { reply ->
                            ReplyQuote(
                                original = replyOriginal,
                                ownMessage = message.isMine,
                                onOpen = { onOpenOriginal(reply) },
                            )
                        }
                        if (message.attachments.isNotEmpty()) {
                            ChatAttachmentStrip(
                                attachments = message.attachments,
                                onPreview = { attachment, _ ->
                                    previewAttachment = attachment
                                    if (!attachment.isImage && attachment.localUri == null) onDownload(message.id, attachment)
                                },
                                onDownload = { attachment, _ -> onDownload(message.id, attachment) },
                                modifier = Modifier.testTag("message-attachments-${message.id}"),
                            )
                        }
                        val repeatsFileName = message.attachments.singleOrNull()?.let { it.name == message.body } == true ||
                            (message.attachments.isNotEmpty() && (message.metadata["type"] as? kotlinx.serialization.json.JsonPrimitive)?.content == "attachment")
                        val suppressesFallbackBody = message.richMessage?.let { it.isQuestion || it.isSecretRequest } == true
                        message.displayBody?.takeUnless { suppressesFallbackBody || repeatsFileName }?.let { body ->
                            MarkdownMessage(
                                markdown = streamedReplyBody(body, streaming),
                                modifier = Modifier.testTag("message-body-${message.id}"),
                                contentColor = if (message.isMine) colors.onUserBubble else colors.textPrimary,
                                containerColor = if (message.isMine) colors.userBubbleStart else assistantFill,
                            )
                        }
                        message.richMessage?.let { rich ->
                            RichMessageCardScreen(
                                message = rich,
                                operation = operation,
                                onAction = { action, values -> onAction(message.id, action.id, values) },
                            )
                        }
                        if (message.reactions.isNotEmpty() || (message.richMessage != null && !suppressesFallbackBody)) {
                            ReactionsAndActionsRow(
                                state = ReactionState(message.reactions, operation),
                                onReaction = { emoji -> onReaction(message.id, emoji) },
                                onAction = { action -> onMessageAction(message.id, action) },
                            )
                        }
                        if (message.replyToMessageId == null && (message.contextMessageId != null || message.threadId != null)) {
                            TextButton(onClick = { onContext(message.id) }) {
                                Text(
                                    stringResource(R.string.chat_show_context),
                                    color = if (message.isMine) colors.onUserBubble else colors.accent,
                                )
                            }
                        }
                        if (message.isMine) {
                            val status = when (message.delivery) {
                                Delivery.SENDING -> "Sending…"
                                Delivery.SENT -> localizedText("Sent", "已发送")
                                Delivery.FAILED -> localizedText("Not sent", "未发送")
                            }
                            Text(
                                status,
                                Modifier
                                    .align(Alignment.End)
                                    .testTag("delivery-status-${message.body.hashCode()}"),
                                style = MaterialTheme.typography.labelSmall,
                                color = colors.onUserBubble.copy(alpha = 0.68f),
                            )
                            if (message.delivery == Delivery.FAILED) {
                                Row(
                                    modifier = Modifier
                                        .align(Alignment.End)
                                        .clip(RoundedCornerShape(8.dp))
                                        .clickable { haptics.play(HapticEffect.Light); onRetry(message.id) }
                                        .padding(horizontal = 10.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(
                                        Icons.Default.Refresh,
                                        contentDescription = null,
                                        modifier = Modifier.size(14.dp),
                                        tint = colors.onUserBubble,
                                    )
                                    Spacer(Modifier.width(4.dp))
                                    Text(
                                        localizedText("Retry", "重试"),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = colors.onUserBubble,
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
internal fun BotActivityRow(
    activity: ChannelActivity?,
    bot: Conversation?,
    accountName: String,
    members: List<Conversation>,
) {
    val colors = SpatialTheme.colors
    var shown by remember { mutableStateOf(activity) }
    if (activity != null) shown = activity
    AnimatedVisibility(
        visible = activity != null,
        enter = fadeIn(tween(180, easing = FastOutSlowInEasing)) + scaleIn(
            tween(180, easing = FastOutSlowInEasing),
            initialScale = 0.92f,
            transformOrigin = TransformOrigin(0f, 0.5f),
        ),
        exit = fadeOut(tween(140, easing = FastOutSlowInEasing)) + scaleOut(
            tween(140, easing = FastOutSlowInEasing),
            targetScale = 0.92f,
            transformOrigin = TransformOrigin(0f, 0.5f),
        ),
    ) {
        val label = shown?.label().orEmpty()
        val pulse = rememberInfiniteTransition(label = "activity-pulse").animateFloat(
            initialValue = 0.52f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(900, easing = FastOutSlowInEasing), RepeatMode.Reverse),
            label = "activity-alpha",
        )
        SpatialGlassSurface(
            tier = GlassTier.Subtle,
            shape = CircleShape,
            modifier = Modifier
                .padding(vertical = 2.dp)
                .height(36.dp)
                .testTag("bot-activity")
                .semantics { contentDescription = label },
        ) {
            Row(
                Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (bot != null) {
                    ConversationAvatar(
                        conversation = bot,
                        accountName = accountName,
                        members = members,
                        size = 22.dp,
                        ringColor = colors.canvasBase,
                    )
                } else {
                    SpatialPulseOrb(color = colors.accent, size = 8.dp)
                }
                AnimatedContent(
                    targetState = label,
                    transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(120)) },
                    label = "activity-caption",
                ) { text ->
                    Text(
                        text,
                        Modifier.alpha(pulse.value),
                        style = MaterialTheme.typography.labelLarge,
                        color = colors.textSecondary,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

@Composable
internal fun VoiceMemberPickerDialog(
    members: List<Conversation>,
    onDismiss: () -> Unit,
    onStart: (participants: List<String>, speaker: String?) -> Unit,
) {
    val ids = members.mapNotNull { it.botId }
    var selected by remember(ids) { mutableStateOf(ids.toSet()) }
    var speaker by remember(ids) { mutableStateOf(ids.firstOrNull()) }
    val chosen = ids.filter { it in selected }
    val effectiveSpeaker = speaker?.takeIf { it in selected } ?: chosen.firstOrNull()
    val colors = SpatialTheme.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.glassOverlay,
        title = { Text(localizedText("Voice participants", "语音参与者"), color = colors.textPrimary) },
        text = {
            Column(Modifier.testTag("live-voice-member-picker"), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    localizedText("Choose who can answer, and who speaks by default.", "选择谁可以回答，以及默认由谁发言。"),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
                Spacer(Modifier.height(8.dp))
                members.forEach { member ->
                    val botId = member.botId ?: return@forEach
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .testTag("live-voice-member-$botId"),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(
                            checked = botId in selected,
                            onCheckedChange = { checked -> selected = if (checked) selected + botId else selected - botId },
                        )
                        Text(
                            member.title,
                            Modifier.weight(1f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            color = colors.textPrimary,
                        )
                        RadioButton(
                            selected = botId == effectiveSpeaker,
                            enabled = botId in selected,
                            onClick = { speaker = botId },
                        )
                    }
                }
                Text(
                    localizedText("The round button marks the default speaker.", "圆形按钮表示默认发言人。"),
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.textTertiary,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onStart(chosen, effectiveSpeaker) },
                enabled = chosen.isNotEmpty(),
                modifier = Modifier.testTag("live-voice-start-group"),
            ) { Text(localizedText("Start group call", "开始群聊通话"), color = colors.accent) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(localizedText("Cancel", "取消"), color = colors.textSecondary)
            }
        },
    )
}

@Composable
internal fun VoiceConversationCard(messages: List<ChatMessage>, botName: String) {
    var expanded by remember(messages.first().id) { mutableStateOf(false) }
    val colors = SpatialTheme.colors
    SpatialGlassSurface(
        tier = GlassTier.Card,
        shape = RoundedCornerShape(SpatialRadii.md),
        onClick = { expanded = !expanded },
        modifier = Modifier
            .fillMaxWidth()
            .animateContentSize(SpatialMotion.ContentSizeSpring)
            .testTag("voice-conversation-card"),
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 11.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Mic, contentDescription = null, tint = colors.accent, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(
                    localizedText("Voice conversation · ${messages.size} messages", "语音对话 · ${messages.size} 条消息"),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = colors.textPrimary,
                )
                val preview = messages.firstOrNull { it.isMine }?.body?.trim().orEmpty()
                Text(
                    if (expanded) "" else preview,
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 8.dp)
                        .testTag("voice-conversation-preview"),
                    style = MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic),
                    color = colors.textTertiary,
                    textAlign = TextAlign.End,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Icon(
                    if (expanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                    contentDescription = null,
                    tint = colors.textSecondary,
                )
            }
            if (expanded) {
                Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    messages.forEach { message ->
                        Text(
                            "${if (message.isMine) localizedText("You", "你") else botName}: ${message.body}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = colors.textSecondary,
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun AgentExchangeRow(
    count: Int,
    incoming: Boolean,
    peerName: String?,
    peerBot: Conversation?,
    accountName: String,
    members: List<Conversation>,
    onClick: () -> Unit,
) {
    val colors = SpatialTheme.colors
    val name = peerName?.takeIf(String::isNotBlank)
        ?: localizedText("another bot", "另一个机器人")
    val label = when {
        count == 1 && incoming -> localizedText("Message from $name", "来自${name}的消息")
        count == 1 -> localizedText("Messaged $name", "已向${name}发送消息")
        else -> localizedText("$count messages with $name", "与${name}的${count}条消息")
    }
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        SpatialGlassSurface(
            tier = GlassTier.Subtle,
            shape = CircleShape,
            onClick = onClick,
            modifier = Modifier
                .testTag("agent-exchange-row")
                .semantics {
                    contentDescription = label
                    role = Role.Button
                },
        ) {
            Row(
                Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    when {
                        count == 1 && incoming -> localizedText("Message from", "来自")
                        count == 1 -> localizedText("Messaged", "已发送给")
                        else -> localizedText("$count messages with", "${count}条消息，与")
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                peerBot?.let { target ->
                    ConversationAvatar(
                        conversation = target,
                        accountName = accountName,
                        members = members,
                        size = 25.dp,
                        ringColor = colors.canvasBase,
                    )
                }
                Text(
                    name,
                    style = MaterialTheme.typography.labelMedium,
                    color = colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun RoutineEventRow(messageId: String, event: RoutineEvent, onOpen: () -> Unit) {
    val colors = SpatialTheme.colors
    val label = when (event.action) {
        "created" -> localizedText("New routine “${event.name}”", "新建例程“${event.name}”")
        "updated" -> localizedText("Updated routine “${event.name}”", "已更新例程“${event.name}”")
        "enabled" -> localizedText("Enabled routine “${event.name}”", "已启用例程“${event.name}”")
        "disabled" -> localizedText("Disabled routine “${event.name}”", "已停用例程“${event.name}”")
        else -> localizedText("Deleted routine “${event.name}”", "已删除例程“${event.name}”")
    }
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        SpatialGlassSurface(
            tier = GlassTier.Subtle,
            shape = CircleShape,
            enabled = event.canOpen,
            onClick = onOpen,
            modifier = Modifier.testTag("routine-event-$messageId"),
        ) {
            Row(
                Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Default.AccessTime,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = colors.textSecondary,
                )
                Spacer(Modifier.width(6.dp))
                Text(label, style = MaterialTheme.typography.labelMedium, color = colors.textSecondary)
            }
        }
    }
}

@Composable
private fun ReplyQuote(original: ChatMessage?, ownMessage: Boolean, onOpen: () -> Unit) {
    val colors = SpatialTheme.colors
    val preview = original?.let { message ->
        val text = (message.displayBody ?: "").replace(Regex("\\s+"), " ").trim()
        text.ifEmpty {
            if (message.attachments.isNotEmpty()) localizedText("Attachment", "附件") else ""
        }
    }.orEmpty().ifEmpty { localizedText("View original message", "查看原消息") }
    val tint = if (ownMessage) colors.onUserBubble else colors.textSecondary
    val quoteShape = RoundedCornerShape(10.dp)
    Row(
        Modifier
            .clip(quoteShape)
            .background(tint.copy(alpha = 0.10f))
            .border(0.5.dp, tint.copy(alpha = 0.16f), quoteShape)
            .clickable(onClick = onOpen)
            .padding(horizontal = 10.dp, vertical = 5.dp)
            .testTag("reply-quote"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.AutoMirrored.Filled.Reply,
            contentDescription = null,
            modifier = Modifier.size(12.dp),
            tint = tint,
        )
        Spacer(Modifier.width(5.dp))
        Text(
            preview,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = MaterialTheme.typography.labelMedium,
            color = tint,
        )
    }
}

@Composable
internal fun AttachmentGalleryDialog(
    attachments: List<Attachment>,
    initialId: String,
    onDismiss: () -> Unit,
    onOpenDocument: (Attachment) -> Unit,
    onSave: (Attachment) -> Unit,
    onShare: (Attachment) -> Unit,
    onForward: (Attachment) -> Unit,
    onEnsureDownloaded: (Attachment) -> Unit = {},
) {
    var index by remember(initialId) {
        mutableStateOf(attachments.indexOfFirst { it.id == initialId }.coerceAtLeast(0))
    }
    val current = attachments.getOrNull(index) ?: return
    LaunchedEffect(current.id, current.localUri) {
        if (current.localUri == null && current.state != AttachmentState.Failed) {
            onEnsureDownloaded(current)
        }
    }
    val bitmap = rememberDecodedBitmap(current.localUri, maxSizePx = 2048)
    val haptic = LocalAppHaptics.current
    val isDocument = !current.isImage
    val dark = isSystemInDarkTheme()
    val colors = SpatialTheme.colors
    val background = if (isDocument) colors.canvasBase else Color(0xFF040508)
    val foreground = if (isDocument && !dark) Color(0xFF14171F) else Color(0xFFF5F7FA)
    val ready = current.localUri != null

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(
            Modifier
                .fillMaxSize()
                .background(background)
                .statusBarsPadding(),
        ) {
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    GalleryChromeButton(Icons.Default.Close, localizedText("Close", "关闭"), foreground, onClick = onDismiss)
                    Text(
                        current.name,
                        Modifier.weight(1f),
                        color = foreground,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center,
                    )
                    Row(
                        Modifier
                            .height(44.dp)
                            .clip(CircleShape)
                            .background(foreground.copy(alpha = 0.10f))
                            .border(0.75.dp, foreground.copy(alpha = 0.16f), CircleShape)
                            .padding(horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        GalleryChromeIcon(Icons.Outlined.FileDownload, localizedText("Download", "下载"), foreground, ready) {
                            haptic.play(HapticEffect.Light); onSave(current)
                        }
                        GalleryChromeIcon(Icons.Outlined.IosShare, localizedText("Share", "分享"), foreground, ready) {
                            haptic.play(HapticEffect.Light); onShare(current)
                        }
                        GalleryChromeIcon(Icons.AutoMirrored.Outlined.Reply, localizedText("Forward", "转发"), foreground, ready) {
                            haptic.play(HapticEffect.Light); onForward(current)
                        }
                    }
                }
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    if (bitmap != null) {
                        Image(bitmap, current.alt ?: current.name, Modifier.fillMaxWidth())
                    } else if (isDocument) {
                        DocumentPreview(current, onDownload = { onSave(current) }, onOpenExternally = { onOpenDocument(current) })
                    } else if (current.state == AttachmentState.Failed) {
                        TextButton(onClick = { onEnsureDownloaded(current) }) {
                            Text(localizedText("Retry download", "重试下载"), color = foreground)
                        }
                    } else {
                        CircularProgressIndicator(color = foreground)
                    }
                }
                if (!isDocument && attachments.size > 1) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(onClick = { index = (index - 1).coerceAtLeast(0) }, enabled = index > 0) {
                            Text(localizedText("Previous", "上一项"), color = Color.White)
                        }
                        Text("${index + 1} / ${attachments.size}", color = Color.White)
                        TextButton(onClick = { index = (index + 1).coerceAtMost(attachments.lastIndex) }, enabled = index < attachments.lastIndex) {
                            Text(localizedText("Next", "下一项"), color = Color.White)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GalleryChromeButton(icon: ImageVector, label: String, tint: Color, onClick: () -> Unit) {
    Box(
        Modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(tint.copy(alpha = 0.10f))
            .border(0.75.dp, tint.copy(alpha = 0.16f), CircleShape)
            .clickable(onClickLabel = label, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, label, Modifier.size(20.dp), tint = tint)
    }
}

@Composable
private fun GalleryChromeIcon(icon: ImageVector, label: String, tint: Color, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .size(40.dp)
            .clip(CircleShape)
            .clickable(enabled = enabled, onClickLabel = label, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, label, Modifier.size(20.dp), tint = tint.copy(alpha = if (enabled) 1f else 0.35f))
    }
}

@Composable
private fun ChannelActivity.label(): String = when (this) {
    ChannelActivity.Thinking -> localizedText("Thinking", "思考中")
    ChannelActivity.Typing -> localizedText("Typing", "正在输入")
    ChannelActivity.ReadingFile -> localizedText("Reading file", "正在读取文件")
    ChannelActivity.SearchingWeb -> localizedText("Searching the web", "正在搜索网页")
    ChannelActivity.ReadingWeb -> localizedText("Reading the web", "正在阅读网页")
    ChannelActivity.DraftingFile -> localizedText("Drafting the file", "正在撰写文件")
    ChannelActivity.RunningCommands -> localizedText("Running commands", "正在运行命令")
    ChannelActivity.WaitingOnCommand -> localizedText("Waiting on a command", "正在等待命令")
    ChannelActivity.OnComputer -> localizedText("On its computer", "正在操作电脑")
    ChannelActivity.MessagingAssistant -> localizedText("Messaging another assistant", "正在联系其他助手")
    ChannelActivity.WaitingOnBot -> localizedText("Waiting on another Bot", "正在等待其他 Bot")
    ChannelActivity.GeneratingImage -> localizedText("Generating a photo", "正在生成图片")
    ChannelActivity.OrganizingContext -> localizedText("Organizing context", "正在整理上下文")
    ChannelActivity.Working -> localizedText("Working", "处理中")
    ChannelActivity.Background -> localizedText("Working in the background", "正在后台处理")
}

/**
 * The goal notice in a Bot conversation. Opening it never touches the Bot; replying to it is how the
 * user quotes it in the main thread, which is the only way the Bot learns about it.
 */
@Composable
private fun OutcomeUpdateCardRow(
    messageId: String,
    card: OutcomeUpdateCard,
    loadStatus: suspend (String) -> String?,
    onOpen: (String) -> Unit,
    onReply: () -> Unit,
) {
    val colors = SpatialTheme.colors
    var liveStage by remember(card.outcomeId) { mutableStateOf<String?>(null) }
    LaunchedEffect(card.outcomeId) {
        liveStage = loadStatus(card.outcomeId)?.let(OutcomeUpdateCard::stageForStatus)
    }
    val stage = liveStage ?: card.stage
    val label = when (stage) {
        "attention" -> localizedText("Needs attention", "需要处理")
        "running", "generating" -> localizedText("Running", "运行中")
        "review" -> localizedText("Pending review", "待验收")
        "accepted" -> localizedText("Accepted", "已验收")
        "failed" -> localizedText("Failed", "已失败")
        "cancelled" -> localizedText("Cancelled", "已取消")
        else -> localizedText("Draft", "草稿")
    }
    val icon = when (stage) {
        "attention", "failed" -> Icons.Default.Warning
        "running", "generating" -> Icons.Default.Refresh
        "accepted" -> Icons.Default.CheckCircle
        "cancelled" -> Icons.Default.Close
        else -> Icons.Default.Flag
    }
    Row(Modifier.fillMaxWidth().padding(end = 24.dp), verticalAlignment = Alignment.CenterVertically) {
        SpatialGlassSurface(
            tier = GlassTier.Subtle,
            shape = RoundedCornerShape(20.dp),
            onClick = { onOpen(card.outcomeId) },
            modifier = Modifier.weight(1f, fill = false).testTag("outcome-update-card-$messageId"),
        ) {
            Row(
                Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    modifier = Modifier.size(22.dp),
                    tint = if (stage == "attention" || stage == "failed") colors.accent else colors.textSecondary,
                )
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f, fill = false)) {
                    Text(
                        "${localizedText("Goal", "目标")} · $label",
                        style = MaterialTheme.typography.labelMedium,
                        color = colors.textSecondary,
                    )
                    Text(
                        card.title,
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textPrimary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        Icon(
            Icons.AutoMirrored.Filled.Reply,
            contentDescription = localizedText("Reply to goal notice", "回复目标通知"),
            modifier = Modifier.size(44.dp).clickable(onClick = onReply).padding(11.dp).testTag("outcome-update-reply-$messageId"),
            tint = colors.textSecondary,
        )
    }
}
