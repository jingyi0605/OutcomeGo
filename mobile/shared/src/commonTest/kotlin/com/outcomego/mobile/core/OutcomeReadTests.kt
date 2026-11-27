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
    fun decodesPlanTaskReviewAndPrereviewPayloads() {
        val payload = """{
          "id": "outcome-2",
          "title": "Plan test",
          "status": "review_pending",
          "botId": "bot-planner",
          "currentRevision": 1,
          "updatedAt": "2026-11-22T00:00:00Z",
          "description": "Goal description",
          "plan": {
            "notes": "Keep neutral task phrasing",
            "tasks": [{
              "key": "draft-doc",
              "title": "Draft doc",
              "instructions": "Write draft",
              "botId": "bot-exec",
              "dependsOn": [],
              "covers": ["criterion-1"],
              "nature": "deliverable"
            }]
          },
          "workItems": [{
            "id": "w-1",
            "contractRevision": 1,
            "botId": "bot-exec",
            "executorType": "agent",
            "kind": "execution",
            "title": "Draft doc",
            "status": "completed",
            "ordinal": 1,
            "planKey": "draft-doc",
            "nature": "deliverable",
            "review": {
              "state": "rejected_once",
              "findings": [{
                "kind": "omission",
                "basis": { "criterionId": "criterion-1" },
                "reason": "Missing executive summary"
              }],
              "reworkWorkItemId": "w-2"
            }
          }],
          "prereview": {
            "turnId": "turn-1",
            "revision": 1,
            "summary": "1 likely pass, 1 needs attention",
            "attention": [{ "criterionId": "criterion-1", "question": "Confirm tone" }],
            "results": [{
              "criterionId": "criterion-1",
              "suggestion": "likely_pass",
              "reason": "All sections covered",
              "evidenceIds": ["ev-1"]
            }],
            "createdAt": "2026-11-22T00:00:00Z"
          }
        }"""
        val decoded = mobileJson.decodeFromString<OutcomeDetail>(payload)
        assertEquals("Keep neutral task phrasing", decoded.plan?.notes)
        assertEquals("deliverable", decoded.plan?.tasks?.single()?.nature)
        assertEquals("rejected_once", decoded.workItems.single().review?.state)
        assertEquals("Missing executive summary", decoded.workItems.single().review?.findings?.single()?.reason)
        assertEquals("turn-1", decoded.prereview?.turnId)
        assertEquals("likely_pass", decoded.prereview?.results?.single()?.suggestion)

        val thread = mobileJson.decodeFromString<OutcomeThreadView>(
            """{"threadId":"th-1","turns":[],"reviewerThreadId":"th-rev","reviewTurns":[{"id":"rt-1","purpose":"review_task","trigger":"task","status":"completed","reply":"Passed","workItemId":"w-1","createdAt":"now","updatedAt":"now"}]}""",
        )
        assertEquals("th-rev", thread.reviewerThreadId)
        assertEquals("w-1", thread.reviewTurns.single().workItemId)
    }

    @Test
    fun decodesBriefAndKeepsOlderDetailPayloadsWithoutConflictsOrDependencies() {
        val brief = mobileJson.decodeFromString<OutcomeBrief>(
            """{"outcomeId":"outcome-1","revisionId":null,"sourceKey":"k","futureField":1,
            "background":{"title":"Why","explanation":"Because","quote":"Original"},
            "intent":{"title":"Build it","explanation":"e","quote":"q"},
            "prerequisites":[{"title":"API key","explanation":"e","quote":"q"}],
            "risks":[],"proposedTasks":[{"title":"Step 1","explanation":"e","quote":"q"}]}""",
        )
        assertNull(brief.revisionId)
        assertEquals("Build it", brief.intent.title)
        assertEquals(1, brief.proposedTasks.size)
        assertEquals("/api/v0/outcomes/outcome%2Fone/brief", outcomeBriefPath("outcome/one"))

        val detail = mobileJson.decodeFromString<OutcomeDetail>(DETAIL)
        assertTrue(detail.currentRevisionView?.conflicts?.isEmpty() == true)
        assertTrue(detail.workItems.single().dependsOn.isEmpty())
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
        assertEquals("/api/v0/outcomes?limit=20&kinds=standard,tracked&cursor=cursor%2F%2B%3D%26", requests.first().path)
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

        val idea = mobileJson.decodeFromString<OutcomeListPage>(
            """{"items":[{"id":"idea","kind":"explore_idea","title":"Idea","status":"draft","botId":null,"revision":3,"currentRevision":null,"updatedAt":"now"}]}""",
        ).items.single()
        assertEquals("explore_idea", idea.kind)
        assertNull(idea.botId)
        assertEquals(3, idea.revision)
    }

    @Test
    fun titlesAGoalWithItsShortenedFirstLine() {
        assertEquals("Ship it", outcomeTitleFromWords("  Ship it  \r\nwith tests"))
        val sixty = "a".repeat(60)
        assertEquals(sixty, outcomeTitleFromWords(sixty))
        assertEquals("a".repeat(57) + "…", outcomeTitleFromWords(sixty + "b"))
        // An emoji straddling the cut is dropped whole.
        assertEquals("a".repeat(56) + "…", outcomeTitleFromWords("a".repeat(56) + "😀tail"))
    }

    @Test
    fun encodesOutcomeWritePathsAndBodies() = runTest {
        assertEquals(
            "/api/v0/outcomes?limit=20&kinds=standard,tracked&cursor=c1&statuses=running&query=plan%20a",
            outcomeListPath(cursor = "c1", status = "running", query = "plan a"),
        )
        assertEquals(
            "/api/v0/outcomes?limit=100&kinds=todo&view=needs_me",
            outcomeListPath(kinds = listOf("todo"), view = "needs_me", limit = 100),
        )
        assertEquals(
            "/api/v0/outcomes/o-1/work-items/w-1/transcript?before=5",
            outcomeTranscriptPath("o-1", "w-1", before = 5),
        )
        val seen = mutableListOf<MobileRequest>()
        val transport = object : OutcomeGoTransport {
            override suspend fun execute(server: String, token: String?, request: MobileRequest): MobileResponse {
                seen += request
                return when {
                    request.path == "/api/v0/outcomes" -> MobileResponse(
                        202,
                        body = """{"outcome":$DETAIL,"turn":{"id":"t-1","purpose":"plan","trigger":"goal","status":"queued","createdAt":"now","updatedAt":"now"}}""",
                    )
                    request.path.endsWith("/convert") -> MobileResponse(200, body = """{"outcome":$DETAIL,"turn":null}""")
                    request.path.endsWith("/thread/messages") -> MobileResponse(
                        202,
                        body = """{"id":"t-2","purpose":"owner_message","trigger":"取消目标","status":"queued","createdAt":"now","updatedAt":"now"}""",
                    )
                    request.path.endsWith("/thread") -> MobileResponse(
                        200,
                        body = """{"threadId":"th-1","turns":[{"id":"t-1","purpose":"plan","trigger":"goal","status":"completed","reply":"Done","createdAt":"now","updatedAt":"now"}],"reviewerThreadId":"th-rev-1","reviewTurns":[{"id":"rt-1","purpose":"review","trigger":"prereview","status":"completed","reply":"Summary","workItemId":null,"createdAt":"now","updatedAt":"now"}]}""",
                    )
                    else -> MobileResponse(200, body = DETAIL)
                }
            }
        }
        val writeApi = TransportOutcomeWriteApi(transport)
        val created = writeApi.create(
            "https://fixture.invalid",
            "tok",
            CreateOutcomeRequest(kind = "standard", title = "goal", description = "goal", botId = "b-1", clientRequestId = "req-12345678"),
        )
        assertEquals("outcome-1", created.outcome.id)
        assertTrue(created.turn?.inProgress == true)
        assertEquals(HttpMethod.POST, seen.last().method)
        assertEquals("/api/v0/outcomes", seen.last().path)
        // The server rejects unknown fields, so the body is exactly the contract's.
        assertEquals(
            """{"kind":"standard","title":"goal","description":"goal","botId":"b-1","clientRequestId":"req-12345678"}""",
            seen.last().body,
        )
        val converted = writeApi.convert(
            "https://fixture.invalid",
            "tok",
            "idea/1",
            ConvertOutcomeRequest(targetKind = "standard", expectedRevision = 3, botId = "b-1", clientRequestId = "req-convert-1"),
        )
        assertNull(converted.turn)
        assertEquals("/api/v0/outcomes/idea%2F1/convert", seen.last().path)
        assertEquals(
            """{"targetKind":"standard","expectedRevision":3,"botId":"b-1","clientRequestId":"req-convert-1"}""",
            seen.last().body,
        )
        writeApi.act(
            "https://fixture.invalid",
            "tok",
            "idea/1",
            OutcomeActionRequest(action = "dismiss", clientRequestId = "req-dismiss-1"),
        )
        assertEquals("/api/v0/outcomes/idea%2F1/actions", seen.last().path)
        assertEquals("""{"action":"dismiss","clientRequestId":"req-dismiss-1"}""", seen.last().body)
        writeApi.act(
            "https://fixture.invalid",
            "tok",
            "todo-1",
            OutcomeActionRequest("snooze", 2, OutcomeActionPayload("2030-01-02T03:04:00Z"), "req-snooze-1"),
        )
        assertEquals(
            """{"action":"snooze","expectedRevision":2,"payload":{"snoozeUntil":"2030-01-02T03:04:00Z"},"clientRequestId":"req-snooze-1"}""",
            seen.last().body,
        )
        // The owner's words go out untouched: no template, no intent label.
        val sent = writeApi.sendThreadMessage(
            "https://fixture.invalid",
            "tok",
            "outcome-1",
            SendOutcomeThreadMessageRequest("取消目标", "req-87654321"),
        )
        assertEquals("取消目标", sent.trigger)
        assertEquals(HttpMethod.POST, seen.last().method)
        assertTrue(seen.last().body!!.contains("\"text\":\"取消目标\""))
        val thread = writeApi.thread("https://fixture.invalid", "tok", "outcome-1")
        assertEquals("Done", thread.turns.single().reply)
        assertEquals(false, thread.turns.single().inProgress)
        assertEquals("/api/v0/outcomes/outcome-1/thread", outcomeThreadPath("outcome-1"))

        val adopted = writeApi.adoptPrereview(
            "https://fixture.invalid",
            "tok",
            "outcome-1",
            AdoptPrereviewRequest(expectedRevision = 2, turnId = "turn-rev-1", clientRequestId = "req-adopt-1234"),
        )
        assertEquals("outcome-1", adopted.id)
        assertEquals("/api/v0/outcomes/outcome-1/reviews/adopt-prereview", seen.last().path)
        assertTrue(seen.last().body!!.contains("\"turnId\":\"turn-rev-1\""))
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
