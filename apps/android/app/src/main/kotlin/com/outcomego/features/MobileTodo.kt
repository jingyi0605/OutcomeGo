package com.outcomego.features

import kotlinx.serialization.Serializable

@Serializable
data class MobileTodoPage(val items: List<MobileTodo>, val nextCursor: String? = null)

@Serializable
data class MobileTodo(
    val id: String,
    val title: String,
    val status: String,
    val displayState: String,
    val revision: Int,
    val overdue: Boolean = false,
    val note: String? = null,
    val summary: String? = null,
    val dueAt: String? = null,
    val scheduledAt: String? = null,
    val followUpAt: String? = null,
) {
    val actions: List<MobileTodoAction> get() = when (status) {
        "suggested" -> listOf(MobileTodoAction.ACCEPT, MobileTodoAction.SNOOZE, MobileTodoAction.DISMISS)
        "open", "waiting" -> listOf(MobileTodoAction.COMPLETE, MobileTodoAction.SNOOZE, MobileTodoAction.DISMISS)
        else -> emptyList()
    }

    val attentionDate: String? get() = if (displayState == "follow_up") followUpAt else dueAt ?: scheduledAt
}

enum class MobileTodoAction(val route: String) {
    ACCEPT("accept"), SNOOZE("snooze"), DISMISS("dismiss"), COMPLETE("complete"),
}
