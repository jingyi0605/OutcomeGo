package com.outcomego.features

import com.outcomego.android.data.MobileFeatureApi
import com.outcomego.mobile.core.ConvertOutcomeRequest
import com.outcomego.mobile.core.CreateOutcomeRequest
import com.outcomego.mobile.core.HttpMethod
import com.outcomego.mobile.core.OutcomeActionRequest
import com.outcomego.mobile.core.OutcomeGoError
import com.outcomego.mobile.core.OutcomeGoRequestException
import com.outcomego.mobile.core.mobileJson
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OutcomeGatewayTest {
    @Test
    fun readsOpaqueCursorAndUnknownSummaryStatusWithoutWrites() = runBlocking {
        val client = OutcomeClient()
        val gateway = LiveFeatureGateway(client)
        val page = gateway.listOutcomes("cursor/+=&").getOrThrow()
        assertEquals("/api/v0/outcomes?limit=20&kinds=standard,tracked&cursor=cursor%2F%2B%3D%26", client.path)
        assertEquals("future_status", page?.items?.single()?.status)
        assertEquals("next-page", page?.nextCursor)
        assertEquals(HttpMethod.GET, client.method)
        assertNull(client.body)
        client.response = """{"id":"one","title":"Outcome","status":"draft","botId":"bot","currentRevision":null,"updatedAt":"now","description":"Draft","currentRevisionView":null,"workItems":[],"outputs":[],"evidence":[],"reviews":[],"futureField":true}"""
        val detail = gateway.outcomeDetail("one/two").getOrThrow()
        assertEquals("/api/v0/outcomes/one%2Ftwo", client.path)
        assertNull(detail.currentRevisionView)
        assertEquals(HttpMethod.GET, client.method)
    }

    @Test
    fun onlyCollection404HidesEntry() = runBlocking {
        val client = OutcomeClient()
        val gateway = LiveFeatureGateway(client)
        client.status = 404
        assertNull(gateway.listOutcomes().getOrThrow())
        assertTrue(gateway.outcomeDetail("missing").isFailure)
        for (status in listOf(401, 403, 500)) {
            client.status = status
            val error = gateway.listOutcomes().exceptionOrNull() as OutcomeGoRequestException
            assertEquals(status, error.error.status)
        }
    }

    @Test
    fun ideasAreCreatedListedConvertedAndDiscardedAsOutcomes() = runBlocking {
        val client = OutcomeClient()
        val gateway = LiveFeatureGateway(client)
        client.response = """{"items":[{"id":"idea","kind":"explore_idea","title":"Idea","status":"draft","botId":null,"revision":1,"currentRevision":null,"updatedAt":"now"}],"nextCursor":null}"""
        val idea = gateway.listOutcomes(kinds = listOf("explore_idea")).getOrThrow()!!.items.single()
        assertEquals("/api/v0/outcomes?limit=20&kinds=explore_idea", client.path)
        assertEquals(1, idea.revision)

        val detail = """{"id":"idea","kind":"explore_idea","title":"Idea","status":"draft","botId":null,"currentRevision":null,"updatedAt":"now","description":"Note","workItems":[],"outputs":[],"evidence":[],"reviews":[]}"""
        client.response = """{"outcome":$detail,"turn":null}"""
        gateway.createOutcome(
            CreateOutcomeRequest(kind = "explore_idea", title = "Idea", description = "Note", clientRequestId = "req-create-1"),
        ).getOrThrow()
        assertEquals(HttpMethod.POST, client.method)
        assertEquals("/api/v0/outcomes", client.path)
        assertEquals(json("""{"kind":"explore_idea","title":"Idea","description":"Note","clientRequestId":"req-create-1"}"""), client.body)

        gateway.convertOutcome(
            "idea",
            ConvertOutcomeRequest(targetKind = "standard", expectedRevision = 1, botId = "bot", clientRequestId = "req-convert-1"),
        ).getOrThrow()
        assertEquals("/api/v0/outcomes/idea/convert", client.path)
        assertEquals(json("""{"targetKind":"standard","expectedRevision":1,"botId":"bot","clientRequestId":"req-convert-1"}"""), client.body)

        client.response = detail
        gateway.actOnOutcome("idea", OutcomeActionRequest(action = "dismiss", clientRequestId = "req-dismiss-1")).getOrThrow()
        assertEquals("/api/v0/outcomes/idea/actions", client.path)
        assertEquals(json("""{"action":"dismiss","clientRequestId":"req-dismiss-1"}"""), client.body)
    }

    private fun json(source: String): JsonObject = mobileJson.parseToJsonElement(source).jsonObject

    @Test
    fun goalManagementSwitchDefaultsOffAndOldServersFallBack() = runBlocking {
        val client = OutcomeClient()
        val gateway = LiveFeatureGateway(client)
        client.response = """{"outcomesEnabled":true}"""
        assertEquals(true, gateway.outcomesEnabled().getOrThrow())
        assertEquals("/api/v0/feature-settings", client.path)
        assertEquals(HttpMethod.GET, client.method)
        client.response = """{}"""
        assertEquals(false, gateway.outcomesEnabled().getOrThrow())
        client.status = 404
        assertNull(gateway.outcomesEnabled().getOrThrow())
        client.status = 500
        assertTrue(gateway.outcomesEnabled().isFailure)
    }

    private class OutcomeClient : MobileFeatureApi {
        var status = 200
        var path = ""
        var method: HttpMethod? = null
        var body: JsonObject? = null
        var response = """{"items":[{"id":"one","title":"Outcome","status":"future_status","botId":"bot","currentRevision":null,"updatedAt":"now"}],"nextCursor":"next-page","future":true}"""
        override suspend fun request(method: HttpMethod, path: String, body: JsonObject?): JsonObject {
            this.method = method; this.path = path; this.body = body
            if (status != 200) throw OutcomeGoRequestException(OutcomeGoError(status, null, "Fixture error"))
            return mobileJson.parseToJsonElement(response).jsonObject
        }
        override suspend fun upload(path: String, uri: String): JsonObject = error("Unexpected write")
    }
}
