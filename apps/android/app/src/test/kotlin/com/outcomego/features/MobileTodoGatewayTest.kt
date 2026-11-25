package com.outcomego.features

import com.outcomego.android.data.MobileFeatureApi
import com.outcomego.mobile.core.HttpMethod
import com.outcomego.mobile.core.mobileJson
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class MobileTodoGatewayTest {
    @Test
    fun needsMePreservesCursorAndLimitsWritesToFourRevisionedActions() = runBlocking {
        val until = Instant.parse("2030-01-02T03:04:00Z")
        val writes = listOf(
            MobileTodoAction.ACCEPT to "accept",
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
                    return json("""{"items":[{"id":"$id","title":"Item $revision","status":"suggested","displayState":"suggested","revision":$revision}],"nextCursor":"next/+"}""")
                }

                override suspend fun upload(path: String, uri: String): JsonObject = error("Unexpected upload")
            })
            val page = checkNotNull(gateway.needsMeTodos("next/+").getOrThrow())
            val item = page.items.single()
            assertEquals(id, item.id)
            assertEquals("next/+", page.nextCursor)
            assertEquals(Triple(HttpMethod.GET, "/api/v0/todos?view=needs_me&cursor=next%2F%2B", null), calls.single())
            for ((action, route) in writes) {
                val active = if (action == MobileTodoAction.COMPLETE) item.copy(status = "open") else item
                gateway.actOnTodo(active, action, until.takeIf { action == MobileTodoAction.SNOOZE }).getOrThrow()
                val expectedBody = if (action == MobileTodoAction.SNOOZE) {
                    json("""{"revision":$revision,"snoozeUntil":"$until"}""")
                } else json("""{"revision":$revision}""")
                assertEquals(Triple(HttpMethod.POST, "/api/v0/todos/${id.replace("/", "%2F")}/$route", expectedBody), calls.last())
            }
            assertEquals(5, calls.size)
        }
    }

    @Test
    fun onlyActiveItemsAndSuggestionsOfferActions() {
        val item = MobileTodo("item-a", "Item A", "suggested", "suggested", 1)
        val secondary = listOf(MobileTodoAction.SNOOZE, MobileTodoAction.DISMISS)
        assertEquals(listOf(MobileTodoAction.ACCEPT) + secondary, item.actions)
        for (status in listOf("open", "waiting")) {
            assertEquals(listOf(MobileTodoAction.COMPLETE) + secondary, item.copy(status = status).actions)
        }
        for (status in listOf("done", "dismissed", "future_status")) {
            assertEquals(emptyList<MobileTodoAction>(), item.copy(status = status).actions)
        }
    }

    private fun json(source: String): JsonObject = mobileJson.parseToJsonElement(source).jsonObject
}
