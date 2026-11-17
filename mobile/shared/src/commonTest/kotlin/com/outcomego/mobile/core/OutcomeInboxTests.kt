package com.outcomego.mobile.core

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.*
import kotlin.test.*

class OutcomeInboxTests {
    private val decision get() = mobileJson.decodeFromString<OutcomeDecision>(OutcomeInboxFixtures.DECISION)

    @Test
    fun frozenInboxAndHumanHistoryKeepUnknownFieldsAndStatuses() {
        val page = mobileJson.decodeFromString<OutcomeInboxPage>(OutcomeInboxFixtures.INBOX)
        assertEquals(setOf("decision_pending", "acceptance_pending", "human_action_pending", "completed"), page.items.map { it.category }.toSet())
        val human = mobileJson.decodeFromString<OutcomeHumanWorkItem>(OutcomeInboxFixtures.HUMAN)
        assertEquals("future_status", human.status)
        assertEquals("future_input", human.card?.inputFields?.single()?.type)
        assertTrue(human.card?.references?.single()?.stale == true)
        assertEquals("rejected", human.receipts.single().status)
        assertEquals("Add a photo", human.receipts.single().reviewComment)
        assertEquals("Missing photo", human.receipts.single().missingRequirements.single().label)
        assertTrue(decision.canResolve)
    }

    @Test
    fun uncertainRetryReusesBodyAndRequestIdUntilUserEdits() {
        var ids = 0
        val selected = OutcomeDecisionDraft().choose("keep").prepare(decision) { "request-${++ids}" }
        val retry = selected.prepare(decision.copy(contractRevision = 2)) { "request-${++ids}" }
        assertEquals(selected.attempt, retry.attempt)
        assertEquals(1, ids)
        val custom = retry.edit("  Explain the result  ").prepare(decision) { "request-${++ids}" }
        assertNull(custom.attempt?.optionId)
        assertEquals("Explain the result", custom.attempt?.customText)
        assertEquals("request-2", custom.attempt?.clientRequestId)
    }

    @Test
    fun conflictRefreshKeepsChoiceButCannotSubmitRemovedOrClosedOptions() {
        val draft = OutcomeDecisionDraft().choose("keep")
        assertTrue(draft.validFor(decision))
        assertEquals("keep", draft.optionId)
        assertFalse(draft.validFor(decision.copy(options = emptyList())))
        for (state in listOf("resolved", "expired", "withdrawn", "future_status")) {
            assertFalse(draft.validFor(decision.copy(status = state)))
        }
        assertFalse(OutcomeDecisionDraft().edit("x".repeat(4001)).validFor(decision))
        assertFalse(OutcomeDecisionDraft().edit("custom").validFor(decision.copy(customEntryAllowed = false)))
    }

    @Test
    fun requestContainsOnlyChoiceRevisionAndStableId() = runTest {
        val calls = mutableListOf<MobileRequest>()
        val api = TransportOutcomeInboxApi(object : OutcomeGoTransport {
            override suspend fun execute(server: String, token: String?, request: MobileRequest): MobileResponse {
                assertEquals("fixture-token", token)
                calls += request
                val body = when {
                    request.path.contains("outcome-inbox") -> OutcomeInboxFixtures.INBOX
                    request.path.contains("work-items") -> OutcomeInboxFixtures.HUMAN
                    request.method == HttpMethod.GET -> OutcomeInboxFixtures.DECISION
                    else -> """{"decisionId":"d","status":"resolved","outcomeId":"o","contractRevision":1,"resolutionEffect":"plan_only","resume":{"status":"enqueued","workItemIds":[]},"future":true}"""
                }
                return MobileResponse(200, body = body)
            }
        })
        api.list("https://fixture.invalid", "fixture-token", "completed", "opaque/+=")
        api.decision("https://fixture.invalid", "fixture-token", "decision/id")
        api.humanWorkItem("https://fixture.invalid", "fixture-token", "work/id")
        val input = OutcomeDecisionDraft().choose("keep").prepare(decision) { "request-1" }.attempt!!
        repeat(2) { api.resolve("https://fixture.invalid", "fixture-token", "decision/id", input) }
        assertTrue(calls.first().path.contains("status=all"))
        assertTrue(calls.first().path.contains("cursor=opaque%2F%2B%3D"))
        assertTrue(calls.take(3).all { it.method == HttpMethod.GET && it.body == null })
        assertTrue(calls.drop(3).all { it.method == HttpMethod.POST && it.path.endsWith("/resolve") })
        assertEquals(calls[3].body, calls[4].body)
        val body = mobileJson.parseToJsonElement(calls[3].body!!).jsonObject
        assertEquals(setOf("optionId", "expectedContractRevision", "clientRequestId"), body.keys)
    }

    @Test
    fun onlyInboxCollection404MeansUnsupported() = runTest {
        var status = 404
        val api = TransportOutcomeInboxApi(object : OutcomeGoTransport {
            override suspend fun execute(server: String, token: String?, request: MobileRequest) = MobileResponse(status)
        })
        assertNull(api.list("https://fixture.invalid", null))
        assertFailsWith<OutcomeGoRequestException> { api.decision("https://fixture.invalid", null, "missing") }
        status = 401
        assertEquals(401, assertFailsWith<OutcomeGoRequestException> { api.list("https://fixture.invalid", null) }.error.status)
    }

    @Test
    fun notificationTargetsAcceptOnlyKnownVersionTypeAndMatchingIdentity() {
        val outcome = "11111111-1111-4111-8111-111111111111"
        val decision = "22222222-2222-4222-8222-222222222222"
        val link = "outcomego://app/v1/outcomes/decision?id=$decision"
        val payload = mapOf("schemaVersion" to "1", "kind" to "outcome", "type" to "outcome.decision.required",
            "outcomeId" to outcome, "decisionId" to decision, "deepLink" to link)
        assertEquals(OutcomeLinkTarget(decisionId = decision), parseOutcomePushTarget(payload))
        assertNull(parseOutcomePushTarget(payload + ("schemaVersion" to "2")))
        assertNull(parseOutcomePushTarget(payload + ("type" to "outcome.future")))
        assertNull(parseOutcomePushTarget(payload + ("decisionId" to outcome)))
        for (invalid in listOf(link + "&token=private", link + "#secret", link.replace("outcomego://", "https://"), "outcomego://app/v1/outcomes?id=not-a-uuid")) {
            assertNull(parseOutcomeDeepLink(invalid))
        }
        for (type in listOf("outcome.review.required", "outcome.human_action.required", "outcome.accepted")) {
            assertEquals(OutcomeLinkTarget(outcomeId = outcome), parseOutcomePushTarget(payload + mapOf("type" to type, "deepLink" to "outcomego://app/v1/outcomes?id=$outcome")))
        }
    }
}
