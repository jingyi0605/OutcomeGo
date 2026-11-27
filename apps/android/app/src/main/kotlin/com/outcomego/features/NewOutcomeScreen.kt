package com.outcomego.features

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialGlassTextField
import com.outcomego.android.ui.designsystem.SpatialPrimaryButton
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.mobile.core.CreateOutcomeRequest
import com.outcomego.mobile.core.OutcomeDetail
import com.outcomego.mobile.core.OutcomeGoRequestException
import com.outcomego.mobile.core.OutcomeLinkTarget
import com.outcomego.mobile.core.outcomeTitleFromWords
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * A new goal is one box of the owner's own words plus the bot that should plan it. The words become the
 * goal's description unchanged and the request returns at once; the bot decides whether to ask or to
 * write a contract.
 */
@Composable
internal fun NewOutcomeScreen(
    gateway: FeatureGateway,
    bots: List<OutcomeBotOption>,
    onBack: () -> Unit,
    onCreated: (OutcomeDetail) -> Unit,
    onAuthenticationRequired: (OutcomeLinkTarget) -> Unit,
) {
    val colors = SpatialTheme.colors
    var text by rememberSaveable { mutableStateOf("") }
    var selectedBotId by rememberSaveable { mutableStateOf(bots.firstOrNull()?.id.orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    // A retry of the same words reuses its request id, so the server delivers it once; new words get a new id.
    var requestId by rememberSaveable { mutableStateOf(UUID.randomUUID().toString()) }
    var requestFor by rememberSaveable { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val failedMessage = localizedText("Could not hand the goal to the bot.", "无法把目标交给机器人。")

    FeaturePage(localizedText("New Outcome", "新建目标"), onBack = onBack) {
        LazyColumn(
            contentPadding = PaddingValues(SpatialSpacing.md),
            verticalArrangement = Arrangement.spacedBy(SpatialSpacing.sm),
        ) {
            item {
                SpatialGlassSurface(Modifier.fillMaxWidth(), tier = GlassTier.Card, shape = RoundedCornerShape(SpatialRadii.lg)) {
                    Column(Modifier.padding(SpatialSpacing.md), verticalArrangement = Arrangement.spacedBy(SpatialSpacing.sm)) {
                        Text(
                            localizedText(
                                "Tell the bot what you want. It will ask if something is unclear, or write a plan for you to approve.",
                                "告诉机器人你想达成什么。不清楚的地方它会问你，清楚了它会写好方案等你批准。",
                            ),
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textSecondary,
                        )
                        if (bots.isNotEmpty()) {
                            Text(localizedText("Select Bot", "选择执行 Bot"), style = MaterialTheme.typography.labelMedium, color = colors.textSecondary)
                            Row(
                                modifier = Modifier.horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                            ) {
                                bots.forEach { bot ->
                                    FilterChip(
                                        selected = selectedBotId == bot.id,
                                        onClick = { selectedBotId = bot.id },
                                        shape = RoundedCornerShape(SpatialRadii.pill),
                                        label = { Text(bot.name) },
                                    )
                                }
                            }
                        } else {
                            SpatialGlassTextField(
                                value = selectedBotId,
                                onValueChange = { selectedBotId = it },
                                label = localizedText("Bot ID (UUID)", "Bot ID (UUID)"),
                            )
                        }
                        SpatialGlassTextField(
                            value = text,
                            onValueChange = { text = it.take(MAX_THREAD_TEXT) },
                            label = localizedText("What outcome do you want?", "你希望达成什么目标？"),
                            singleLine = false,
                            minLines = 4,
                            maxLines = 10,
                        )
                        SpatialPrimaryButton(
                            label = localizedText("Hand to the bot", "交给机器人"),
                            enabled = !busy && text.isNotBlank() && selectedBotId.isNotBlank(),
                            loading = busy,
                            modifier = Modifier.fillMaxWidth(),
                            onClick = {
                                scope.launch {
                                    busy = true
                                    errorMessage = null
                                    val words = text.trim()
                                    val bot = selectedBotId.trim()
                                    val key = "$bot\n$words"
                                    if (requestFor != key) {
                                        requestId = UUID.randomUUID().toString()
                                        requestFor = key
                                    }
                                    gateway.createOutcome(
                                        CreateOutcomeRequest(
                                            kind = "standard",
                                            title = outcomeTitleFromWords(words),
                                            description = words,
                                            botId = bot,
                                            clientRequestId = requestId,
                                        ),
                                    ).fold(
                                        onSuccess = { created ->
                                            requestId = UUID.randomUUID().toString()
                                            requestFor = ""
                                            onCreated(created.outcome)
                                        },
                                        onFailure = { err ->
                                            if ((err as? OutcomeGoRequestException)?.error?.status == 401) {
                                                onAuthenticationRequired(OutcomeLinkTarget())
                                            } else {
                                                errorMessage = err.message ?: failedMessage
                                            }
                                        },
                                    )
                                    busy = false
                                }
                            },
                        )
                        errorMessage?.let { Text(it, color = colors.danger, style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
        }
    }
}

/** Matches the server's limit on the owner's words for one thread message. */
internal const val MAX_THREAD_TEXT = 8_000
