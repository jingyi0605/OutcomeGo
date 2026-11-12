package com.outcomego.features

import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.systemGestures
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Minimize
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import com.outcomego.android.data.Conversation
import com.outcomego.platform.AndroidLiveVoiceSnapshot
import com.outcomego.platform.AndroidLiveVoiceState
import com.outcomego.platform.AndroidLiveVoiceTranscript

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
        Box(
            modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = .42f))
                .pointerInput(Unit) { detectTapGestures { } }
                .windowInsetsPadding(callOverlayInsets())
                .padding(16.dp),
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
                onMinimize = { minimized = true },
                onStop = onStop,
                onMuteMicrophone = {
                    microphoneMuted = !microphoneMuted
                    onMuteMicrophone(microphoneMuted)
                },
                onMuteSpeaker = {
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
    Surface(
        modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(30.dp)),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 10.dp,
        shadowElevation = 24.dp,
    ) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
        val panelHeight = maxHeight
        Column(
            Modifier.fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(
                            MaterialTheme.colorScheme.primary.copy(alpha = .10f),
                            MaterialTheme.colorScheme.surface,
                            MaterialTheme.colorScheme.surface,
                        ),
                    ),
                )
                .padding(horizontal = 22.dp, vertical = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                IconButton(
                    onClick = onMinimize,
                    modifier = Modifier
                        .size(42.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surface.copy(alpha = .68f))
                        .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = .26f), CircleShape)
                        .testTag("live-voice-minimize"),
                ) {
                    Icon(
                        Icons.Default.FullscreenExit,
                        contentDescription = localizedText("Minimize realtime voice", "最小化实时语音"),
                    )
                }
            }
            Text(
                localizedText("REALTIME CONVERSATION", "实时对话"),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.Bold,
            )
            Text(
                if (participants.isNotEmpty()) localizedText("Group voice conversation", "群聊语音")
                else bot?.title ?: bot?.subtitle ?: localizedText("Talk with your assistant", "和助手对话"),
                style = MaterialTheme.typography.headlineSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
            )
            Text(
                formatElapsed(elapsedSeconds),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(14.dp))

            if (participants.isEmpty()) {
                VoiceBotAvatar(bot, speaking = snapshot.state == AndroidLiveVoiceState.Speaking)
            } else {
                ParticipantStage(
                    snapshot = snapshot,
                    participants = participants,
                    defaultSpeakerId = defaultSpeakerId,
                    microphoneMuted = microphoneMuted,
                )
            }
            Spacer(Modifier.height(12.dp))
            StateLine(snapshot.state)
            Spacer(Modifier.height(8.dp))

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
                    icon = if (speakerMuted) Icons.Default.VolumeOff else Icons.Default.VolumeUp,
                    label = if (speakerMuted) localizedText("Unmute", "取消静音") else localizedText("Speaker", "扬声器"),
                    pressed = speakerMuted,
                    onClick = onMuteSpeaker,
                )
            }
            // Controls stay 10% of the panel height above its bottom edge.
            Spacer(Modifier.height(panelHeight * 0.1f))
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
    var pillSize by remember { mutableStateOf(IntSize.Zero) }
    BoxWithConstraints(
        modifier.fillMaxSize().windowInsetsPadding(callOverlayInsets()).padding(12.dp),
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
        Surface(
            modifier = Modifier
                .widthIn(max = 300.dp)
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
            shape = RoundedCornerShape(32.dp),
            color = MaterialTheme.colorScheme.surface.copy(alpha = .97f),
            tonalElevation = 8.dp,
            shadowElevation = 16.dp,
            border = androidx.compose.foundation.BorderStroke(
                1.dp,
                MaterialTheme.colorScheme.outline.copy(alpha = .22f),
            ),
        ) {
            Row(
                Modifier
                    .clickable(onClick = onRestore)
                    .padding(start = 6.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                VoiceBotAvatar(
                    bot,
                    speaking = snapshot.state == AndroidLiveVoiceState.Speaking,
                    size = 48.dp,
                    compact = true,
                )
                Spacer(Modifier.width(10.dp))
                Column(Modifier.widthIn(min = 72.dp, max = 132.dp)) {
                    Text(
                        bot?.title ?: bot?.subtitle ?: localizedText("Assistant", "助手"),
                        style = MaterialTheme.typography.titleSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(7.dp).clip(CircleShape).background(stateColor(snapshot.state)))
                        Spacer(Modifier.width(6.dp))
                        Text(
                            "${statusLabel(snapshot.state)} · ${formatElapsed(elapsedSeconds)}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                Spacer(Modifier.width(8.dp))
                IconButton(
                    onClick = onRestore,
                    modifier = Modifier.size(36.dp).testTag("live-voice-restore"),
                ) {
                    Icon(
                        Icons.Default.Fullscreen,
                        contentDescription = localizedText("Restore realtime voice", "恢复实时语音"),
                        modifier = Modifier.size(20.dp),
                    )
                }
                Spacer(Modifier.width(4.dp))
                IconButton(
                    onClick = onStop,
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(Color(0xFFE64949))
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
    size: androidx.compose.ui.unit.Dp = 122.dp,
    compact: Boolean = false,
) {
    val avatar = rememberDecodedBitmap(bot?.avatarPath, maxSizePx = (size.value * 4).toInt())
    val fill = bot?.avatarColor?.toComposeColor() ?: MaterialTheme.colorScheme.secondaryContainer
    // The call screen avatar sits inside two decorative rings (16 dp of padding). A compact
    // avatar has no room for them, or the picture shrinks to almost nothing.
    val frame = if (compact) {
        Modifier.size(size)
    } else {
        Modifier.size(size)
            .border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = .22f), CircleShape)
            .padding(8.dp)
            .border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = .18f), CircleShape)
            .padding(8.dp)
    }
    Box(frame.clip(CircleShape).background(fill), contentAlignment = Alignment.Center) {
        if (avatar != null) {
            Image(avatar, contentDescription = bot?.title, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        } else {
            Text(
                bot?.botIcon?.takeIf { it.isNotBlank() } ?: bot?.title?.take(1)?.uppercase() ?: "✦",
                color = if (fill.luminance() < .45f) Color.White else Color.Black,
                style = if (compact) MaterialTheme.typography.titleLarge else MaterialTheme.typography.displaySmall,
            )
        }
        if (speaking) {
            val ring = if (compact) Color(0xFF32A66A) else MaterialTheme.colorScheme.primary.copy(alpha = .32f)
            Box(Modifier.fillMaxSize().border(if (compact) 2.dp else 3.dp, ring, CircleShape))
        }
    }
}

@Composable
private fun stateColor(state: AndroidLiveVoiceState): Color = when (state) {
    AndroidLiveVoiceState.Speaking -> Color(0xFF32A66A)
    AndroidLiveVoiceState.Connecting, AndroidLiveVoiceState.Processing -> Color(0xFFE0A526)
    AndroidLiveVoiceState.Error -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.primary
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
    Box(
        Modifier.size(64.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Default.Mic, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
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
                // Two things move on a speaker: a ring that spreads outward, and the face itself grows a little.
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
                        .background(MaterialTheme.colorScheme.onSurface),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Default.MicOff,
                        contentDescription = localizedText("Microphone muted", "麦克风已静音"),
                        tint = MaterialTheme.colorScheme.surface,
                        modifier = Modifier.size(12.dp),
                    )
                }
            }
        }
        Text(
            name,
            style = MaterialTheme.typography.labelMedium,
            color = if (speaking) green else MaterialTheme.colorScheme.onSurface,
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
private fun StateLine(state: AndroidLiveVoiceState) {
    val color = stateColor(state)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        Box(Modifier.size(9.dp).clip(CircleShape).background(color))
        Text(statusLabel(state), color = MaterialTheme.colorScheme.onSurfaceVariant)
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
            Icon(Icons.Default.Mic, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(8.dp))
            Text(localizedText("Start speaking when you are ready.", "准备好后开始说话。"), color = MaterialTheme.colorScheme.onSurfaceVariant)
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
    LazyColumn(
        state = listState,
        modifier = modifier.testTag("live-voice-captions"),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        items(snapshot.transcript, key = { it.id }) { entry ->
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                val speaker = participants.firstOrNull { it.botId == entry.speakerBotId }
                Text(
                    if (entry.role == AndroidLiveVoiceTranscript.Role.Assistant) speaker?.title ?: bot?.title ?: localizedText("Assistant", "助手")
                    else localizedText("You", "你"),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    entry.text,
                    textAlign = TextAlign.Center,
                    color = if (entry.role == AndroidLiveVoiceTranscript.Role.Assistant) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (snapshot.partialTranscript.isNotBlank()) {
            item { Text(snapshot.partialTranscript, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.primary) }
        }
        snapshot.error?.let { message ->
            item { Text(message, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center) }
        }
    }
}

@Composable
private fun VoiceControl(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
    pressed: Boolean = false,
    destructive: Boolean = false,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(7.dp)) {
        IconButton(
            onClick = onClick,
            modifier = Modifier.size(64.dp)
                .clip(CircleShape)
                .background(if (destructive) Color(0xFFE64949) else if (pressed) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.surfaceVariant)
                .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = .35f), CircleShape)
                .testTag("live-voice-control-$label"),
        ) {
            Icon(icon, contentDescription = label, tint = if (destructive || pressed) Color.White else MaterialTheme.colorScheme.onSurface)
        }
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
