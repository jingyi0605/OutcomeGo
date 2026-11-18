package com.outcomego.features

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import androidx.compose.ui.unit.dp
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.mobile.core.CreateOutcomePlanContext
import com.outcomego.mobile.core.CreateOutcomePlanRequest
import com.outcomego.mobile.core.CreateOutcomeRequest
import com.outcomego.mobile.core.OutcomeBudget
import com.outcomego.mobile.core.OutcomeDetail
import com.outcomego.mobile.core.OutcomeGoRequestException
import com.outcomego.mobile.core.OutcomeLinkTarget
import com.outcomego.mobile.core.OutcomePlanningDimension
import com.outcomego.mobile.core.OutcomePlanningDraft
import com.outcomego.mobile.core.OutcomePlanningSelection
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

@Composable
internal fun OutcomePlanningScreen(
    gateway: FeatureGateway,
    bots: List<OutcomeBotOption>,
    initialDraft: OutcomePlanningDraft? = null,
    onBack: () -> Unit,
    onCreated: (OutcomeDetail) -> Unit,
    onAuthenticationRequired: (OutcomeLinkTarget) -> Unit,
) {
    var sourceText by rememberSaveable { mutableStateOf(initialDraft?.sourceText.orEmpty()) }
    var selectedBotId by rememberSaveable { mutableStateOf(initialDraft?.botId ?: bots.firstOrNull()?.id.orEmpty()) }
    var title by rememberSaveable { mutableStateOf(initialDraft?.sourceText?.take(80).orEmpty()) }
    var timeLimitText by rememberSaveable { mutableStateOf("") }
    var costLimitText by rememberSaveable { mutableStateOf("") }
    var draft by remember(initialDraft) { mutableStateOf(initialDraft) }
    var goalIds by remember(initialDraft) { mutableStateOf(initialDraft?.goal?.selectedOptionIds.orEmpty().toSet()) }
    var acceptanceIds by remember(initialDraft) { mutableStateOf(initialDraft?.acceptance?.selectedOptionIds.orEmpty().toSet()) }
    var boundaryIds by remember(initialDraft) { mutableStateOf(initialDraft?.boundaries?.selectedOptionIds.orEmpty().toSet()) }
    var goalCustom by rememberSaveable { mutableStateOf("") }
    var acceptanceCustom by rememberSaveable { mutableStateOf("") }
    var boundaryCustom by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val errPollPlan = localizedText("Failed to poll plan.", "获取规划进度失败。")
    val errGenPlan = localizedText("Failed to generate plan.", "生成规划失败。")
    val errCreateOutcome = localizedText("Failed to create outcome.", "创建目标失败。")

    fun applyDraft(next: OutcomePlanningDraft) {
        draft = next
        if (title.isBlank()) title = next.sourceText.trim().take(80)
        goalIds = next.goal.selectedOptionIds.ifEmpty {
            next.goal.options.filter { it.recommended == true }.map { it.id }
        }.toSet()
        acceptanceIds = next.acceptance.selectedOptionIds.ifEmpty {
            next.acceptance.options.filter { it.recommended == true || it.required == true }.map { it.id }
        }.toSet()
        boundaryIds = next.boundaries.selectedOptionIds.ifEmpty {
            next.boundaries.options.filter { it.recommended == true }.map { it.id }
        }.toSet()
    }

    LaunchedEffect(draft?.planId, draft?.status) {
        val current = draft ?: return@LaunchedEffect
        if (current.status in setOf("planning", "queued", "pending", "generating")) {
            delay(1500)
            gateway.getOutcomePlan(current.planId).fold(
                onSuccess = { applyDraft(it) },
                onFailure = { err ->
                    if ((err as? OutcomeGoRequestException)?.error?.status == 401) {
                        onAuthenticationRequired(OutcomeLinkTarget())
                    } else {
                        errorMessage = err.message ?: errPollPlan
                    }
                },
            )
        }
    }

    FeaturePage(localizedText("New Outcome", "新建目标"), onBack = onBack) {
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                SpatialGlassSurface(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(localizedText("1. Describe Goal", "1. 描述目标"), style = MaterialTheme.typography.titleMedium)
                        if (bots.isNotEmpty()) {
                            Text(localizedText("Select Bot", "选择执行 Bot"), style = MaterialTheme.typography.labelMedium)
                            Row(
                                modifier = Modifier.horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                bots.forEach { bot ->
                                    FilterChip(
                                        selected = selectedBotId == bot.id,
                                        onClick = { selectedBotId = bot.id },
                                        label = { Text(bot.name) },
                                    )
                                }
                            }
                        } else {
                            OutlinedTextField(
                                value = selectedBotId,
                                onValueChange = { selectedBotId = it },
                                label = { Text(localizedText("Bot ID (UUID)", "Bot ID (UUID)")) },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        OutlinedTextField(
                            value = sourceText,
                            onValueChange = { sourceText = it },
                            label = { Text(localizedText("What outcome do you want?", "你希望达成什么目标？")) },
                            modifier = Modifier.fillMaxWidth(),
                            minLines = 3,
                        )
                        Button(
                            enabled = !busy && sourceText.isNotBlank() && selectedBotId.isNotBlank(),
                            onClick = {
                                scope.launch {
                                    busy = true
                                    errorMessage = null
                                    gateway.createOutcomePlan(
                                        CreateOutcomePlanRequest(
                                            sourceText = sourceText.trim(),
                                            context = CreateOutcomePlanContext(selectedBotId.trim()),
                                            clientRequestId = UUID.randomUUID().toString(),
                                        ),
                                    ).fold(
                                        onSuccess = { applyDraft(it) },
                                        onFailure = { err ->
                                            if ((err as? OutcomeGoRequestException)?.error?.status == 401) {
                                                onAuthenticationRequired(OutcomeLinkTarget())
                                            } else {
                                                errorMessage = err.message ?: errGenPlan
                                            }
                                        },
                                    )
                                    busy = false
                                }
                            },
                        ) {
                            Text(localizedText("Generate Plan", "生成规划草案"))
                        }
                    }
                }
            }

            if (busy || draft?.status in setOf("planning", "queued", "pending", "generating")) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        CircularProgressIndicator()
                        Text(localizedText("Planning in progress...", "正在生成规划草案..."))
                    }
                }
            }

            errorMessage?.let { msg ->
                item { Text(msg, color = MaterialTheme.colorScheme.error) }
            }

            draft?.takeIf { it.status == "ready" }?.let { readyDraft ->
                item {
                    SpatialGlassSurface(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text(localizedText("2. Confirm Contract", "2. 确认目标契约"), style = MaterialTheme.typography.titleMedium)
                            OutlinedTextField(
                                value = title,
                                onValueChange = { title = it },
                                label = { Text(localizedText("Outcome Title", "目标标题")) },
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedTextField(
                                    value = timeLimitText,
                                    onValueChange = { timeLimitText = it },
                                    label = { Text(localizedText("Time limit (min)", "时长上限(分钟)")) },
                                    modifier = Modifier.weight(1f),
                                )
                                OutlinedTextField(
                                    value = costLimitText,
                                    onValueChange = { costLimitText = it },
                                    label = { Text(localizedText("Cost limit", "费用上限")) },
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            if (readyDraft.conflicts.isNotEmpty()) {
                                readyDraft.conflicts.forEach { conflict ->
                                    Text(
                                        "${conflict.severity}: ${conflict.message}",
                                        color = MaterialTheme.colorScheme.error,
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                }
                            }
                        }
                    }
                }

                item {
                    PlanningDimensionCard(
                        title = localizedText("Goal Statements", "目标条款"),
                        dimension = readyDraft.goal,
                        selectedIds = goalIds,
                        onToggle = { id -> goalIds = if (id in goalIds) goalIds - id else goalIds + id },
                        customText = goalCustom,
                        onCustomChange = { goalCustom = it },
                    )
                }
                item {
                    PlanningDimensionCard(
                        title = localizedText("Acceptance Criteria", "验收标准"),
                        dimension = readyDraft.acceptance,
                        selectedIds = acceptanceIds,
                        onToggle = { id -> acceptanceIds = if (id in acceptanceIds) acceptanceIds - id else acceptanceIds + id },
                        customText = acceptanceCustom,
                        onCustomChange = { acceptanceCustom = it },
                    )
                }
                item {
                    PlanningDimensionCard(
                        title = localizedText("Scope Boundaries", "范围边界"),
                        dimension = readyDraft.boundaries,
                        selectedIds = boundaryIds,
                        onToggle = { id -> boundaryIds = if (id in boundaryIds) boundaryIds - id else boundaryIds + id },
                        customText = boundaryCustom,
                        onCustomChange = { boundaryCustom = it },
                    )
                }

                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Button(
                            enabled = !busy && title.isNotBlank() &&
                                (goalIds.isNotEmpty() || goalCustom.isNotBlank()) &&
                                (acceptanceIds.isNotEmpty() || acceptanceCustom.isNotBlank()),
                            onClick = {
                                scope.launch {
                                    busy = true
                                    errorMessage = null
                                    val timeLimit = timeLimitText.trim().toIntOrNull()?.takeIf { it > 0 }
                                    val costLimit = costLimitText.trim().toDoubleOrNull()?.takeIf { it > 0.0 }
                                    val budget = if (timeLimit != null || costLimit != null) {
                                        OutcomeBudget(timeLimitMinutes = timeLimit, costLimit = costLimit)
                                    } else {
                                        null
                                    }
                                    gateway.createOutcome(
                                        CreateOutcomeRequest(
                                            planId = readyDraft.planId,
                                            goal = OutcomePlanningSelection(
                                                selectedOptionIds = goalIds.toList(),
                                                customEntries = goalCustom.lines().map { it.trim() }.filter { it.isNotEmpty() },
                                            ),
                                            acceptance = OutcomePlanningSelection(
                                                selectedOptionIds = acceptanceIds.toList(),
                                                customEntries = acceptanceCustom.lines().map { it.trim() }.filter { it.isNotEmpty() },
                                            ),
                                            boundaries = OutcomePlanningSelection(
                                                selectedOptionIds = boundaryIds.toList(),
                                                customEntries = boundaryCustom.lines().map { it.trim() }.filter { it.isNotEmpty() },
                                            ),
                                            title = title.trim(),
                                            budget = budget,
                                            clientRequestId = UUID.randomUUID().toString(),
                                        ),
                                    ).fold(
                                        onSuccess = { created -> onCreated(created) },
                                        onFailure = { err ->
                                            if ((err as? OutcomeGoRequestException)?.error?.status == 401) {
                                                onAuthenticationRequired(OutcomeLinkTarget())
                                            } else {
                                                errorMessage = err.message ?: errCreateOutcome
                                            }
                                        },
                                    )
                                    busy = false
                                }
                            },
                        ) {
                            Text(localizedText("Create Outcome", "确认创建目标"))
                        }
                        OutlinedButton(onClick = onBack, enabled = !busy) {
                            Text(localizedText("Cancel", "取消"))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlanningDimensionCard(
    title: String,
    dimension: OutcomePlanningDimension,
    selectedIds: Set<String>,
    onToggle: (String) -> Unit,
    customText: String,
    onCustomChange: (String) -> Unit,
) {
    SpatialGlassSurface(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            dimension.options.forEach { option ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onToggle(option.id) }
                        .padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(
                        checked = option.id in selectedIds,
                        onCheckedChange = { onToggle(option.id) },
                    )
                    Column(Modifier.weight(1f)) {
                        Text(option.text, style = MaterialTheme.typography.bodyMedium)
                        option.reason?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
            OutlinedTextField(
                value = customText,
                onValueChange = onCustomChange,
                label = { Text(localizedText("Custom entries (one per line)", "自定义条目（每行一条）")) },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
            )
        }
    }
}
