package com.outcomego.features

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Context
import android.text.format.DateFormat
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.outcomego.mobile.core.OutcomeGoRequestException
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

@Composable
@OptIn(ExperimentalLayoutApi::class)
internal fun rememberNeedsMeTodoItems(
    gateway: FeatureGateway,
    refreshVersion: Int,
    onAuthenticationRequired: () -> Unit,
): LazyListScope.() -> Unit {
    var page by remember(gateway) { mutableStateOf<MobileTodoPage?>(null) }
    var busy by remember(gateway) { mutableStateOf(false) }
    var loadFailed by remember(gateway) { mutableStateOf(false) }
    var actionMessage by remember(gateway) { mutableStateOf<String?>(null) }
    val descriptions = remember(gateway) { mutableStateMapOf<String, String>() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val conflict = localizedText("The to-do changed. Review the current list.", "待办已变化，请查看最新列表。")
    val updateFailed = localizedText("Could not update the to-do.", "无法更新待办。")
    val invalidDate = localizedText("Choose a future snooze time.", "请选择未来的延后时间。")

    fun requiresAuthentication(error: Throwable): Boolean {
        if ((error as? OutcomeGoRequestException)?.error?.status != 401) return false
        page = null
        onAuthenticationRequired()
        return true
    }

    suspend fun fetch(more: Boolean = false) {
        loadFailed = false
        gateway.needsMeTodos(if (more) page?.nextCursor else null).fold(
            onSuccess = { next ->
                page = if (more && next != null) {
                    next.copy(items = (page?.items.orEmpty() + next.items).distinctBy { it.id })
                } else next
            },
            onFailure = { loadFailed = !requiresAuthentication(it) },
        )
    }

    suspend fun refresh(more: Boolean = false) {
        if (busy) return
        busy = true
        actionMessage = null
        try { fetch(more) } finally { busy = false }
    }

    fun act(todo: MobileTodo, action: MobileTodoAction, until: Instant? = null) {
        scope.launch {
            if (busy || loadFailed || page?.items?.none { it.id == todo.id && it.revision == todo.revision } != false) return@launch
            if (action == MobileTodoAction.SNOOZE && (until == null || !until.isAfter(Instant.now()))) {
                actionMessage = invalidDate
                return@launch
            }
            busy = true
            actionMessage = null
            try {
                val error = gateway.actOnTodo(todo, action, until).exceptionOrNull()
                if (error != null && requiresAuthentication(error)) return@launch
                if (error != null) {
                    actionMessage = if ((error as? OutcomeGoRequestException)?.error?.status == 409) conflict else updateFailed
                }
                page = page?.copy(items = page?.items.orEmpty().filterNot { it.id == todo.id })
                fetch()
            } finally { busy = false }
        }
    }

    LaunchedEffect(gateway, refreshVersion) { refresh() }

    return {
        if (page != null || loadFailed || busy) {
            item(key = "needs-me-todo-header") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(localizedText("To-dos that need me", "需要我处理的待办"), style = MaterialTheme.typography.titleMedium)
                    TextButton(onClick = { scope.launch { refresh() } }, enabled = !busy) {
                        Text(localizedText("Refresh to-dos", "刷新待办"))
                    }
                }
                if (busy) CircularProgressIndicator()
                if (loadFailed) Text(localizedText("Could not load to-dos.", "无法加载待办。"))
                actionMessage?.let { Text(it) }
                if (page?.items?.isEmpty() == true && !loadFailed && !busy) {
                    Text(localizedText("No to-dos need attention.", "暂无待处理的待办。"))
                }
            }
            items(page?.items.orEmpty(), key = { "needs-me-todo:${it.id}" }) { todo ->
                val note = rememberOutcomeDescription(gateway, descriptions, todo.id, todo.revision)
                OutcomeInboxCard {
                    Text(todo.title, style = MaterialTheme.typography.titleMedium)
                    val state = if (todo.status == "suggested") {
                        localizedText("To-do suggestion", "待办建议")
                    } else when (todo.attention()) {
                        MobileTodoAttention.FOLLOW_UP -> localizedText("Needs follow-up", "需跟进")
                        MobileTodoAttention.OVERDUE -> localizedText("Overdue", "已逾期")
                        MobileTodoAttention.TODAY -> localizedText("Today", "今天")
                        null -> null
                    }
                    state?.let { Text(it, style = MaterialTheme.typography.labelMedium) }
                    todo.attentionDate()?.let { Text(formatOutcomeTimestamp(it), style = MaterialTheme.typography.bodySmall) }
                    listOfNotNull(note, todo.summary).filter { it.isNotBlank() }.distinct().forEach { Text(it) }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        todo.actions.forEach { action ->
                            TextButton(enabled = !busy && !loadFailed, onClick = {
                                if (action == MobileTodoAction.SNOOZE) chooseSnoozeTime(context) { act(todo, action, it) }
                                else act(todo, action)
                            }) {
                                Text(when (action) {
                                    MobileTodoAction.ACCEPT -> localizedText("Accept suggestion", "接受建议")
                                    MobileTodoAction.SNOOZE -> localizedText("Snooze", "延后")
                                    MobileTodoAction.DISMISS -> localizedText("Dismiss", "忽略")
                                    MobileTodoAction.COMPLETE -> localizedText("Complete", "完成")
                                })
                            }
                        }
                    }
                }
            }
            if (page?.nextCursor != null && !loadFailed) {
                item(key = "needs-me-todo-more") {
                    TextButton(onClick = { scope.launch { refresh(more = true) } }, enabled = !busy) {
                        Text(localizedText("Load more to-dos", "加载更多待办"))
                    }
                }
            }
        }
    }
}

/**
 * Collection items carry no body, so a visible card reads it from the detail. [cache] is keyed by
 * revision so scrolling does not read it again; a failed read just leaves the body out.
 */
@Composable
internal fun rememberOutcomeDescription(
    gateway: FeatureGateway,
    cache: SnapshotStateMap<String, String>,
    id: String,
    revision: Int?,
): String? {
    val key = "$id@$revision"
    LaunchedEffect(gateway, key) {
        if (key !in cache) gateway.outcomeDetail(id).onSuccess { cache[key] = it.description }
    }
    return cache[key]
}

private fun chooseSnoozeTime(context: Context, onSelected: (Instant) -> Unit) {
    val now = ZonedDateTime.now()
    val zone = ZoneId.systemDefault()
    DatePickerDialog(context, { _, year, month, day ->
        TimePickerDialog(context, { _, hour, minute ->
            onSelected(LocalDate.of(year, month + 1, day).atTime(hour, minute).atZone(zone).toInstant())
        }, now.hour, now.minute, DateFormat.is24HourFormat(context)).show()
    }, now.year, now.monthValue - 1, now.dayOfMonth).apply {
        datePicker.minDate = now.toInstant().toEpochMilli()
    }.show()
}
