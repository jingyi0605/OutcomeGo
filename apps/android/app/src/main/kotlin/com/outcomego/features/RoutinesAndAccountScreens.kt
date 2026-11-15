package com.outcomego.features

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialGlassTextField
import com.outcomego.android.ui.designsystem.SpatialGroupedSection
import com.outcomego.android.ui.designsystem.SpatialHairlineDivider
import com.outcomego.android.ui.designsystem.SpatialPrimaryButton
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSecondaryButton
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

@Composable
private fun RoutineSchedule.Frequency.localizedLabel(): String = when (this) {
    RoutineSchedule.Frequency.Hourly -> localizedText("Hourly", "每小时")
    RoutineSchedule.Frequency.Daily -> localizedText("Daily", "每天")
    RoutineSchedule.Frequency.Weekdays -> localizedText("Weekdays", "工作日")
    RoutineSchedule.Frequency.Weekly -> localizedText("Weekly", "每周")
    RoutineSchedule.Frequency.Monthly -> localizedText("Monthly", "每月")
    RoutineSchedule.Frequency.Interval -> localizedText("Interval", "间隔")
}

@Composable
private fun RoutineSchedule.localizedSummary(): String {
    val safeMinutes = timeMinutes.coerceIn(0, 23 * 60 + 59)
    val hour = safeMinutes / 60
    val minute = safeMinutes % 60
    val time = "%02d:%02d".format(hour, minute)
    val weekday = listOf("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
        .getOrElse((dayOfWeek - 1).coerceIn(0, 6)) { "Monday" }
    val chineseWeekday = listOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")
        .getOrElse((dayOfWeek - 1).coerceIn(0, 6)) { "周一" }
    val ordinal = when {
        dayOfMonth % 100 in 11..13 -> "${dayOfMonth}th"
        dayOfMonth % 10 == 1 -> "${dayOfMonth}st"
        dayOfMonth % 10 == 2 -> "${dayOfMonth}nd"
        dayOfMonth % 10 == 3 -> "${dayOfMonth}rd"
        else -> "${dayOfMonth}th"
    }
    val chineseUnit = when (intervalUnit) {
        RoutineSchedule.IntervalUnit.Minutes -> "分钟"
        RoutineSchedule.IntervalUnit.Hours -> "小时"
        RoutineSchedule.IntervalUnit.Days -> "天"
        RoutineSchedule.IntervalUnit.Weeks -> "周"
    }
    return when (frequency) {
        RoutineSchedule.Frequency.Hourly -> localizedText("Every hour at :%02d".format(minute), "每小时在 :%02d".format(minute))
        RoutineSchedule.Frequency.Daily -> localizedText("Daily at $time", "每天 $time")
        RoutineSchedule.Frequency.Weekdays -> localizedText("Weekdays at $time", "工作日 $time")
        RoutineSchedule.Frequency.Weekly -> localizedText("Weekly on $weekday at $time", "每周${chineseWeekday} $time")
        RoutineSchedule.Frequency.Monthly -> localizedText("Monthly on the $ordinal at $time", "每月${dayOfMonth}日 $time")
        RoutineSchedule.Frequency.Interval -> localizedText("Every $intervalAmount ${intervalUnit.label}", "每 $intervalAmount $chineseUnit")
    } + " ($timeZone)"
}

@Composable
fun RoutinesScreen(
    state: FeatureLoadState<List<Routine>>,
    onRetry: () -> Unit,
    onAdd: () -> Unit,
    onEdit: (Routine) -> Unit,
    onToggle: (Routine) -> Unit,
    onRun: (Routine) -> Unit,
    onBack: () -> Unit,
) {
    val haptic = LocalAppHaptics.current
    FeaturePage(localizedText("Routines", "例行任务"), onBack = onBack) {
        LoadStateContent(
            state = state,
            onRetry = onRetry,
            emptyAction = {
                SpatialPrimaryButton(
                    label = localizedText("Add routine", "添加例行任务"),
                    onClick = onAdd,
                )
            },
        ) { routines ->
            LazyColumn(
                Modifier.fillMaxSize().padding(horizontal = SpatialSpacing.md),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(top = 12.dp, bottom = 28.dp),
            ) {
                item {
                    SpatialPrimaryButton(
                        label = localizedText("Add routine", "添加例行任务"),
                        onClick = onAdd,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                items(routines, key = { it.id }) { routine ->
                    SpatialGlassSurface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(SpatialRadii.lg),
                        tier = GlassTier.Card,
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    routine.name,
                                    Modifier.weight(1f),
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = SpatialTheme.colors.textPrimary,
                                )
                                Switch(
                                    checked = routine.enabled,
                                    onCheckedChange = {
                                        haptic.play(HapticEffect.Selection)
                                        onToggle(routine)
                                    },
                                )
                            }
                            Text(
                                routine.schedule.localizedSummary(),
                                style = MaterialTheme.typography.bodyMedium,
                                color = SpatialTheme.colors.textSecondary,
                            )
                            Text(
                                routine.prompt,
                                maxLines = 3,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.bodySmall,
                                color = SpatialTheme.colors.textPrimary,
                            )
                            routine.nextRunAt?.let {
                                Text(
                                    localizedText("Next: $it", "下次运行：$it"),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = SpatialTheme.colors.textTertiary,
                                )
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                SpatialSecondaryButton(
                                    label = localizedText("Edit", "编辑"),
                                    onClick = { onEdit(routine) },
                                    modifier = Modifier.weight(1f),
                                )
                                TextButton(onClick = { haptic.play(HapticEffect.Light); onRun(routine) }) {
                                    Text(localizedText("Run now", "立即运行"))
                                }
                            }
                            if (routine.executions.isNotEmpty()) {
                                SpatialHairlineDivider(insetStart = 0.dp)
                                Text(
                                    localizedText("Recent runs", "最近运行记录"),
                                    fontWeight = FontWeight.Medium,
                                    color = SpatialTheme.colors.textPrimary,
                                )
                                routine.executions.take(3).forEach { execution ->
                                    Text(
                                        "${execution.status} · ${execution.createdAt}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = SpatialTheme.colors.textSecondary,
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
fun RoutineEditorScreen(
    routine: Routine,
    onChange: (Routine) -> Unit,
    onSave: () -> Unit,
    onBack: () -> Unit,
    onDelete: (() -> Unit)? = null,
    operation: FeatureOperationState = FeatureOperationState.Idle,
) {
    val haptic = LocalAppHaptics.current
    var confirmDelete by remember { mutableStateOf(false) }
    FeaturePage(
        if (routine.id.isBlank()) localizedText("New routine", "新建例行任务") else localizedText("Edit routine", "编辑例行任务"),
        onBack = onBack,
    ) {
        LazyColumn(
            Modifier.fillMaxSize().padding(horizontal = SpatialSpacing.md),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            contentPadding = PaddingValues(top = 12.dp, bottom = 28.dp),
        ) {
            item {
                SpatialGlassTextField(
                    value = routine.name,
                    onValueChange = { onChange(routine.copy(name = it)) },
                    label = localizedText("Routine name", "例行任务名称"),
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Spacer(Modifier.height(10.dp))
                SpatialGlassTextField(
                    value = routine.prompt,
                    onValueChange = { onChange(routine.copy(prompt = it)) },
                    label = localizedText("Instructions", "说明"),
                    modifier = Modifier.fillMaxWidth().height(130.dp),
                    singleLine = false,
                    minLines = 4,
                    maxLines = 8,
                )
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        localizedText("Frequency", "频率"),
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = SpatialTheme.colors.textPrimary,
                    )
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        RoutineSchedule.Frequency.entries.forEach { frequency ->
                            val selected = routine.schedule.frequency == frequency
                            Box(
                                Modifier
                                    .clip(CircleShape)
                                    .background(if (selected) MaterialTheme.colorScheme.primary else SpatialTheme.colors.glassSubtle)
                                    .border(
                                        0.75.dp,
                                        if (selected) MaterialTheme.colorScheme.primary else SpatialTheme.colors.glassBorderStart,
                                        CircleShape,
                                    )
                                    .clickable {
                                        haptic.play(HapticEffect.Selection)
                                        onChange(routine.copy(schedule = routine.schedule.copy(frequency = frequency)))
                                    }
                                    .padding(horizontal = 14.dp, vertical = 8.dp),
                            ) {
                                Text(
                                    frequency.localizedLabel(),
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                                    color = if (selected) MaterialTheme.colorScheme.onPrimary else SpatialTheme.colors.textPrimary,
                                )
                            }
                        }
                    }
                }
            }
            item {
                val useChinese = localizedText("en", "zh") == "zh"
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SearchableTimeZoneSelector(
                        selectedTimeZone = routine.schedule.timeZone,
                        onSelectTimeZone = { zone, _ -> onChange(routine.copy(schedule = routine.schedule.copy(timeZone = zone))) },
                        label = localizedText("Time zone", "时区"),
                        includeAutoDetect = false,
                        useChinese = useChinese,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    when (routine.schedule.frequency) {
                        RoutineSchedule.Frequency.Hourly -> {
                            val currentMinute = routine.schedule.timeMinutes.coerceIn(0, 59)
                            DropdownSelectorField(
                                selectedValue = currentMinute,
                                options = PickerCatalogs.minuteOptions(currentMinute),
                                optionLabel = PickerCatalogs::formatHourlyMinute,
                                onSelect = { minute -> onChange(routine.copy(schedule = routine.schedule.copy(timeMinutes = minute))) },
                                label = localizedText("Minute", "分钟"),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        RoutineSchedule.Frequency.Daily,
                        RoutineSchedule.Frequency.Weekdays,
                        RoutineSchedule.Frequency.Weekly,
                        RoutineSchedule.Frequency.Monthly,
                        -> {
                            val currentMinutes = routine.schedule.timeMinutes.coerceIn(0, 24 * 60 - 1)
                            DropdownSelectorField(
                                selectedValue = currentMinutes,
                                options = PickerCatalogs.timeOptions(currentMinutes),
                                optionLabel = PickerCatalogs::formatClockTime,
                                onSelect = { minutes -> onChange(routine.copy(schedule = routine.schedule.copy(timeMinutes = minutes))) },
                                label = localizedText("Time", "时间"),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        RoutineSchedule.Frequency.Interval -> Unit
                    }
                    if (routine.schedule.frequency == RoutineSchedule.Frequency.Weekly) {
                        DropdownSelectorField(
                            selectedValue = routine.schedule.dayOfWeek.coerceIn(1, 7),
                            options = PickerCatalogs.weekdayOptions(),
                            optionLabel = { day -> PickerCatalogs.weekdayLabel(day, useChinese) },
                            onSelect = { day -> onChange(routine.copy(schedule = routine.schedule.copy(dayOfWeek = day))) },
                            label = localizedText("Day of week", "星期几"),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    if (routine.schedule.frequency == RoutineSchedule.Frequency.Monthly) {
                        DropdownSelectorField(
                            selectedValue = routine.schedule.dayOfMonth.coerceIn(1, 31),
                            options = PickerCatalogs.monthDayOptions(),
                            optionLabel = { day -> if (useChinese) "${day}日" else day.toString() },
                            onSelect = { day -> onChange(routine.copy(schedule = routine.schedule.copy(dayOfMonth = day))) },
                            label = localizedText("Day of month", "每月日期"),
                            supportingText = if (routine.schedule.dayOfMonth > 28) {
                                localizedText("Months with fewer days run on the last day of the month.", "天数不足的月份将在月末最后一天运行。")
                            } else null,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    if (routine.schedule.frequency == RoutineSchedule.Frequency.Interval) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            DropdownSelectorField(
                                selectedValue = routine.schedule.intervalAmount.coerceAtLeast(1),
                                options = PickerCatalogs.intervalAmountOptions(routine.schedule.intervalUnit, routine.schedule.intervalAmount),
                                optionLabel = { it.toString() },
                                onSelect = { amount -> onChange(routine.copy(schedule = routine.schedule.copy(intervalAmount = amount))) },
                                label = localizedText("Every", "每隔"),
                                modifier = Modifier.weight(1f),
                            )
                            DropdownSelectorField(
                                selectedValue = routine.schedule.intervalUnit,
                                options = RoutineSchedule.IntervalUnit.entries,
                                optionLabel = { unit -> PickerCatalogs.intervalUnitLabel(unit, useChinese) },
                                onSelect = { unit -> onChange(routine.copy(schedule = PickerCatalogs.changeIntervalUnit(routine.schedule, unit))) },
                                label = localizedText("Unit", "单位"),
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        SpatialPrimaryButton(
                            label = localizedText("Save", "保存"),
                            onClick = { haptic.play(HapticEffect.Light); onSave() },
                            enabled = routine.name.isNotBlank() && routine.prompt.isNotBlank(),
                            modifier = Modifier.weight(1f),
                        )
                        onDelete?.let {
                            TextButton(onClick = { confirmDelete = true }) {
                                Text(localizedText("Delete", "删除"), color = SpatialTheme.colors.danger)
                            }
                        }
                    }
                    OperationStatus(operation)
                }
            }
        }
        if (confirmDelete) {
            AlertDialog(
                onDismissRequest = { confirmDelete = false },
                containerColor = SpatialTheme.colors.glassOverlay,
                title = { Text(localizedText("Delete routine?", "删除例行任务？")) },
                text = { Text(localizedText("This removes the routine and its schedule from the server.", "这会从服务器删除例行任务及其计划。")) },
                confirmButton = {
                    TextButton(onClick = { confirmDelete = false; onDelete?.invoke() }) {
                        Text(localizedText("Delete", "删除"), color = SpatialTheme.colors.danger)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { confirmDelete = false }) { Text(localizedText("Cancel", "取消")) }
                },
            )
        }
    }
}

@Composable
fun AccountMemoryScreen(
    state: FeatureLoadState<AccountMemoryState>,
    onRetry: () -> Unit,
    onEditMemory: (MemoryItem) -> Unit,
    onClearMemory: () -> Unit,
    onReset: () -> Unit,
    onSignOut: () -> Unit,
    onBack: () -> Unit,
) {
    var pendingAction by remember { mutableStateOf<String?>(null) }
    FeaturePage(localizedText("Account and memory", "账户与记忆"), onBack = onBack) {
        LoadStateContent(state, onRetry) { account ->
            LazyColumn(
                Modifier.fillMaxSize().padding(horizontal = SpatialSpacing.md),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(top = 12.dp, bottom = 28.dp),
            ) {
                item {
                    SpatialGroupedSection {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(account.profile.displayName, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, color = SpatialTheme.colors.textPrimary)
                            Text(account.profile.server, color = SpatialTheme.colors.textSecondary)
                            Text(
                                if (account.profile.connected) localizedText("Connected", "已连接") else localizedText("Offline", "离线"),
                                color = if (account.profile.connected) MaterialTheme.colorScheme.tertiary else SpatialTheme.colors.textSecondary,
                                style = MaterialTheme.typography.labelMedium,
                            )
                            Text(
                                localizedText("Version ${account.profile.version}", "版本 ${account.profile.version}"),
                                style = MaterialTheme.typography.labelSmall,
                                color = SpatialTheme.colors.textTertiary,
                            )
                        }
                    }
                }
                item { SettingsSectionTitle(localizedText("Memory", "记忆")) }
                if (account.memories.isEmpty()) {
                    item {
                        SpatialGlassSurface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(SpatialRadii.lg),
                            tier = GlassTier.Subtle,
                            shadowElevation = 0.dp,
                        ) {
                            Text(
                                localizedText("No saved memories yet.", "还没有保存的记忆。"),
                                color = SpatialTheme.colors.textSecondary,
                                modifier = Modifier.padding(16.dp),
                            )
                        }
                    }
                }
                items(account.memories, key = { it.id }) { memory ->
                    SpatialGlassSurface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(SpatialRadii.lg),
                        tier = GlassTier.Card,
                        onClick = { onEditMemory(memory) },
                    ) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(memory.title, fontWeight = FontWeight.SemiBold, color = SpatialTheme.colors.textPrimary)
                            Text(memory.content, maxLines = 3, overflow = TextOverflow.Ellipsis, color = SpatialTheme.colors.textSecondary)
                            Text(memory.updatedAt, style = MaterialTheme.typography.labelSmall, color = SpatialTheme.colors.textTertiary)
                        }
                    }
                }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            SpatialSecondaryButton(
                                label = localizedText("Clear memory", "清除记忆"),
                                onClick = { pendingAction = "clear" },
                                modifier = Modifier.weight(1f),
                            )
                            TextButton(
                                onClick = { pendingAction = "reset" },
                                modifier = Modifier.weight(1f).heightIn(min = 50.dp),
                            ) {
                                Text(localizedText("Reset local data", "重置本地数据"), color = SpatialTheme.colors.danger)
                            }
                        }
                        Button(
                            onClick = { pendingAction = "sign-out" },
                            shape = CircleShape,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = SpatialTheme.colors.danger,
                                contentColor = Color.White,
                            ),
                            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                        ) {
                            Text(localizedText("Sign out", "退出登录"), fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
        pendingAction?.let { action ->
            val title = when (action) {
                "clear" -> localizedText("Clear memory?", "清除记忆？")
                "reset" -> localizedText("Reset local data?", "重置本地数据？")
                else -> localizedText("Sign out?", "退出登录？")
            }
            val detail = when (action) {
                "clear" -> localizedText("Saved memories will be removed from the server.", "服务器将删除已保存的记忆。")
                "reset" -> localizedText("Local drafts and feature state will be cleared.", "本地草稿和功能状态将被清除。")
                else -> localizedText("You will need to sign in again to use this server.", "你需要重新登录才能使用此服务器。")
            }
            AlertDialog(
                onDismissRequest = { pendingAction = null },
                containerColor = SpatialTheme.colors.glassOverlay,
                title = { Text(title) },
                text = { Text(detail) },
                confirmButton = {
                    TextButton(onClick = {
                        when (action) {
                            "clear" -> onClearMemory()
                            "reset" -> onReset()
                            else -> onSignOut()
                        }
                        pendingAction = null
                    }) {
                        Text(
                            localizedText("Continue", "继续"),
                            color = if (action == "sign-out") SpatialTheme.colors.danger else MaterialTheme.colorScheme.primary,
                        )
                    }
                },
                dismissButton = {
                    TextButton(onClick = { pendingAction = null }) { Text(localizedText("Cancel", "取消")) }
                },
            )
        }
    }
}

@Composable
fun PluginsScreen(
    state: FeatureLoadState<List<Plugin>>,
    onRetry: () -> Unit,
    onInstall: (Plugin) -> Unit,
    onUpdate: (Plugin) -> Unit,
    onRollback: (Plugin) -> Unit,
    onAuthorize: (Plugin) -> Unit,
    onCancelAuthorization: (Plugin) -> Unit,
    onConfigure: (Plugin, JsonObject) -> Unit,
    onTestTool: (Plugin) -> Unit,
    onBack: () -> Unit,
) {
    FeaturePage(localizedText("Plugins", "插件"), onBack = onBack) {
        LoadStateContent(
            state = state,
            onRetry = onRetry,
            emptyAction = { Text(localizedText("No plugins available.", "没有可用插件。"), color = SpatialTheme.colors.textSecondary) },
        ) { plugins ->
            var filter by remember { mutableStateOf("") }
            val authorizationPending = plugins.any { it.authorizationUrl != null }
            LaunchedEffect(authorizationPending) {
                while (authorizationPending) {
                    delay(2_000)
                    onRetry()
                }
            }
            Column(Modifier.fillMaxSize().padding(horizontal = SpatialSpacing.md)) {
                Spacer(Modifier.height(6.dp))
                SpatialGlassTextField(
                    value = filter,
                    onValueChange = { filter = it },
                    label = localizedText("Filter plugins", "筛选插件"),
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Spacer(Modifier.height(10.dp))
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    contentPadding = PaddingValues(bottom = 28.dp),
                ) {
                    items(
                        plugins.filter { filter.isBlank() || it.name.contains(filter, true) || it.description.contains(filter, true) },
                        key = { "${it.id}:${it.connectionId ?: "plugin"}" },
                    ) { plugin ->
                        var confirmRollback by remember(plugin.id, plugin.connectionId) { mutableStateOf(false) }
                        var configure by remember(plugin.id, plugin.connectionId) { mutableStateOf(false) }
                        var configuration by remember(plugin.id, plugin.connectionId) { mutableStateOf("{}") }
                        SpatialGlassSurface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(SpatialRadii.lg),
                            tier = GlassTier.Card,
                        ) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(plugin.name, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = SpatialTheme.colors.textPrimary)
                                    Text(plugin.installedVersion ?: "Not installed", style = MaterialTheme.typography.labelSmall, color = SpatialTheme.colors.textTertiary)
                                }
                                Text(plugin.description, color = SpatialTheme.colors.textSecondary, style = MaterialTheme.typography.bodyMedium)
                                plugin.error?.let { Text(it, color = SpatialTheme.colors.danger, style = MaterialTheme.typography.bodySmall) }
                                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    if (plugin.installedVersion == null) {
                                        SpatialPrimaryButton(
                                            label = localizedText("Install", "安装"),
                                            onClick = { onInstall(plugin) },
                                            enabled = !plugin.busy,
                                        )
                                    } else {
                                        if (plugin.latestVersion != null && plugin.latestVersion != plugin.installedVersion) {
                                            TextButton(onClick = { onUpdate(plugin) }, enabled = !plugin.busy) { Text(localizedText("Update", "更新")) }
                                        }
                                        TextButton(onClick = { confirmRollback = true }, enabled = !plugin.busy) { Text(localizedText("Rollback", "回滚")) }
                                        TextButton(onClick = { configure = true }, enabled = !plugin.busy) { Text(localizedText("Configure", "配置")) }
                                        TextButton(onClick = { onTestTool(plugin) }, enabled = !plugin.busy) { Text(localizedText("Test tool", "测试工具")) }
                                    }
                                    if (plugin.requiresOAuth && !plugin.configured && plugin.authorizationUrl == null) {
                                        TextButton(onClick = { onAuthorize(plugin) }, enabled = !plugin.busy) { Text(localizedText("Authorize", "授权")) }
                                    }
                                    if (plugin.authorizationUrl != null) {
                                        Text(localizedText("Waiting for browser sign-in", "等待浏览器登录"), style = MaterialTheme.typography.labelSmall, color = SpatialTheme.colors.textSecondary)
                                        TextButton(onClick = { onCancelAuthorization(plugin) }, enabled = !plugin.busy) { Text(localizedText("Cancel", "取消")) }
                                    }
                                }
                                if (plugin.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            }
                        }
                        if (configure) {
                            AlertDialog(
                                onDismissRequest = { configure = false },
                                containerColor = SpatialTheme.colors.glassOverlay,
                                title = { Text(localizedText("Configure ${plugin.name}", "配置 ${plugin.name}")) },
                                text = {
                                    SpatialGlassTextField(
                                        value = configuration,
                                        onValueChange = { configuration = it },
                                        label = localizedText("Configuration JSON", "配置 JSON"),
                                        modifier = Modifier.fillMaxWidth(),
                                        singleLine = false,
                                        minLines = 5,
                                    )
                                },
                                confirmButton = {
                                    TextButton(onClick = {
                                        runCatching { Json.parseToJsonElement(configuration).jsonObject }
                                            .onSuccess { onConfigure(plugin, it); configure = false }
                                    }) { Text(localizedText("Save", "保存")) }
                                },
                                dismissButton = {
                                    TextButton(onClick = { configure = false }) { Text(localizedText("Cancel", "取消")) }
                                },
                            )
                        }
                        if (confirmRollback) {
                            AlertDialog(
                                onDismissRequest = { confirmRollback = false },
                                containerColor = SpatialTheme.colors.glassOverlay,
                                title = { Text(localizedText("Roll back ${plugin.name}?", "回滚 ${plugin.name}？")) },
                                text = { Text(localizedText("The server will restore the previous installed plugin version.", "服务器将恢复之前安装的插件版本。")) },
                                confirmButton = {
                                    TextButton(onClick = { confirmRollback = false; onRollback(plugin) }) {
                                        Text(localizedText("Roll back", "回滚"), color = SpatialTheme.colors.danger)
                                    }
                                },
                                dismissButton = {
                                    TextButton(onClick = { confirmRollback = false }) { Text(localizedText("Cancel", "取消")) }
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}
