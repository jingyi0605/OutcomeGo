package com.outcomego.mobile.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonElement

// Status keys remain strings so a newer server cannot break an older mobile client.
@Serializable
data class OutcomeSummary(
    val id: String,
    val title: String,
    val status: String,
    val botId: String,
    val currentRevision: Int? = null,
    val updatedAt: String,
)

@Serializable
data class OutcomeListPage(
    val items: List<OutcomeSummary>,
    val nextCursor: String? = null,
)

@Serializable
data class OutcomeDetail(
    val id: String,
    val title: String,
    val status: String,
    val botId: String,
    val currentRevision: Int? = null,
    val updatedAt: String,
    val description: String,
    val currentRevisionView: OutcomeContractRevision? = null,
    val workItems: List<OutcomeWorkItem> = emptyList(),
    val outputs: List<OutcomeOutput> = emptyList(),
    val evidence: List<OutcomeEvidence> = emptyList(),
    val reviews: List<OutcomeReview> = emptyList(),
    val plan: OutcomePlan? = null,
    val prereview: OutcomePrereview? = null,
)

@Serializable
data class OutcomePlanTask(
    val key: String,
    val title: String,
    val instructions: String,
    val botId: String,
    val dependsOn: List<String> = emptyList(),
    val covers: List<String> = emptyList(),
    val nature: String,
)

@Serializable
data class OutcomePlan(
    val notes: String? = null,
    val tasks: List<OutcomePlanTask> = emptyList(),
)

@Serializable
data class OutcomeTaskReviewBoundary(
    val side: String,
    val index: Int,
)

@Serializable
data class OutcomeTaskReviewBasis(
    val criterionId: String? = null,
    val boundary: OutcomeTaskReviewBoundary? = null,
)

@Serializable
data class OutcomeTaskReviewFinding(
    val kind: String,
    val basis: OutcomeTaskReviewBasis,
    val reason: String,
)

@Serializable
data class OutcomeWorkItemReview(
    val state: String,
    val findings: List<OutcomeTaskReviewFinding> = emptyList(),
    val reworkWorkItemId: String? = null,
)

@Serializable
data class OutcomePrereviewAttention(
    val criterionId: String? = null,
    val question: String,
)

@Serializable
data class OutcomePrereviewResult(
    val criterionId: String,
    val suggestion: String,
    val reason: String,
    val evidenceIds: List<String> = emptyList(),
)

@Serializable
data class OutcomePrereview(
    val turnId: String,
    val revision: Int,
    val summary: String,
    val attention: List<OutcomePrereviewAttention> = emptyList(),
    val results: List<OutcomePrereviewResult> = emptyList(),
    val createdAt: String,
)

@Serializable
data class OutcomeBoundaries(
    val included: List<String> = emptyList(),
    val excluded: List<String> = emptyList(),
)

@Serializable
data class OutcomeBudget(
    val timeLimitMinutes: Int? = null,
    val costLimit: Double? = null,
)

@Serializable
data class OutcomeContractRevision(
    val id: String,
    val revision: Int,
    val status: String,
    val goal: List<String>,
    val criteria: List<OutcomeCriterion>,
    val boundaries: OutcomeBoundaries? = null,
    val budget: OutcomeBudget? = null,
    val changeSummary: String? = null,
    val conflicts: List<OutcomeContractConflict> = emptyList(),
)

/** Planning question recorded on a revision; only `blocking` ones gate approval. */
@Serializable
data class OutcomeContractConflict(
    val severity: String,
    val message: String,
)

/** Advisory presentation of saved records; it never carries approval, readiness or task status. */
@Serializable
data class OutcomeBriefItem(
    val title: String,
    val explanation: String,
    val quote: String,
)

@Serializable
data class OutcomeBrief(
    val outcomeId: String,
    val revisionId: String? = null,
    val sourceKey: String = "",
    val background: OutcomeBriefItem,
    val intent: OutcomeBriefItem,
    val prerequisites: List<OutcomeBriefItem> = emptyList(),
    val risks: List<OutcomeBriefItem> = emptyList(),
    val proposedTasks: List<OutcomeBriefItem> = emptyList(),
)

@Serializable
data class OutcomeCriterion(
    val id: String,
    val ordinal: Int,
    val statement: String,
    val required: Boolean,
    val verificationMethod: String,
    val latestResult: String? = null,
)

@Serializable
data class OutcomeWorkItem(
    val id: String,
    val contractRevision: Int,
    val botId: String? = null,
    val executorType: String,
    val kind: String,
    val title: String,
    val status: String,
    val statusReason: String? = null,
    val ordinal: Int,
    val planKey: String? = null,
    val nature: String? = null,
    val review: OutcomeWorkItemReview? = null,
    val dependsOn: List<String> = emptyList(),
)

@Serializable
data class OutcomeOutput(
    val id: String,
    val workItemId: String,
    val kind: String,
    val title: String,
    val content: String? = null,
    val contentRef: String? = null,
    val createdAt: String,
)

@Serializable
data class OutcomeEvidence(
    val id: String,
    val criterionId: String? = null,
    val contractRevision: Int,
    val sourceType: String,
    val sourceRef: String,
    val contentSummary: String,
    val credibility: String,
)

@Serializable
data class OutcomeReview(
    val id: String,
    val criterionId: String,
    val contractRevision: Int,
    val sequence: Int,
    val result: String,
    val evidenceIds: List<String>,
    val comment: String,
    val reviewedBy: String,
    val reviewedAt: String,
)

/** Null denotes an old server without the collection route; other errors remain visible. */
class TransportOutcomeReadApi(private val transport: OutcomeGoTransport) {
    suspend fun list(
        server: String,
        token: String?,
        cursor: String? = null,
        status: String? = null,
        query: String? = null,
    ): OutcomeListPage? {
        val response = transport.execute(server, token, MobileRequest(HttpMethod.GET, outcomeListPath(cursor, status, query)))
        if (response.status == 404) return null
        return mobileJson.decodeFromString(response.requireSuccess().body)
    }

    suspend fun detail(server: String, token: String?, id: String): OutcomeDetail {
        val response = transport.execute(server, token, MobileRequest(HttpMethod.GET, outcomeDetailPath(id)))
        return mobileJson.decodeFromString(response.requireSuccess().body)
    }
}

/** The bot's turn on a goal's own thread. Words the owner sent are kept as sent (specs/004.8). */
@Serializable
data class OutcomeThreadTurnError(
    val code: String = "",
    val message: String = "",
)

@Serializable
data class OutcomeThreadTurn(
    val id: String,
    val purpose: String,
    val trigger: String,
    val status: String,
    val reply: String? = null,
    val error: OutcomeThreadTurnError? = null,
    val runId: String? = null,
    val workItemId: String? = null,
    val createdAt: String,
    val updatedAt: String,
) {
    /** Queued or running: the bot is still working on it. */
    val inProgress: Boolean get() = status == "queued" || status == "running"
}

@Serializable
data class OutcomeThreadView(
    val threadId: String? = null,
    val turns: List<OutcomeThreadTurn> = emptyList(),
    val reviewerThreadId: String? = null,
    val reviewTurns: List<OutcomeThreadTurn> = emptyList(),
)

/** A new goal described in the owner's own words; the chosen bot plans it. */
@Serializable
data class CreateOutcomeThreadRequest(
    val text: String,
    val botId: String,
    val exploreIdeaId: String? = null,
    val clientRequestId: String,
)

@Serializable
data class CreatedOutcomeThread(
    val outcome: OutcomeDetail,
    val turn: OutcomeThreadTurn,
)

/** The owner's words about a goal; they reach the bot unchanged. */
@Serializable
data class SendOutcomeThreadMessageRequest(
    val text: String,
    val clientRequestId: String,
)

@Serializable
data class OutcomeCriterionDraftInput(
    val statement: String,
    val required: Boolean,
)

@Serializable
data class OutcomeContractDraftInput(
    val goal: List<String>,
    val acceptance: List<OutcomeCriterionDraftInput>,
    val boundaries: OutcomeBoundaries = OutcomeBoundaries(),
    val budget: OutcomeBudget? = null,
)

@Serializable
data class CreateContractRevisionRequest(
    val baseRevision: Int,
    val contract: OutcomeContractDraftInput,
    val changeSummary: String? = null,
    val sourceDecisionId: String? = null,
    val clientRequestId: String,
)

@Serializable
data class ApproveContractRevisionRequest(
    val expectedRevision: Int,
    val confirmationText: String,
    val clientRequestId: String,
)

@Serializable
data class StartOutcomeRunRequest(
    val expectedRevision: Int,
    val clientRequestId: String,
)

@Serializable
data class CancelOutcomeRequest(
    val clientRequestId: String,
)

@Serializable
data class OutcomeCriterionReviewInput(
    val criterionId: String,
    val result: String,
    val evidenceIds: List<String> = emptyList(),
    val comment: String = "",
    val userConfirmed: Boolean? = null,
)

@Serializable
data class OutcomeNewEvidenceInput(
    val criterionId: String,
    val sourceType: String,
    val sourceRef: String,
    val contentSummary: String = "",
)

@Serializable
data class SubmitOutcomeReviewRequest(
    val expectedRevision: Int,
    val results: List<OutcomeCriterionReviewInput>,
    val newEvidence: List<OutcomeNewEvidenceInput>? = null,
    val clientRequestId: String,
)

@Serializable
data class OutcomeReworkRequest(
    val criterionIds: List<String>,
    val comment: String,
    val expectedRevision: Int,
    val clientRequestId: String,
)

@Serializable
data class AdoptPrereviewRequest(
    val expectedRevision: Int,
    val turnId: String,
    val clientRequestId: String,
)

@Serializable
data class OutcomeTranscriptRow(
    val id: String,
    val at: String,
    val role: String,
    val status: String,
    val content: String,
)

@Serializable
data class OutcomeTranscriptPage(
    val rows: List<OutcomeTranscriptRow> = emptyList(),
    val next_before: Int? = null,
)

class TransportOutcomeWriteApi(private val transport: OutcomeGoTransport) {
    suspend fun createThread(server: String, token: String?, input: CreateOutcomeThreadRequest): CreatedOutcomeThread =
        decode(transport.execute(server, token, MobileRequest(HttpMethod.POST, outcomeThreadsPath(), body = mobileJson.encodeToString(input))))

    suspend fun thread(server: String, token: String?, id: String): OutcomeThreadView =
        decode(transport.execute(server, token, MobileRequest(HttpMethod.GET, outcomeThreadPath(id))))

    suspend fun sendThreadMessage(server: String, token: String?, id: String, input: SendOutcomeThreadMessageRequest): OutcomeThreadTurn =
        decode(transport.execute(server, token, MobileRequest(HttpMethod.POST, "${outcomeThreadPath(id)}/messages", body = mobileJson.encodeToString(input))))

    suspend fun revise(server: String, token: String?, id: String, input: CreateContractRevisionRequest): OutcomeDetail =
        decode(transport.execute(server, token, MobileRequest(HttpMethod.POST, "${outcomeDetailPath(id)}/revisions", body = mobileJson.encodeToString(input))))

    suspend fun approve(server: String, token: String?, id: String, revision: Int, input: ApproveContractRevisionRequest): OutcomeDetail =
        decode(transport.execute(server, token, MobileRequest(HttpMethod.POST, "${outcomeDetailPath(id)}/revisions/$revision/approve", body = mobileJson.encodeToString(input))))

    suspend fun startRun(server: String, token: String?, id: String, input: StartOutcomeRunRequest): OutcomeDetail =
        decode(transport.execute(server, token, MobileRequest(HttpMethod.POST, "${outcomeDetailPath(id)}/runs", body = mobileJson.encodeToString(input))))

    suspend fun cancel(server: String, token: String?, id: String, input: CancelOutcomeRequest): OutcomeDetail =
        decode(transport.execute(server, token, MobileRequest(HttpMethod.POST, "${outcomeDetailPath(id)}/cancel", body = mobileJson.encodeToString(input))))

    suspend fun submitReview(server: String, token: String?, id: String, input: SubmitOutcomeReviewRequest): OutcomeDetail =
        decode(transport.execute(server, token, MobileRequest(HttpMethod.POST, "${outcomeDetailPath(id)}/reviews", body = mobileJson.encodeToString(input))))

    suspend fun rework(server: String, token: String?, id: String, input: OutcomeReworkRequest): OutcomeDetail =
        decode(transport.execute(server, token, MobileRequest(HttpMethod.POST, "${outcomeDetailPath(id)}/rework", body = mobileJson.encodeToString(input))))

    suspend fun adoptPrereview(server: String, token: String?, id: String, input: AdoptPrereviewRequest): OutcomeDetail =
        decode(transport.execute(server, token, MobileRequest(HttpMethod.POST, "${outcomeDetailPath(id)}/reviews/adopt-prereview", body = mobileJson.encodeToString(input))))

    suspend fun transcript(server: String, token: String?, outcomeId: String, workItemId: String, before: Int? = null): JsonElement =
        mobileJson.decodeFromString(
            transport.execute(server, token, MobileRequest(HttpMethod.GET, outcomeTranscriptPath(outcomeId, workItemId, before)))
                .requireSuccess().body,
        )

    private inline fun <reified T> decode(response: MobileResponse): T =
        mobileJson.decodeFromString(response.requireSuccess().body)
}

fun outcomeListPath(cursor: String? = null, status: String? = null, query: String? = null): String =
    "/api/v0/outcomes?limit=20" +
        (cursor?.let { "&cursor=${outcomeSegment(it)}" } ?: "") +
        (status?.takeIf { it.isNotBlank() }?.let { "&status=${outcomeSegment(it)}" } ?: "") +
        (query?.takeIf { it.isNotBlank() }?.let { "&q=${outcomeSegment(it)}" } ?: "")

fun outcomeDetailPath(id: String): String = "/api/v0/outcomes/${outcomeSegment(id)}"

fun outcomeBriefPath(id: String): String = "${outcomeDetailPath(id)}/brief"

fun outcomeThreadsPath(): String = "/api/v0/outcomes/threads"

fun outcomeThreadPath(id: String): String = "${outcomeDetailPath(id)}/thread"

fun outcomeTranscriptPath(outcomeId: String, workItemId: String, before: Int? = null): String =
    "${outcomeDetailPath(outcomeId)}/work-items/${outcomeSegment(workItemId)}/transcript" +
        (before?.let { "?before=$it" } ?: "")

internal fun outcomeSegment(value: String): String = buildString {
    for (byte in value.encodeToByteArray()) {
        val code = byte.toInt() and 0xff
        if (code in 65..90 || code in 97..122 || code in 48..57 || code.toChar() in "-._~") append(code.toChar())
        else append('%').append(code.toString(16).uppercase().padStart(2, '0'))
    }
}
