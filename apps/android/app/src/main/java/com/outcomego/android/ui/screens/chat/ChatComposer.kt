package com.outcomego.android.ui.screens.chat

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.Measurable
import androidx.compose.ui.layout.MeasurePolicy
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.outcomego.android.R
import com.outcomego.android.data.ChatMessage
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialMotion
import com.outcomego.android.ui.designsystem.SpatialPulseOrb
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.features.Attachment
import com.outcomego.features.FeatureOperationState
import com.outcomego.features.FileGlyph
import com.outcomego.features.HapticEffect
import com.outcomego.features.LocalAppHaptics
import com.outcomego.features.formatAttachmentSize
import com.outcomego.features.localizedText
import com.outcomego.features.rememberDecodedBitmap
import com.outcomego.platform.VoiceRecordingState

@Composable
internal fun ChatBottomBar(
    modifier: Modifier = Modifier,
    error: String?,
    voiceState: VoiceRecordingState,
    onStopVoice: () -> Unit,
    onCancelVoice: () -> Unit,
    onRetryVoice: () -> Unit,
    replyingTo: ChatMessage?,
    onCancelReply: () -> Unit,
    pendingAttachments: List<Attachment>,
    onRemoveAttachment: (String) -> Unit,
    draft: String,
    onDraftChange: (String) -> Unit,
    onAttach: () -> Unit,
    onStartVoice: () -> Unit,
    onSend: () -> Unit,
    composerFocusedState: MutableState<Boolean>,
    composerFocusRequester: FocusRequester,
    operation: FeatureOperationState,
) {
    val haptic = LocalAppHaptics.current
    val colors = SpatialTheme.colors
    Column(
        modifier
            .fillMaxWidth()
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.xs),
    ) {
        if (error != null) {
            Text(
                error,
                Modifier.padding(start = 6.dp, bottom = 6.dp),
                color = colors.danger,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        when (voiceState) {
            VoiceRecordingState.Idle -> Unit
            is VoiceRecordingState.Starting -> {
                Row(
                    Modifier.padding(start = 6.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    SpatialPulseOrb(color = colors.accent, size = 8.dp)
                    Text(
                        stringResource(R.string.chat_record_voice),
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                    )
                }
            }
            is VoiceRecordingState.Recording -> VoiceRecordingPill(
                label = localizedText("Recording voice note", "正在录制语音消息"),
                onStop = onStopVoice,
                onCancel = onCancelVoice,
            )
            is VoiceRecordingState.Interrupted -> VoiceRecordingPill(
                label = localizedText("Recording paused", "录音已暂停"),
                onStop = onStopVoice,
                onCancel = onCancelVoice,
            )
            is VoiceRecordingState.Transcribing -> VoiceRecordingPill(
                label = localizedText("Transcribing…", "正在转写…"),
                onStop = null,
                onCancel = onCancelVoice,
            )
            is VoiceRecordingState.Review -> {
                SpatialGlassSurface(
                    tier = GlassTier.Card,
                    shape = RoundedCornerShape(SpatialRadii.md),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 8.dp),
                ) {
                    Row(
                        Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            voiceState.error ?: localizedText("Transcription failed", "语音转写失败"),
                            color = colors.danger,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(onClick = { haptic.play(HapticEffect.Light); onRetryVoice() }) {
                            Text(localizedText("Retry", "重试"), color = colors.accent)
                        }
                        TextButton(onClick = { haptic.play(HapticEffect.Warning); onCancelVoice() }) {
                            Text(localizedText("Discard", "丢弃"), color = colors.textSecondary)
                        }
                    }
                }
            }
            is VoiceRecordingState.Failed -> {
                SpatialGlassSurface(
                    tier = GlassTier.Card,
                    shape = RoundedCornerShape(SpatialRadii.md),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 8.dp),
                ) {
                    Row(
                        Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            voiceState.message,
                            color = colors.danger,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(onClick = onCancelVoice) {
                            Text(localizedText("Dismiss", "关闭"), color = colors.textSecondary)
                        }
                    }
                }
            }
        }
        AnimatedVisibility(visible = replyingTo != null) {
            replyingTo?.let { target ->
                ReplyPreviewBar(target, onCancelReply)
            }
        }
        if (pendingAttachments.isNotEmpty()) {
            PendingAttachmentStrip(
                attachments = pendingAttachments,
                onRemove = onRemoveAttachment,
            )
        }
        ChatComposer(
            draft = draft,
            onDraftChange = onDraftChange,
            hasPendingAttachments = pendingAttachments.isNotEmpty(),
            voiceState = voiceState,
            onAttach = onAttach,
            onStartVoice = onStartVoice,
            onSend = onSend,
            isFocused = composerFocusedState.value,
            onFocusChange = { composerFocusedState.value = it },
            focusRequester = composerFocusRequester,
        )
        when (operation) {
            FeatureOperationState.Idle -> Unit
            FeatureOperationState.Pending -> Text(
                localizedText("Working…", "处理中…"),
                Modifier
                    .padding(start = 10.dp, top = 4.dp)
                    .testTag("chat-operation-status"),
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            is FeatureOperationState.Succeeded -> Unit
            is FeatureOperationState.Failed -> Text(
                operation.message,
                Modifier
                    .padding(start = 10.dp, top = 4.dp)
                    .testTag("chat-operation-status"),
                color = colors.danger,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

/**
 * Spatial glass pill composer: collapses to a single row with attachment and voice/send controls
 * inside the container when unfocused, and splits into a full-width text row plus a bottom tool
 * row when focused or containing a draft.
 */
@Composable
internal fun ChatComposer(
    draft: String,
    onDraftChange: (String) -> Unit,
    hasPendingAttachments: Boolean,
    voiceState: VoiceRecordingState,
    onAttach: () -> Unit,
    onStartVoice: () -> Unit,
    onSend: () -> Unit,
    isFocused: Boolean,
    onFocusChange: (Boolean) -> Unit,
    focusRequester: FocusRequester,
    modifier: Modifier = Modifier,
) {
    val haptic = LocalAppHaptics.current
    val colors = SpatialTheme.colors
    val canSend = draft.isNotBlank() || hasPendingAttachments
    val expanded = isFocused || draft.isNotBlank()
    val expandedState = rememberUpdatedState(expanded)
    val measurePolicy = remember {
        MeasurePolicy { measurables, constraints ->
            val buttonConstraints = constraints.copy(minWidth = 0, minHeight = 0)
            var attachMeasurable: Measurable? = null
            var inputMeasurable: Measurable? = null
            var actionMeasurable: Measurable? = null
            for (i in measurables.indices) {
                val measurable = measurables[i]
                when (measurable.layoutId) {
                    "attach" -> attachMeasurable = measurable
                    "input" -> inputMeasurable = measurable
                    "action" -> actionMeasurable = measurable
                }
            }
            val attachPlaceable = attachMeasurable!!.measure(buttonConstraints)
            val actionPlaceable = actionMeasurable!!.measure(buttonConstraints)
            val maxWidth = constraints.maxWidth
            val gapPx = 4.dp.roundToPx()
            if (!expandedState.value) {
                val inputWidth = (maxWidth - attachPlaceable.width - actionPlaceable.width - gapPx * 2).coerceAtLeast(0)
                val inputPlaceable = inputMeasurable!!.measure(
                    constraints.copy(minWidth = inputWidth, maxWidth = inputWidth, minHeight = 0),
                )
                val rowHeight = maxOf(attachPlaceable.height, actionPlaceable.height, inputPlaceable.height)
                layout(maxWidth, rowHeight) {
                    attachPlaceable.placeRelative(
                        x = 0,
                        y = (rowHeight - attachPlaceable.height) / 2,
                    )
                    inputPlaceable.placeRelative(
                        x = attachPlaceable.width + gapPx,
                        y = (rowHeight - inputPlaceable.height) / 2,
                    )
                    actionPlaceable.placeRelative(
                        x = maxWidth - actionPlaceable.width,
                        y = (rowHeight - actionPlaceable.height) / 2,
                    )
                }
            } else {
                val inputPlaceable = inputMeasurable!!.measure(
                    constraints.copy(minWidth = maxWidth, maxWidth = maxWidth, minHeight = 0),
                )
                val toolRowHeight = maxOf(attachPlaceable.height, actionPlaceable.height)
                val totalHeight = inputPlaceable.height + gapPx + toolRowHeight
                layout(maxWidth, totalHeight) {
                    inputPlaceable.placeRelative(x = 0, y = 0)
                    attachPlaceable.placeRelative(
                        x = 0,
                        y = inputPlaceable.height + gapPx + (toolRowHeight - attachPlaceable.height) / 2,
                    )
                    actionPlaceable.placeRelative(
                        x = maxWidth - actionPlaceable.width,
                        y = inputPlaceable.height + gapPx + (toolRowHeight - actionPlaceable.height) / 2,
                    )
                }
            }
        }
    }

    SpatialGlassSurface(
        modifier = modifier
            .fillMaxWidth()
            .animateContentSize(SpatialMotion.ContentSizeSpring)
            .testTag("composer-container"),
        tier = GlassTier.Floating,
        shape = RoundedCornerShape(28.dp),
        shadowElevation = 10.dp,
    ) {
        Layout(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 7.dp),
            measurePolicy = measurePolicy,
            content = {
                Box(Modifier.layoutId("attach"), contentAlignment = Alignment.Center) {
                    IconButton(
                        onClick = { haptic.play(HapticEffect.Light); onAttach() },
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(colors.glassSubtle)
                            .testTag("attach-composer"),
                    ) {
                        Icon(
                            Icons.Default.Add,
                            contentDescription = stringResource(R.string.chat_add_attachment),
                            tint = colors.textPrimary,
                            modifier = Modifier.size(21.dp),
                        )
                    }
                }
                Box(Modifier.layoutId("input")) {
                    BasicTextField(
                        value = draft,
                        onValueChange = onDraftChange,
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(focusRequester)
                            .onFocusChanged { onFocusChange(it.isFocused) }
                            .testTag("message-composer"),
                        textStyle = MaterialTheme.typography.bodyLarge.copy(
                            color = colors.textPrimary,
                        ),
                        cursorBrush = SolidColor(colors.accent),
                        maxLines = if (expanded) 5 else 1,
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Sentences,
                        ),
                        decorationBox = { innerTextField ->
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .then(
                                        if (expanded) {
                                            Modifier.padding(horizontal = 10.dp, vertical = 7.dp)
                                        } else {
                                            Modifier
                                                .heightIn(min = 40.dp)
                                                .padding(horizontal = 6.dp, vertical = 8.dp)
                                        },
                                    ),
                                contentAlignment = if (expanded) Alignment.TopStart else Alignment.CenterStart,
                            ) {
                                if (draft.isEmpty()) {
                                    Text(
                                        text = stringResource(R.string.chat_message),
                                        style = MaterialTheme.typography.bodyLarge,
                                        color = colors.textTertiary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                innerTextField()
                            }
                        },
                    )
                }
                Box(Modifier.layoutId("action"), contentAlignment = Alignment.Center) {
                    AnimatedContent(
                        targetState = canSend,
                        transitionSpec = {
                            (fadeIn() + scaleIn(initialScale = 0.85f)) togetherWith
                                (fadeOut() + scaleOut(targetScale = 0.85f))
                        },
                        label = "composerAction",
                    ) { sendVisible ->
                        if (sendVisible) {
                            IconButton(
                                onClick = { haptic.play(HapticEffect.Light); onSend() },
                                modifier = Modifier
                                    .size(40.dp)
                                    .testTag("send-message"),
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(36.dp)
                                        .clip(CircleShape)
                                        .background(colors.accent),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Icon(
                                        Icons.Default.ArrowUpward,
                                        contentDescription = stringResource(R.string.chat_send),
                                        tint = colors.onAccent,
                                        modifier = Modifier.size(19.dp),
                                    )
                                }
                            }
                        } else {
                            IconButton(
                                onClick = { haptic.play(HapticEffect.Medium); onStartVoice() },
                                enabled = voiceState is VoiceRecordingState.Idle,
                                modifier = Modifier
                                    .size(40.dp)
                                    .clip(CircleShape)
                                    .background(colors.glassSubtle)
                                    .testTag("voice-composer"),
                            ) {
                                Icon(
                                    Icons.Default.Mic,
                                    contentDescription = stringResource(R.string.chat_record_voice),
                                    tint = colors.textPrimary,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                        }
                    }
                }
            },
        )
    }
}

@Composable
private fun VoiceRecordingPill(
    label: String,
    onStop: (() -> Unit)?,
    onCancel: () -> Unit,
) {
    val haptic = LocalAppHaptics.current
    val colors = SpatialTheme.colors
    SpatialGlassSurface(
        tier = GlassTier.Card,
        shape = CircleShape,
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SpatialPulseOrb(color = colors.danger, size = 9.dp)
            Spacer(Modifier.width(10.dp))
            Text(
                label,
                Modifier.weight(1f),
                style = MaterialTheme.typography.bodySmall,
                color = colors.textPrimary,
                fontWeight = FontWeight.Medium,
            )
            onStop?.let {
                IconButton(
                    onClick = { haptic.play(HapticEffect.Light); it() },
                    modifier = Modifier.size(36.dp),
                ) {
                    Icon(
                        Icons.Default.Stop,
                        contentDescription = localizedText("Stop voice note", "停止语音消息"),
                        tint = colors.accent,
                    )
                }
            }
            IconButton(
                onClick = { haptic.play(HapticEffect.Warning); onCancel() },
                modifier = Modifier.size(36.dp),
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = localizedText("Cancel voice note", "取消语音消息"),
                    tint = colors.textSecondary,
                )
            }
        }
    }
}

@Composable
internal fun ReplyPreviewBar(target: ChatMessage, onCancel: () -> Unit) {
    val colors = SpatialTheme.colors
    SpatialGlassSurface(
        tier = GlassTier.Card,
        shape = RoundedCornerShape(SpatialRadii.md),
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp)
            .testTag("reply-preview"),
    ) {
        Row(
            Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.AutoMirrored.Filled.Reply,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = colors.accent,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                (target.displayBody ?: "").replace(Regex("\\s+"), " ").trim(),
                Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            IconButton(
                onClick = onCancel,
                modifier = Modifier
                    .size(36.dp)
                    .testTag("cancel-reply"),
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = localizedText("Cancel reply", "取消回复"),
                    tint = colors.textSecondary,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
    }
}

@Composable
internal fun PendingAttachmentStrip(
    attachments: List<Attachment>,
    onRemove: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptic = LocalAppHaptics.current
    val colors = SpatialTheme.colors
    val shape = RoundedCornerShape(SpatialRadii.sm)
    LazyRow(
        modifier = modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp)
            .testTag("pending-attachments"),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(horizontal = 2.dp),
    ) {
        itemsIndexed(attachments, key = { index, item -> "${item.id}-$index" }) { _, attachment ->
            val removeLabel = localizedText("Remove ${attachment.name}", "移除 ${attachment.name}")
            Box(Modifier.testTag("pending-attachment-${attachment.id}")) {
                SpatialGlassSurface(
                    tier = GlassTier.Card,
                    shape = shape,
                    modifier = Modifier
                        .padding(top = 6.dp, end = 6.dp)
                        .then(
                            if (attachment.isImage) {
                                Modifier.size(64.dp)
                            } else {
                                Modifier
                                    .height(64.dp)
                                    .widthIn(min = 136.dp, max = 196.dp)
                            },
                        ),
                ) {
                    if (attachment.isImage) {
                        val bitmap = rememberDecodedBitmap(attachment.localUri, maxSizePx = 256)
                        if (bitmap != null) {
                            Image(
                                bitmap = bitmap,
                                contentDescription = attachment.alt ?: attachment.name,
                                modifier = Modifier.fillMaxSize(),
                                contentScale = ContentScale.Crop,
                            )
                        } else {
                            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                Icon(
                                    Icons.Default.Image,
                                    contentDescription = attachment.name,
                                    tint = colors.textSecondary,
                                    modifier = Modifier.size(24.dp),
                                )
                            }
                        }
                    } else {
                        Row(
                            modifier = Modifier
                                .fillMaxHeight()
                                .padding(horizontal = 10.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            FileGlyph(attachment.name)
                            Column(Modifier.weight(1f, fill = false)) {
                                Text(
                                    text = attachment.name,
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.Medium,
                                    color = colors.textPrimary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    text = formatAttachmentSize(attachment.sizeBytes),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = colors.textSecondary,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                }
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .size(28.dp)
                        .semantics {
                            role = Role.Button
                            contentDescription = removeLabel
                        }
                        .testTag("remove-pending-attachment-${attachment.id}")
                        .clickable {
                            haptic.play(HapticEffect.Light)
                            onRemove(attachment.id)
                        },
                    contentAlignment = Alignment.TopEnd,
                ) {
                    Box(
                        modifier = Modifier
                            .size(20.dp)
                            .clip(CircleShape)
                            .background(Color(0xFFE53935))
                            .border(1.5.dp, colors.canvasBase, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(12.dp),
                        )
                    }
                }
            }
        }
    }
}
