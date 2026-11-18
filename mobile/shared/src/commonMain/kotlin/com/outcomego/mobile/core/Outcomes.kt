package com.outcomego.mobile.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString

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
)

@Serializable
data class OutcomeContractRevision(
    val id: String,
    val revision: Int,
    val status: String,
    val goal: List<String>,
    val criteria: List<OutcomeCriterion>,
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
    val executorType: String,
    val kind: String,
    val title: String,
    val status: String,
    val statusReason: String? = null,
    val ordinal: Int,
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
    suspend fun list(server: String, token: String?, cursor: String? = null): OutcomeListPage? {
        val response = transport.execute(server, token, MobileRequest(HttpMethod.GET, outcomeListPath(cursor)))
        if (response.status == 404) return null
        return mobileJson.decodeFromString(response.requireSuccess().body)
    }

    suspend fun detail(server: String, token: String?, id: String): OutcomeDetail {
        val response = transport.execute(server, token, MobileRequest(HttpMethod.GET, outcomeDetailPath(id)))
        return mobileJson.decodeFromString(response.requireSuccess().body)
    }
}

fun outcomeListPath(cursor: String? = null): String =
    "/api/v0/outcomes?limit=20" + (cursor?.let { "&cursor=${outcomeSegment(it)}" } ?: "")

fun outcomeDetailPath(id: String): String = "/api/v0/outcomes/${outcomeSegment(id)}"

internal fun outcomeSegment(value: String): String = buildString {
    for (byte in value.encodeToByteArray()) {
        val code = byte.toInt() and 0xff
        if (code in 65..90 || code in 97..122 || code in 48..57 || code.toChar() in "-._~") append(code.toChar())
        else append('%').append(code.toString(16).uppercase().padStart(2, '0'))
    }
}
