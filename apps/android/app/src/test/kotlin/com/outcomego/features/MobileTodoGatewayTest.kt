package com.outcomego.features

import com.outcomego.android.data.MobileFeatureApi
import com.outcomego.mobile.core.HttpMethod
import com.outcomego.mobile.core.mobileJson
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class MobileTodoGatewayTest {
    @Test
    fun needsMePreservesCursorAndLimitsWritesToFourRevisionedActions() = runBlocking {
        val until = Instant.parse("2030-01-02T03:04:00Z")
        val writes = listOf(
            MobileTodoAction.ACCEPT to "accept_todo",
            MobileTodoAction.SNOOZE to "snooze",
            MobileTodoAction.DISMISS to "dismiss",
            MobileTodoAction.COMPLETE to "complete",
        )
        assertEquals(writes.map { it.first }, MobileTodoAction.entries)
        for ((id, revision) in listOf("item-a" to 3, "item/b" to 8)) {
            val calls = mutableListOf<Triple<HttpMethod, String, JsonObject?>>()
            val gateway = LiveFeatureGateway(object : MobileFeatureApi {
                override suspend fun request(method: HttpMethod, path: String, body: JsonObject?): JsonObject {
                    calls += Triple(method, path, body)
                    return json("""{"items":[{"id":"$id","kind":"todo","title":"Item $revision","status":"suggested","revision":$revision,"botId":null,"kindMeta":{"summary":"Why","createdVia":"agent_turn"}}],"nextCursor":"next/+"}""")
                }

                override suspend fun upload(path: String, uri: String): JsonObject = error("Unexpected upload")
            })
            val page = checkNotNull(gateway.needsMeTodos("next/+").getOrThrow())
            val item = page.items.single()
            assertEquals(id, item.id)
            assertEquals("Why", item.summary)
            assertEquals("next/+", page.nextCursor)
            assertEquals(
                Triple(HttpMethod.GET, "/api/v0/outcomes?limit=100&kinds=todo&view=needs_me&cursor=next%2F%2B", null),
                calls.single(),
            )
            for ((action, name) in writes) {
                val active = if (action == MobileTodoAction.COMPLETE) item.copy(status = "open") else item
                gateway.actOnTodo(active, action, until.takeIf { action == MobileTodoAction.SNOOZE }).getOrThrow()
                val (method, path, body) = calls.last()
                assertEquals(HttpMethod.POST, method)
                assertEquals("/api/v0/outcomes/${id.replace("/", "%2F")}/actions", path)
                val requestId = checkNotNull(body?.get("clientRequestId")).jsonPrimitive.content
                UUID.fromString(requestId)
                val payload = if (action == MobileTodoAction.SNOOZE) ""","payload":{"snoozeUntil":"$until"}""" else ""
                assertEquals(
                    json("""{"action":"$name","expectedRevision":$revision$payload,"clientRequestId":"$requestId"}"""),
                    body,
                )
            }
            assertEquals(5, calls.size)
        }
    }

    @Test
    fun onlyActiveItemsAndSuggestionsOfferActions() {
        val item = MobileTodo("item-a", "Item A", "suggested", 1)
        val secondary = listOf(MobileTodoAction.SNOOZE, MobileTodoAction.DISMISS)
        assertEquals(listOf(MobileTodoAction.ACCEPT) + secondary, item.actions)
        for (status in listOf("open", "waiting")) {
            assertEquals(listOf(MobileTodoAction.COMPLETE) + secondary, item.copy(status = status).actions)
        }
        for (status in listOf("accepted", "cancelled", "future_status")) {
            assertEquals(emptyList<MobileTodoAction>(), item.copy(status = status).actions)
        }
    }

    @Test
    fun attentionIsDerivedFromDates() {
        val now = Instant.parse("2030-01-02T12:00:00Z")
        val open = MobileTodo("a", "A", "open", 1)
        val waiting = open.copy(status = "waiting")
        val cases = listOf(
            open.copy(dueAt = "2030-01-02T11:00:00.000Z") to MobileTodoAttention.OVERDUE,
            open.copy(dueAt = "2030-01-02T23:00:00.000Z") to MobileTodoAttention.TODAY,
            open.copy(dueAt = "2030-01-03T00:00:00.000Z") to null,
            open.copy(scheduledAt = "2030-01-02T23:00:00+00:00") to MobileTodoAttention.TODAY,
            waiting.copy(followUpAt = "2030-01-02T12:00:00Z", dueAt = "2030-01-01T00:00:00Z") to MobileTodoAttention.OVERDUE,
            waiting.copy(followUpAt = "2030-01-03T00:00:00Z", dueAt = "2030-01-02T23:00:00Z") to MobileTodoAttention.TODAY,
            waiting.copy(followUpAt = "2030-01-03T00:00:00Z", scheduledAt = "2030-01-02T00:00:00Z") to null,
            open.copy(status = "suggested", dueAt = "2030-01-01T00:00:00Z") to null,
            open to null,
        )
        for ((todo, expected) in cases) assertEquals(todo.toString(), expected, todo.attention(now, ZoneOffset.UTC))
        val followUp = waiting.copy(followUpAt = "2030-01-02T12:00:00Z")
        assertEquals(followUp.followUpAt, followUp.attentionDate(now))
    }

    private fun json(source: String): JsonObject = mobileJson.parseToJsonElement(source).jsonObject
}
