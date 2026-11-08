package com.aiteamos.android

import com.aiteamos.android.data.ChatMessage
import com.aiteamos.android.data.ChatRow
import com.aiteamos.android.data.toChatRows
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatRowsTest {
    private fun message(id: String, session: String? = null) = ChatMessage(
        id = id,
        author = "",
        body = id,
        metadata = if (session == null) JsonObject(emptyMap())
        else JsonObject(mapOf("voice" to JsonObject(mapOf("sessionId" to JsonPrimitive(session))))),
    )

    @Test
    fun foldsConsecutiveVoiceMessagesAndSplitsOnOrdinaryOnes() {
        val rows = listOf(message("1", "a"), message("2", "a"), message("3"), message("4", "a"), message("5", "b")).toChatRows()
        assertEquals(listOf("voice:1", "3", "voice:4", "voice:5"), rows.map { it.key })
        assertEquals(2, (rows[0] as ChatRow.Voice).messages.size)
    }
}
