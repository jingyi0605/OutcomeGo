package com.outcomego.android

import com.outcomego.android.data.ChatMessage
import com.outcomego.android.data.ChatRow
import com.outcomego.android.data.toChatRows
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

    @Test
    fun collapsesConsecutiveBotExchangeMessagesByPeer() {
        val rows = listOf(
            agentMessage("1", from = true, createdAt = "2026-01-01T00:00:00Z"),
            agentMessage("2", from = false, createdAt = "2026-01-01T00:05:00Z"),
            message("3"),
        ).toChatRows(collapseAgentExchanges = true)

        assertEquals(listOf("agent-exchange:1", "3"), rows.map { it.key })
        val exchange = rows[0] as ChatRow.AgentExchange
        assertEquals(2, exchange.messages.size)
        assertEquals("peer-1", exchange.peerId)
        assertEquals("Peer", exchange.peerName)
    }

    @Test
    fun splitsBotExchangeMessagesOnPeerAndIdleGaps() {
        val rows = listOf(
            agentMessage("1", peerId = "peer-1", createdAt = "2026-01-01T00:00:00Z"),
            agentMessage("2", peerId = "peer-2", createdAt = "2026-01-01T00:01:00Z"),
            agentMessage("3", peerId = "peer-1", createdAt = "2026-01-01T00:31:00Z"),
        ).toChatRows(collapseAgentExchanges = true)

        assertEquals(
            listOf("agent-exchange:1", "agent-exchange:2", "agent-exchange:3"),
            rows.map { it.key },
        )
    }

    private fun agentMessage(
        id: String,
        from: Boolean = false,
        peerId: String = "peer-1",
        createdAt: String,
    ) = ChatMessage(
        id = id,
        author = "Peer",
        body = id,
        sender = "agent",
        createdAt = createdAt,
        metadata = JsonObject(
            mapOf(
                (if (from) "fromAgent" else "toAgent") to JsonObject(
                    mapOf(
                        "id" to JsonPrimitive(peerId),
                        "name" to JsonPrimitive("Peer"),
                    ),
                ),
            ),
        ),
    )
}
