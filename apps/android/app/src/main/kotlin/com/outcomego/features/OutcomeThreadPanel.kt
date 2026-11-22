package com.outcomego.features

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialGlassTextField
import com.outcomego.android.ui.designsystem.SpatialPrimaryButton
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.mobile.core.OutcomeGoRequestException
import com.outcomego.mobile.core.OutcomeLinkTarget
import com.outcomego.mobile.core.OutcomeThreadTurn
import com.outcomego.mobile.core.OutcomeThreadView
import com.outcomego.mobile.core.SendOutcomeThreadMessageRequest
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

private const val THREAD_POLL_MS = 3_000L
private const val THREAD_COLLAPSED_TURNS = 4

/**
 * The goal's own bot thread: what the owner said, what the bot answered, and a box to say more. The
 * words are sent unchanged; whether they mean cancel, change or a question is the bot's call.
 *
 * [onChanged] fires when the owner sends something and again when the bot finishes, so the goal
 * (status, contract) can be re-read.
 */
@Composable
internal fun OutcomeThreadPanel(
    gateway: FeatureGateway,
    outcomeId: String,
    canSend: Boolean,
    focusRequest: Int,
    onChanged: () -> Unit,
    onAuthenticationRequired: (OutcomeLinkTarget) -> Unit,
) {
    val colors = SpatialTheme.colors
    var view by remember(gateway, outcomeId) { mutableStateOf<OutcomeThreadView?>(null) }
    var loadFailed by remember(gateway, outcomeId) { mutableStateOf(false) }
    var text by rememberSaveable(outcomeId) { mutableStateOf("") }
    var sending by remember(outcomeId) { mutableStateOf(false) }
    var errorMessage by remember(outcomeId) { mutableStateOf<String?>(null) }
    var showAll by rememberSaveable(outcomeId) { mutableStateOf(false) }
    // A retry of the same words reuses its request id, so the server delivers it once.
    var requestId by rememberSaveable(outcomeId) { mutableStateOf(UUID.randomUUID().toString()) }
    var requestFor by rememberSaveable(outcomeId) { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    val scope = rememberCoroutineScope()
    val sendFailed = localizedText("Could not send to the bot.", "无法发给机器人。")

    suspend fun load() {
        gateway.outcomeThread(outcomeId).fold(
            onSuccess = { view = it; loadFailed = false },
            onFailure = { err ->
                if ((err as? OutcomeGoRequestException)?.error?.status == 401) {
                    onAuthenticationRequired(OutcomeLinkTarget(outcomeId = outcomeId))
                } else {
                    loadFailed = true
                }
            },
        )
    }

    LaunchedEffect(gateway, outcomeId) { load() }

    // While the bot (planner or reviewer) is working, keep reading the thread; when it stops, reload the goal.
    val working = view?.let { v ->
        v.turns.any { it.inProgress } || v.reviewTurns.any { it.inProgress }
    } == true
    LaunchedEffect(gateway, outcomeId, working) {
        if (!working) return@LaunchedEffect
        while (true) {
            delay(THREAD_POLL_MS)
            load()
            val stillWorking = view?.let { v ->
                v.turns.any { it.inProgress } || v.reviewTurns.any { it.inProgress }
            } == true
            if (!stillWorking) {
                onChanged()
                break
            }
        }
    }

    LaunchedEffect(focusRequest) {
        if (focusRequest > 0 && canSend) runCatching { focus.requestFocus() }
    }

    val turns = view?.turns.orEmpty()
    val reviewTurns = view?.reviewTurns.orEmpty()
    val shown = if (showAll || turns.size <= THREAD_COLLAPSED_TURNS) turns else turns.takeLast(THREAD_COLLAPSED_TURNS)

    SpatialGlassSurface(Modifier.fillMaxWidth(), tier = GlassTier.Card, shape = RoundedCornerShape(SpatialRadii.lg)) {
        Column(Modifier.padding(SpatialSpacing.md), verticalArrangement = Arrangement.spacedBy(SpatialSpacing.sm)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs)) {
                Text(
                    localizedText("Bot conversation", "和机器人的对话"),
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = colors.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                if (working) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Text(localizedText("Bot is working", "机器人处理中"), style = MaterialTheme.typography.labelSmall, color = colors.textSecondary)
                }
            }
            if (loadFailed && view == null) {
                TextButton(onClick = { scope.launch { load() } }) {
                    Text(localizedText("Could not load the conversation. Retry", "无法加载对话，重试"))
                }
            }
            if (turns.size > THREAD_COLLAPSED_TURNS) {
                TextButton(onClick = { showAll = !showAll }) {
                    Text(
                        if (showAll) localizedText("Show recent only", "只看最近")
                        else localizedText("Show earlier (${turns.size - THREAD_COLLAPSED_TURNS})", "查看更早的 ${turns.size - THREAD_COLLAPSED_TURNS} 条"),
                    )
                }
            }
            shown.forEach { turn -> ThreadTurnRows(turn) }
            if (reviewTurns.isNotEmpty()) {
                Text(
                    localizedText("Reviewer turns (${reviewTurns.size})", "审查回合 (${reviewTurns.size})"),
                    style = MaterialTheme.typography.labelLarge,
                    color = colors.textSecondary,
                    modifier = Modifier.padding(top = SpatialSpacing.xs),
                )
                reviewTurns.takeLast(THREAD_COLLAPSED_TURNS).forEach { turn ->
                    ReviewerTurnRow(turn)
                }
            }
            if (view != null && turns.isEmpty()) {
                Text(
                    localizedText("Nothing here yet. Tell the bot what to change, ask a question, or cancel.", "还没有对话。可以告诉机器人要改什么、提问或取消。"),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            }
            if (canSend) {
                SpatialGlassTextField(
                    value = text,
                    onValueChange = { text = it.take(MAX_THREAD_TEXT) },
                    modifier = Modifier.focusRequester(focus),
                    placeholder = localizedText("Tell the bot…", "对机器人说…"),
                    singleLine = false,
                    minLines = 2,
                    maxLines = 6,
                )
                SpatialPrimaryButton(
                    label = localizedText("Send to the bot", "发给机器人"),
                    enabled = !sending && text.isNotBlank(),
                    loading = sending,
                    modifier = Modifier.fillMaxWidth(),
                    onClick = {
                        scope.launch {
                            sending = true
                            errorMessage = null
                            if (requestFor != text) {
                                requestId = UUID.randomUUID().toString()
                                requestFor = text
                            }
                            gateway.sendOutcomeThreadMessage(outcomeId, SendOutcomeThreadMessageRequest(text = text, clientRequestId = requestId)).fold(
                                onSuccess = { turn ->
                                    val current = view
                                    view = (current ?: OutcomeThreadView()).let { it.copy(turns = it.turns.filterNot { t -> t.id == turn.id } + turn) }
                                    text = ""
                                    requestId = UUID.randomUUID().toString()
                                    requestFor = ""
                                    onChanged()
                                },
                                onFailure = { err ->
                                    if ((err as? OutcomeGoRequestException)?.error?.status == 401) {
                                        onAuthenticationRequired(OutcomeLinkTarget(outcomeId = outcomeId))
                                    } else {
                                        errorMessage = err.message ?: sendFailed
                                    }
                                },
                            )
                            sending = false
                        }
                    },
                )
                errorMessage?.let { Text(it, color = colors.danger, style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}

@Composable
private fun ThreadTurnRows(turn: OutcomeThreadTurn) {
    val colors = SpatialTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(SpatialSpacing.xs)) {
        Text(
            localizedText("You", "你"),
            style = MaterialTheme.typography.labelSmall,
            color = colors.textTertiary,
        )
        Text(turn.trigger, style = MaterialTheme.typography.bodyMedium, color = colors.textPrimary)
        when {
            turn.inProgress -> Text(
                localizedText("The bot is working on it…", "机器人正在处理…"),
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            turn.status == "failed" -> Text(
                turn.error?.message?.takeIf { it.isNotBlank() }
                    ?: localizedText("The bot could not finish this. Send it again.", "机器人没能完成这条，请重新发送。"),
                style = MaterialTheme.typography.bodySmall,
                color = colors.danger,
            )
            else -> {
                Text(localizedText("Bot", "机器人"), style = MaterialTheme.typography.labelSmall, color = colors.textTertiary)
                Text(
                    turn.reply?.takeIf { it.isNotBlank() }
                        ?: localizedText("The bot finished without a reply.", "机器人处理完了，没有回复文字。"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textPrimary,
                )
            }
        }
    }
}

@Composable
private fun ReviewerTurnRow(turn: OutcomeThreadTurn) {
    val colors = SpatialTheme.colors
    val purposeLabel = when (turn.purpose) {
        "review_task" -> localizedText("Task review", "任务审查")
        "review" -> localizedText("Overall prereview", "整体初验")
        else -> turn.purpose
    }
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            "$purposeLabel · ${outcomeStatusLabel(turn.status)}",
            style = MaterialTheme.typography.labelSmall,
            color = colors.textTertiary,
        )
        Text(turn.trigger, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
        when {
            turn.inProgress -> Text(
                localizedText("Reviewer is working…", "审查处理中…"),
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            turn.status == "failed" -> Text(
                turn.error?.message?.takeIf { it.isNotBlank() }
                    ?: localizedText("Reviewer turn failed.", "审查回合失败。"),
                style = MaterialTheme.typography.bodySmall,
                color = colors.danger,
            )
            !turn.reply.isNullOrBlank() -> Text(
                turn.reply.orEmpty(),
                style = MaterialTheme.typography.bodySmall,
                color = colors.textPrimary,
            )
        }
    }
}
