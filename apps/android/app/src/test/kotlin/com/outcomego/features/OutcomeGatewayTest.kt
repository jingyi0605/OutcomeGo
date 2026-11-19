package com.outcomego.features

import com.outcomego.android.data.MobileFeatureApi
import com.outcomego.mobile.core.HttpMethod
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
        assertEquals("/api/v0/outcomes?limit=20&cursor=cursor%2F%2B%3D%26", client.path)
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
