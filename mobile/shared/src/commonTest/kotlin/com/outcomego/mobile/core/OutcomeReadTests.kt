package com.outcomego.mobile.core

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.decodeFromString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OutcomeReadTests {
    @Test
    fun decodesFrozenDetailWithUnknownFieldsAndStatusValues() {
        val detail = mobileJson.decodeFromString<OutcomeDetail>(DETAIL)
        assertEquals("future_outcome_status", detail.status)
        assertEquals(2, detail.currentRevision)
        assertEquals("future_review_result", detail.currentRevisionView?.criteria?.single()?.latestResult)
        assertEquals("future_work_status", detail.workItems.single().status)
        assertEquals("Plan A recovers faster.", detail.outputs.single().content)
        assertEquals("Add cost comparison", detail.reviews.single().comment)
        assertEquals(detail.evidence.single().id, detail.reviews.single().evidenceIds.single())
    }

    @Test
    fun readsGetOnlyRoutesWithEncodedCursorAndSession() = runTest {
        val requests = mutableListOf<MobileRequest>()
        val api = TransportOutcomeReadApi(object : OutcomeGoTransport {
            override suspend fun execute(server: String, token: String?, request: MobileRequest): MobileResponse {
                assertEquals("https://fixture.invalid/team", server)
                assertEquals("fixture-token", token)
                assertEquals(HttpMethod.GET, request.method)
                assertNull(request.body)
                requests += request
                return MobileResponse(200, body = if (requests.size == 1) """{"items":[],"nextCursor":"next/+="}""" else DETAIL)
            }
        })
        assertEquals("next/+=", api.list("https://fixture.invalid/team", "fixture-token", "cursor/+=&")?.nextCursor)
        assertEquals("outcome-1", api.detail("https://fixture.invalid/team", "fixture-token", "outcome/one").id)
        assertEquals("/api/v0/outcomes?limit=20&cursor=cursor%2F%2B%3D%26", requests.first().path)
        assertEquals("/api/v0/outcomes/outcome%2Fone", requests.last().path)
    }

    @Test
    fun onlyCollection404MeansUnsupported() = runTest {
        var status = 404
        val api = TransportOutcomeReadApi(object : OutcomeGoTransport {
            override suspend fun execute(server: String, token: String?, request: MobileRequest) = MobileResponse(status)
        })
        assertNull(api.list("https://fixture.invalid", null))
        assertEquals(404, assertFailsWith<OutcomeGoRequestException> { api.detail("https://fixture.invalid", null, "missing") }.error.status)
        for (code in listOf(401, 403, 500)) {
            status = code
            assertEquals(code, assertFailsWith<OutcomeGoRequestException> { api.list("https://fixture.invalid", null) }.error.status)
        }
    }

    @Test
    fun handlesNullRevisionAndPaginatedSummary() {
        val page = mobileJson.decodeFromString<OutcomeListPage>("""{"items":[{"id":"draft","title":"Draft","status":"draft","botId":"b","currentRevision":null,"updatedAt":"now","extra":true}],"nextCursor":null}""")
        assertNull(page.items.single().currentRevision)
        assertNull(page.nextCursor)
        assertTrue(outcomeDetailPath("研究").endsWith("%E7%A0%94%E7%A9%B6"))
    }

    private companion object {
        val DETAIL = """{
  "id": "outcome-1",
  "title": "Compare backup plans",
  "status": "future_outcome_status",
  "botId": "bot-1",
  "currentRevision": 2,
  "updatedAt": "2026-11-17T10:00:00.123Z",
  "description": "Compare two fictional backup plans.",
  "futureField": {
    "enabled": true
  },
  "currentRevisionView": {
    "id": "revision-2",
    "revision": 2,
    "status": "approved",
    "goal": [
      "Recommend a backup plan"
    ],
    "criteria": [
      {
        "id": "criterion-1",
        "ordinal": 1,
        "statement": "Compare cost and recovery time",
        "required": true,
        "verificationMethod": "future_verification",
        "latestResult": "future_review_result",
        "futureField": true
      }
    ]
  },
  "workItems": [
    {
      "id": "work-1",
      "contractRevision": 2,
      "executorType": "agent",
      "kind": "execution",
      "title": "Research plans",
      "status": "future_work_status",
      "statusReason": null,
      "ordinal": 1
    }
  ],
  "outputs": [
    {
      "id": "output-1",
      "workItemId": "work-1",
      "kind": "future_output_kind",
      "title": "Comparison",
      "content": "Plan A recovers faster.",
      "contentRef": "outcomes/outcome-1/work-1/report.md",
      "createdAt": "2026-11-17T09:00:00Z"
    }
  ],
  "evidence": [
    {
      "id": "evidence-1",
      "criterionId": "criterion-1",
      "contractRevision": 2,
      "sourceType": "file",
      "sourceRef": "report.md",
      "contentSummary": "Recovery comparison",
      "credibility": "future_credibility"
    }
  ],
  "reviews": [
    {
      "id": "review-1",
      "criterionId": "criterion-1",
      "contractRevision": 2,
      "sequence": 1,
      "result": "FAIL",
      "evidenceIds": [
        "evidence-1"
      ],
      "comment": "Add cost comparison",
      "reviewedBy": "owner:local",
      "reviewedAt": "2026-11-17T10:00:00Z"
    }
  ]
}"""
    }
}
