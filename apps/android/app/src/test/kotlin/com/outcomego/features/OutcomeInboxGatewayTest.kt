package com.outcomego.features

import com.outcomego.android.data.MobileFeatureApi
import com.outcomego.mobile.core.*
import com.outcomego.platform.FcmNotification
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class OutcomeInboxGatewayTest {
    @Test
    fun onlyResolveUsesPostAndRetriesPreserveInput() = runBlocking {
        val calls = mutableListOf<Pair<HttpMethod, String>>()
        val bodies = mutableListOf<JsonObject?>()
        val api = object : MobileFeatureApi {
            override suspend fun request(method: HttpMethod, path: String, body: JsonObject?): JsonObject {
                calls += method to path; bodies += body
                val data = if (method == HttpMethod.GET) """{"items":[],"nextCursor":null}"""
                else """{"decisionId":"d","status":"resolved","outcomeId":"o","contractRevision":1,"resolutionEffect":"plan_only","resume":{"status":"enqueued","workItemIds":[]}}"""
                return mobileJson.parseToJsonElement(data).jsonObject
            }
            override suspend fun upload(path: String, uri: String): JsonObject = error("Mobile receipts must remain read-only")
        }
        val gateway = LiveFeatureGateway(api)
        gateway.outcomeInbox("completed", "opaque/+=").getOrThrow()
        val input = ResolveOutcomeDecision(optionId = "keep", expectedContractRevision = 1, clientRequestId = "request-1")
        repeat(2) { gateway.resolveOutcomeDecision("decision/id", input).getOrThrow() }
        assertEquals(HttpMethod.GET, calls[0].first)
        assertTrue(calls[0].second.contains("status=all"))
        assertTrue(calls[0].second.contains("cursor=opaque%2F%2B%3D"))
        assertNull(bodies[0])
        assertEquals(HttpMethod.POST to "/api/v0/decisions/decision%2Fid/resolve", calls[1])
        assertEquals(bodies[1], bodies[2])
        assertEquals(setOf("optionId", "expectedContractRevision", "clientRequestId"), bodies[1]?.keys)
    }
    @Test
    fun notificationsPreserveLegacyAndIgnoreUnknownOutcomeVersions() {
        assertTrue(FcmNotification.fromData(mapOf("kind" to "message", "channelId" to "chat")).isAlert)
        val outcome = "11111111-1111-4111-8111-111111111111"
        val decision = "22222222-2222-4222-8222-222222222222"
        val payload = mapOf("kind" to "outcome", "schemaVersion" to "1", "type" to "outcome.decision.required",
            "outcomeId" to outcome, "decisionId" to decision,
            "deepLink" to "outcomego://app/v1/outcomes/decision?id=$decision")
        assertEquals(decision, FcmNotification.fromData(payload).outcomeTarget?.decisionId)
        assertTrue(FcmNotification.fromData(payload).isAlert)
        assertFalse(FcmNotification.fromData(payload + ("schemaVersion" to "2")).isAlert)
        assertFalse(FcmNotification.fromData(payload + ("decisionId" to outcome)).isAlert)
    }
}
