package com.outcomego.features

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId

@Serializable
data class MobileTodoPage(val items: List<MobileTodo>, val nextCursor: String? = null)

/** A `kind=todo` Outcome as listed by the unified collection; the body is only in its detail. */
@Serializable
data class MobileTodo(
    val id: String,
    val title: String,
    val status: String,
    val revision: Int,
    val kindMeta: MobileTodoMeta = MobileTodoMeta(),
    val dueAt: String? = null,
    val scheduledAt: String? = null,
    val followUpAt: String? = null,
) {
    val summary: String? get() = kindMeta.summary

    val actions: List<MobileTodoAction> get() = when (status) {
        "suggested" -> listOf(MobileTodoAction.ACCEPT, MobileTodoAction.SNOOZE, MobileTodoAction.DISMISS)
        "open", "waiting" -> listOf(MobileTodoAction.COMPLETE, MobileTodoAction.SNOOZE, MobileTodoAction.DISMISS)
        else -> emptyList()
    }

    /** Why an accepted to-do needs the owner, judged by this device's clock and time zone. */
    fun attention(now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): MobileTodoAttention? {
        if (status != "open" && status != "waiting") return null
        val due = parseInstant(dueAt)
        if (due != null && due.isBefore(now)) return MobileTodoAttention.OVERDUE
        val followUp = parseInstant(followUpAt)
        if (status == "waiting" && followUp != null && !followUp.isAfter(now)) return MobileTodoAttention.FOLLOW_UP
        val date = due ?: (if (status == "open") parseInstant(scheduledAt) else null) ?: return null
        return MobileTodoAttention.TODAY.takeIf { date.atZone(zone).toLocalDate() == now.atZone(zone).toLocalDate() }
    }

    fun attentionDate(now: Instant = Instant.now()): String? =
        if (attention(now) == MobileTodoAttention.FOLLOW_UP) followUpAt else dueAt ?: scheduledAt

    private fun parseInstant(value: String?): Instant? =
        value?.let { runCatching { OffsetDateTime.parse(it).toInstant() }.getOrNull() }
}

@Serializable
data class MobileTodoMeta(val summary: String? = null)

enum class MobileTodoAttention { FOLLOW_UP, OVERDUE, TODAY }

enum class MobileTodoAction(val wireName: String) {
    ACCEPT("accept_todo"), SNOOZE("snooze"), DISMISS("dismiss"), COMPLETE("complete"),
}
