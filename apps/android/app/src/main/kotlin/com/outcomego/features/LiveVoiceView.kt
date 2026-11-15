package com.outcomego.features

import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.systemGestures
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.outcomego.android.data.Conversation
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialEdgeFade
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialPulseOrb
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.android.ui.designsystem.spatialPressScale
import com.outcomego.platform.AndroidLiveVoiceSnapshot
import com.outcomego.platform.AndroidLiveVoiceState
import com.outcomego.platform.AndroidLiveVoiceTranscript
import kotlin.math.roundToInt

private val IntOffsetStateSaver: Saver<IntOffset, Any> = listSaver(
    save = { offset -> listOf(offset.x, offset.y) },
    restore = { saved -> IntOffset(saved[0], saved[1]) },
)

@Composable
fun LiveVoiceView(
    snapshot: AndroidLiveVoiceSnapshot,
    bot: Conversation?,
    /** The bots on a group call. Empty for a call with one bot, which keeps the single large avatar. */
    participants: List<Conversation> = emptyList(),
    defaultSpeakerId: String? = null,
    onStop: () -> Unit,
    onMuteMicrophone: (Boolean) -> Unit,
    onMuteSpeaker: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    var minimized by rememberSaveable { mutableStateOf(false) }
    var microphoneMuted by remember { mutableStateOf(false) }
    var speakerMuted by remember { mutableStateOf(false) }
    var startedAt by remember { mutableStateOf<Long?>(null) }
    var elapsedSeconds by remember { mutableLongStateOf(0L) }
    val floatingOffset = rememberSaveable(stateSaver = IntOffsetStateSaver) {
        mutableStateOf(IntOffset.Zero)
    }

    LaunchedEffect(snapshot.state) {
        if (snapshot.state == AndroidLiveVoiceState.Idle) {
            startedAt = null
            elapsedSeconds = 0L
        } else if (startedAt == null) {
            startedAt = SystemClock.elapsedRealtime()
        }
    }
    LaunchedEffect(startedAt) {
        while (startedAt != null) {
            elapsedSeconds = (SystemClock.elapsedRealtime() - startedAt!!).coerceAtLeast(0L) / 1_000L
            kotlinx.coroutines.delay(1_000)
        }
    }

    if (minimized) {
        FloatingMiniVoiceBar(
            snapshot = snapshot,
            bot = participants.firstOrNull { it.botId == snapshot.speakerBotId } ?: bot,
            elapsedSeconds = elapsedSeconds,
            position = floatingOffset,
            onRestore = { minimized = false },
            onStop = onStop,
            modifier = modifier,
        )
    } else {
        // Drawn in the activity window, not in a Dialog. A Dialog window did not receive the
        // bottom gesture inset on gesture-navigation phones, so the controls ran off the screen.
        BackHandler { minimized = true }
        val haptics = LocalAppHaptics.current
        Box(
            modifier
                .fillMaxSize()
                .background(SpatialTheme.colors.scrim)
                .pointerInput(Unit) { detectTapGestures { } }
                .windowInsetsPadding(callOverlayInsets())
                .padding(14.dp),
            contentAlignment = Alignment.Center,
        ) {
            VoiceCallCard(
                snapshot = snapshot,
                bot = bot,
                participants = participants,
                defaultSpeakerId = defaultSpeakerId,
                elapsedSeconds = elapsedSeconds,
                microphoneMuted = microphoneMuted,
                speakerMuted = speakerMuted,
                onMinimize = {
                    haptics.play(HapticEffect.Light)
                    minimized = true
                },
                onStop = {
                    haptics.play(HapticEffect.Medium)
                    onStop()
                },
                onMuteMicrophone = {
                    haptics.play(HapticEffect.Selection)
                    microphoneMuted = !microphoneMuted
                    onMuteMicrophone(microphoneMuted)
                },
                onMuteSpeaker = {
                    haptics.play(HapticEffect.Selection)
                    speakerMuted = !speakerMuted
                    onMuteSpeaker(speakerMuted)
                },
            )
        }
    }
}

/** Space the overlay must keep clear: system bars, cutout, and the bottom gesture area. */
@Composable
private fun callOverlayInsets(): WindowInsets =
    WindowInsets.safeDrawing.union(WindowInsets.systemGestures.only(WindowInsetsSides.Bottom))

@Composable
private fun VoiceCallCard(
    snapshot: AndroidLiveVoiceSnapshot,
    bot: Conversation?,
    participants: List<Conversation>,
    defaultSpeakerId: String?,
    elapsedSeconds: Long,
    microphoneMuted: Boolean,
    speakerMuted: Boolean,
    onMinimize: () -> Unit,
    onStop: () -> Unit,
    onMuteMicrophone: () -> Unit,
    onMuteSpeaker: () -> Unit,
) {
    val activeColor by animateColorAsState(
        targetValue = stateColor(snapshot.state),
        animationSpec = tween(420),
        label = "voice-state-color",
    )
    val glowPrimary = SpatialTheme.colors.accent
    val glowSecondary = SpatialTheme.colors.ambientGlowSecondary
    SpatialGlassSurface(
        modifier = Modifier.fillMaxSize(),
        shape = RoundedCornerShape(SpatialRadii.xl),
        tier = GlassTier.Overlay,
        shadowElevation = 24.dp,
    ) {
        BoxWithConstraints(
            Modifier
                .fillMaxSize()
                .drawBehind {
                    drawRect(
                        Brush.radialGradient(
                            colors = listOf(
                                activeColor.copy(alpha = 0.16f),
                                glowPrimary.copy(alpha = 0.08f),
                                Color.Transparent,
                            ),
                            center = Offset(size.width * 0.5f, size.height * 0.28f),
                            radius = size.maxDimension * 0.55f,
                        ),
                    )
                    drawRect(
                        Brush.radialGradient(
                            colors = listOf(
                                glowSecondary.copy(alpha = 0.07f),
                                Color.Transparent,
                            ),
                            center = Offset(size.width * 0.25f, size.height * 0.78f),
                            radius = size.maxDimension * 0.45f,
                        ),
                    )
                },
        ) {
            val panelHeight = maxHeight
            Column(
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = 22.dp, vertical = 18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    SpatialGlassSurface(
                        shape = CircleShape,
                        tier = GlassTier.Subtle,
                        shadowElevation = 0.dp,
                    ) {
                        Row(
                            Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(7.dp),
                        ) {
                            val isActive = snapshot.state != AndroidLiveVoiceState.Idle &&
                                snapshot.state != AndroidLiveVoiceState.Error
                            if (isActive) {
                                SpatialPulseOrb(color = activeColor, size = 7.dp)
                            } else {
                                Box(Modifier.size(7.dp).clip(CircleShape).background(activeColor))
                            }
                            Text(
                                localizedText("REALTIME", "实时语音"),
                                style = MaterialTheme.typography.labelSmall,
                                color = SpatialTheme.colors.textSecondary,
                                fontWeight = FontWeight.SemiBold,
                                letterSpacing = 0.8.sp,
                            )
                            Text(
                                "· ${formatElapsed(elapsedSeconds)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = SpatialTheme.colors.textPrimary,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                    }
                    SpatialIconOrb(
                        icon = Icons.Default.FullscreenExit,
                        contentDescription = localizedText("Minimize realtime voice", "最小化实时语音"),
                        onClick = onMinimize,
                        size = 40.dp,
                        iconSize = 19.dp,
                        testTag = "live-voice-minimize",
                    )
                }
                Spacer(Modifier.height(14.dp))
                Text(
                    if (participants.isNotEmpty()) localizedText("Group voice conversation", "群聊语音")
                    else bot?.title ?: bot?.subtitle ?: localizedText("Talk with your assistant", "和助手对话"),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = SpatialTheme.colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(18.dp))

                if (participants.isEmpty()) {
                    VoiceBotAvatar(
                        bot = bot,
                        speaking = snapshot.state == AndroidLiveVoiceState.Speaking,
                        listening = snapshot.state == AndroidLiveVoiceState.Listening ||
                            snapshot.state == AndroidLiveVoiceState.Processing,
                        auraColor = activeColor,
                    )
                } else {
                    ParticipantStage(
                        snapshot = snapshot,
                        participants = participants,
                        defaultSpeakerId = defaultSpeakerId,
                        microphoneMuted = microphoneMuted,
                    )
                }
                Spacer(Modifier.height(14.dp))
                StateLine(snapshot.state, activeColor)
                Spacer(Modifier.height(10.dp))

                CaptionList(snapshot, bot, participants, Modifier.weight(1f).fillMaxWidth())

                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 14.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    VoiceControl(
                        icon = if (microphoneMuted) Icons.Default.MicOff else Icons.Default.Mic,
                        label = if (microphoneMuted) localizedText("Unmute", "取消静音") else localizedText("Mute", "静音"),
                        pressed = microphoneMuted,
                        onClick = onMuteMicrophone,
                    )
                    VoiceControl(
                        icon = Icons.Default.CallEnd,
                        label = localizedText("End call", "结束通话"),
                        destructive = true,
                        onClick = onStop,
                    )
                    VoiceControl(
                        icon = if (speakerMuted) Icons.AutoMirrored.Filled.VolumeOff else Icons.AutoMirrored.Filled.VolumeUp,
                        label = if (speakerMuted) localizedText("Unmute", "取消静音") else localizedText("Speaker", "扬声器"),
                        pressed = speakerMuted,
                        onClick = onMuteSpeaker,
                    )
                }
                // Controls stay 10% of the panel height above its bottom edge.
                Spacer(Modifier.height(panelHeight * 0.08f))
            }
        }
    }
}

/**
 * Draggable minimized call. [position] is the offset from the resting spot (bottom right, above
 * the composer). It is read when each drag event arrives, so movement accumulates.
 */
@Composable
private fun FloatingMiniVoiceBar(
    snapshot: AndroidLiveVoiceSnapshot,
    bot: Conversation?,
    elapsedSeconds: Long,
    position: MutableState<IntOffset>,
    onRestore: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier,
) {
    val haptics = LocalAppHaptics.current
    var pillSize by remember { mutableStateOf(IntSize.Zero) }
    BoxWithConstraints(
        modifier
            .fillMaxSize()
            .windowInsetsPadding(callOverlayInsets())
            .padding(12.dp),
    ) {
        val density = LocalDensity.current
        val maxX = (constraints.maxWidth - pillSize.width).coerceAtLeast(0)
        val maxY = (constraints.maxHeight - pillSize.height).coerceAtLeast(0)
        val dockY = (maxY - with(density) { 76.dp.roundToPx() }).coerceAtLeast(0)
        val minDx = -maxX
        val minDy = -dockY
        val maxDy = maxY - dockY
        val x = (maxX + position.value.x).coerceIn(0, maxX)
        val y = (dockY + position.value.y).coerceIn(0, maxY)
        SpatialGlassSurface(
            modifier = Modifier
                .widthIn(max = 310.dp)
                .offset { IntOffset(x, y) }
                .onSizeChanged { pillSize = it }
                .pointerInput(minDx, minDy, maxDy) {
                    detectDragGestures { change, drag ->
                        change.consume()
                        val current = position.value
                        position.value = IntOffset(
                            (current.x + drag.x).roundToInt().coerceIn(minDx, 0),
                            (current.y + drag.y).roundToInt().coerceIn(minDy, maxDy),
                        )
                    }
                }
                .testTag("live-voice-floating-pill"),
            shape = CircleShape,
            tier = GlassTier.Floating,
            shadowElevation = 18.dp,
        ) {
            Row(
                Modifier
                    .clickable {
                        haptics.play(HapticEffect.Light)
                        onRestore()
                    }
                    .padding(start = 6.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                VoiceBotAvatar(
                    bot = bot,
                    speaking = snapshot.state == AndroidLiveVoiceState.Speaking,
                    size = 46.dp,
                    compact = true,
                )
                Spacer(Modifier.width(10.dp))
                Column(Modifier.widthIn(min = 72.dp, max = 132.dp)) {
                    Text(
                        bot?.title ?: bot?.subtitle ?: localizedText("Assistant", "助手"),
                        style = MaterialTheme.typography.titleSmall,
                        color = SpatialTheme.colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        val pillActive = snapshot.state == AndroidLiveVoiceState.Speaking ||
                            snapshot.state == AndroidLiveVoiceState.Listening
                        if (pillActive) {
                            SpatialPulseOrb(color = stateColor(snapshot.state), size = 7.dp)
                        } else {
                            Box(Modifier.size(7.dp).clip(CircleShape).background(stateColor(snapshot.state)))
                        }
                        Spacer(Modifier.width(6.dp))
                        Text(
                            "${statusLabel(snapshot.state)} · ${formatElapsed(elapsedSeconds)}",
                            style = MaterialTheme.typography.labelSmall,
                            color = SpatialTheme.colors.textSecondary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                Spacer(Modifier.width(6.dp))
                IconButton(
                    onClick = {
                        haptics.play(HapticEffect.Light)
                        onRestore()
                    },
                    modifier = Modifier.size(36.dp).testTag("live-voice-restore"),
                ) {
                    Icon(
                        Icons.Default.Fullscreen,
                        contentDescription = localizedText("Restore realtime voice", "恢复实时语音"),
                        tint = SpatialTheme.colors.textPrimary,
                        modifier = Modifier.size(20.dp),
                    )
                }
                Spacer(Modifier.width(4.dp))
                IconButton(
                    onClick = {
                        haptics.play(HapticEffect.Medium)
                        onStop()
                    },
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(SpatialTheme.colors.danger)
                        .testTag("live-voice-mini-stop"),
                ) {
                    Icon(
                        Icons.Default.CallEnd,
                        contentDescription = localizedText("End realtime voice", "结束实时语音"),
                        tint = Color.White,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun VoiceBotAvatar(
    bot: Conversation?,
    speaking: Boolean,
    listening: Boolean = false,
    auraColor: Color = SpatialTheme.colors.accent,
    size: Dp = 148.dp,
    compact: Boolean = false,
) {
    val avatar = rememberDecodedBitmap(bot?.avatarPath, maxSizePx = (size.value * 4).toInt())
    val fill = bot?.avatarColor?.toComposeColor() ?: MaterialTheme.colorScheme.secondaryContainer
    if (compact) {
        Box(
            Modifier
                .size(size)
                .clip(CircleShape)
                .background(fill)
                .then(
                    if (speaking) Modifier.border(2.5.dp, Color(0xFF32A66A), CircleShape)
                    else Modifier.border(0.75.dp, SpatialTheme.colors.glassBorderStart, CircleShape),
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (avatar != null) {
                Image(avatar, contentDescription = bot?.title, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            } else {
                Text(
                    bot?.botIcon?.takeIf { it.isNotBlank() } ?: bot?.title?.take(1)?.uppercase() ?: "✦",
                    color = if (fill.luminance() < .45f) Color.White else Color.Black,
                    style = MaterialTheme.typography.titleLarge,
                )
            }
        }
        return
    }

    val pulse = rememberInfiniteTransition(label = "voice-aura")
    val outerScale by pulse.animateFloat(
        initialValue = 0.94f,
        targetValue = if (speaking) 1.14f else 1.04f,
        animationSpec = infiniteRepeatable(
            animation = tween(if (speaking) 900 else 2200, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "aura-outer",
    )
    val midScale by pulse.animateFloat(
        initialValue = 1.02f,
        targetValue = if (speaking) 0.92f else 0.98f,
        animationSpec = infiniteRepeatable(
            animation = tween(if (speaking) 750 else 1800, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "aura-mid",
    )
    val coreScale by animateFloatAsState(
        targetValue = if (speaking) 1.05f else 1f,
        animationSpec = spring(dampingRatio = 0.65f, stiffness = 320f),
        label = "aura-core",
    )
    val haloAlpha = if (speaking) 0.34f else if (listening) 0.20f else 0.12f

    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        // Outer ambient spatial halo
        Box(
            Modifier
                .size(size)
                .graphicsLayer { scaleX = outerScale; scaleY = outerScale }
                .clip(CircleShape)
                .background(
                    Brush.radialGradient(
                        listOf(
                            auraColor.copy(alpha = haloAlpha),
                            auraColor.copy(alpha = haloAlpha * 0.25f),
                            Color.Transparent,
                        ),
                    ),
                )
                .border(1.dp, auraColor.copy(alpha = if (speaking) 0.45f else 0.20f), CircleShape),
        )
        // Middle glass refraction ring
        Box(
            Modifier
                .size(size * 0.84f)
                .graphicsLayer { scaleX = midScale; scaleY = midScale }
                .clip(CircleShape)
                .border(1.dp, SpatialTheme.colors.glassBorderStart.copy(alpha = if (speaking) 0.7f else 0.4f), CircleShape),
        )
        // Inner core avatar
        Box(
            Modifier
                .size(size * 0.70f)
                .graphicsLayer { scaleX = coreScale; scaleY = coreScale }
                .clip(CircleShape)
                .background(fill)
                .border(
                    width = if (speaking) 2.5.dp else 1.dp,
                    color = if (speaking) auraColor else SpatialTheme.colors.glassBorderStart,
                    shape = CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (avatar != null) {
                Image(avatar, contentDescription = bot?.title, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            } else {
                Text(
                    bot?.botIcon?.takeIf { it.isNotBlank() } ?: bot?.title?.take(1)?.uppercase() ?: "✦",
                    color = if (fill.luminance() < .45f) Color.White else Color.Black,
                    style = MaterialTheme.typography.displaySmall,
                )
            }
        }
    }
}

@Composable
private fun stateColor(state: AndroidLiveVoiceState): Color = when (state) {
    AndroidLiveVoiceState.Speaking -> Color(0xFF32A66A)
    AndroidLiveVoiceState.Connecting, AndroidLiveVoiceState.Processing -> Color(0xFFE0A526)
    AndroidLiveVoiceState.Error -> MaterialTheme.colorScheme.error
    else -> SpatialTheme.colors.accent
}

/**
 * The room of a group call: a face for the user and for each bot, in a grid like a meeting. The
 * face of whoever is talking gets a green ring that pulses, so you can tell at a glance who has the floor.
 */
@Composable
private fun ParticipantStage(
    snapshot: AndroidLiveVoiceSnapshot,
    participants: List<Conversation>,
    defaultSpeakerId: String?,
    microphoneMuted: Boolean,
) {
    val tiles = participants.size + 1
    // Up to three across keeps names readable on a phone; more wrap onto another row.
    val rows = (0 until tiles).chunked(3)
    Column(
        Modifier.fillMaxWidth().testTag("live-voice-stage"),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        rows.forEach { indices ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                indices.forEach { index ->
                    if (index == 0) {
                        ParticipantTile(
                            name = localizedText("You", "你"),
                            speaking = snapshot.userSpeaking,
                            muted = microphoneMuted,
                            badge = null,
                            tag = "live-voice-tile-you",
                        ) { YouFace() }
                    } else {
                        val member = participants[index - 1]
                        ParticipantTile(
                            name = member.title,
                            speaking = member.botId != null && member.botId == snapshot.speakerBotId,
                            muted = false,
                            badge = if (member.botId == defaultSpeakerId) localizedText("Host", "主持") else null,
                            tag = "live-voice-tile-${member.botId}",
                        ) { VoiceBotAvatar(member, speaking = false, size = 64.dp, compact = true) }
                    }
                }
            }
        }
    }
}

@Composable
private fun YouFace() {
    SpatialGlassSurface(
        modifier = Modifier.size(64.dp),
        shape = CircleShape,
        tier = GlassTier.Floating,
        shadowElevation = 0.dp,
    ) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Mic, contentDescription = null, tint = SpatialTheme.colors.textPrimary)
        }
    }
}

@Composable
private fun ParticipantTile(
    name: String,
    speaking: Boolean,
    muted: Boolean,
    badge: String?,
    tag: String,
    face: @Composable () -> Unit,
) {
    val pulse = rememberInfiniteTransition(label = "tile-pulse")
    val ringScale by pulse.animateFloat(
        initialValue = 1f,
        targetValue = 1.28f,
        animationSpec = infiniteRepeatable(
            tween(1_100),
            RepeatMode.Restart,
        ),
        label = "ring-scale",
    )
    val ringAlpha by pulse.animateFloat(
        initialValue = .55f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            tween(1_100),
            RepeatMode.Restart,
        ),
        label = "ring-alpha",
    )
    val green = Color(0xFF32A66A)
    Column(
        Modifier.widthIn(max = 96.dp).testTag(tag),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(Modifier.size(84.dp), contentAlignment = Alignment.Center) {
            if (speaking) {
                Box(
                    Modifier
                        .size(68.dp)
                        .graphicsLayer { scaleX = ringScale; scaleY = ringScale; alpha = ringAlpha }
                        .border(2.dp, green, CircleShape),
                )
            }
            Box(
                Modifier
                    .graphicsLayer { val grow = if (speaking) 1.06f else 1f; scaleX = grow; scaleY = grow }
                    .then(if (speaking) Modifier.border(3.dp, green, CircleShape) else Modifier),
            ) { face() }
            if (muted) {
                Box(
                    Modifier
                        .align(Alignment.BottomEnd)
                        .size(20.dp)
                        .clip(CircleShape)
                        .background(SpatialTheme.colors.danger),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Default.MicOff,
                        contentDescription = localizedText("Microphone muted", "麦克风已静音"),
                        tint = Color.White,
                        modifier = Modifier.size(12.dp),
                    )
                }
            }
        }
        Text(
            name,
            style = MaterialTheme.typography.labelMedium,
            color = if (speaking) green else SpatialTheme.colors.textPrimary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (badge != null) {
            Text(
                badge,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

@Composable
private fun StateLine(state: AndroidLiveVoiceState, color: Color) {
    SpatialGlassSurface(
        shape = CircleShape,
        tier = GlassTier.Subtle,
        shadowElevation = 0.dp,
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            val active = state == AndroidLiveVoiceState.Speaking ||
                state == AndroidLiveVoiceState.Listening ||
                state == AndroidLiveVoiceState.Processing
            if (active) {
                SpatialPulseOrb(color = color, size = 8.dp)
            } else {
                Box(Modifier.size(8.dp).clip(CircleShape).background(color))
            }
            Text(
                statusLabel(state),
                style = MaterialTheme.typography.labelMedium,
                color = SpatialTheme.colors.textPrimary,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun CaptionList(
    snapshot: AndroidLiveVoiceSnapshot,
    bot: Conversation?,
    participants: List<Conversation>,
    modifier: Modifier,
) {
    if (snapshot.transcript.isEmpty() && snapshot.partialTranscript.isBlank() && snapshot.error == null) {
        Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            SpatialGlassSurface(
                modifier = Modifier.size(44.dp),
                shape = CircleShape,
                tier = GlassTier.Subtle,
                shadowElevation = 0.dp,
            ) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Icon(Icons.Default.Mic, contentDescription = null, tint = SpatialTheme.colors.textSecondary)
                }
            }
            Spacer(Modifier.height(10.dp))
            Text(
                localizedText("Start speaking when you are ready.", "准备好后开始说话。"),
                style = MaterialTheme.typography.bodyMedium,
                color = SpatialTheme.colors.textSecondary,
                textAlign = TextAlign.Center,
            )
        }
        return
    }
    val listState = rememberLazyListState()
    LaunchedEffect(snapshot.transcript.size, snapshot.partialTranscript, snapshot.error) {
        val lastIndex = snapshot.transcript.size +
            (if (snapshot.partialTranscript.isNotBlank()) 1 else 0) +
            (if (snapshot.error != null) 1 else 0)
        if (lastIndex > 0) listState.animateScrollToItem(lastIndex - 1)
    }
    Box(modifier) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().testTag("live-voice-captions"),
            contentPadding = PaddingValues(vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            items(snapshot.transcript, key = { it.id }) { entry ->
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    val speaker = participants.firstOrNull { it.botId == entry.speakerBotId }
                    Text(
                        if (entry.role == AndroidLiveVoiceTranscript.Role.Assistant) speaker?.title ?: bot?.title ?: localizedText("Assistant", "助手")
                        else localizedText("You", "你"),
                        style = MaterialTheme.typography.labelSmall,
                        color = SpatialTheme.colors.textSecondary,
                    )
                    Text(
                        entry.text,
                        style = MaterialTheme.typography.bodyLarge,
                        textAlign = TextAlign.Center,
                        color = if (entry.role == AndroidLiveVoiceTranscript.Role.Assistant) SpatialTheme.colors.textPrimary else SpatialTheme.colors.textSecondary,
                    )
                }
            }
            if (snapshot.partialTranscript.isNotBlank()) {
                item {
                    Text(
                        snapshot.partialTranscript,
                        style = MaterialTheme.typography.bodyLarge,
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
            snapshot.error?.let { message ->
                item {
                    Text(
                        message,
                        style = MaterialTheme.typography.bodyMedium,
                        color = SpatialTheme.colors.danger,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
        SpatialEdgeFade(top = true, height = 14.dp, modifier = Modifier.align(Alignment.TopCenter))
        SpatialEdgeFade(top = false, height = 14.dp, modifier = Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun VoiceControl(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    pressed: Boolean = false,
    destructive: Boolean = false,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val containerColor = when {
        destructive -> SpatialTheme.colors.danger
        pressed -> SpatialTheme.colors.textPrimary
        else -> SpatialTheme.colors.glassFloating
    }
    val contentTint = when {
        destructive -> Color.White
        pressed -> if (SpatialTheme.colors.isDark) Color.Black else Color.White
        else -> SpatialTheme.colors.textPrimary
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            modifier = Modifier
                .size(64.dp)
                .spatialPressScale(interactionSource = interactionSource, hapticEffect = null)
                .clip(CircleShape)
                .background(containerColor)
                .border(
                    width = 0.75.dp,
                    color = if (destructive) SpatialTheme.colors.danger.copy(alpha = 0.65f) else SpatialTheme.colors.glassBorderStart,
                    shape = CircleShape,
                )
                .clickable(interactionSource = interactionSource, indication = null, onClick = onClick)
                .testTag("live-voice-control-$label"),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = label, tint = contentTint, modifier = Modifier.size(26.dp))
        }
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = SpatialTheme.colors.textSecondary,
        )
    }
}

@Composable
private fun statusLabel(state: AndroidLiveVoiceState): String = when (state) {
    AndroidLiveVoiceState.Connecting -> localizedText("Connecting", "连接中")
    AndroidLiveVoiceState.Listening, AndroidLiveVoiceState.Interrupted -> localizedText("Listening", "聆听中")
    AndroidLiveVoiceState.Processing -> localizedText("Thinking", "思考中")
    AndroidLiveVoiceState.Speaking -> localizedText("Speaking", "说话中")
    AndroidLiveVoiceState.Reconnecting -> localizedText("Reconnecting", "重新连接中")
    AndroidLiveVoiceState.Error -> localizedText("Connection problem", "连接出现问题")
    else -> localizedText("Ready", "准备就绪")
}

private fun formatElapsed(seconds: Long): String = "%02d:%02d".format(seconds / 60, seconds % 60)

private fun String.toComposeColor(): Color? {
    val value = trim().removePrefix("#")
    if (value.length != 6) return null
    return value.toLongOrNull(16)?.let { Color(it.toInt() or 0xFF000000.toInt()) }
}
