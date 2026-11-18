package com.outcomego.mobile.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString

@Serializable
data class ExploreSourceReference(
    val sourceRef: String,
    val title: String? = null,
    val sourceType: String? = null,
    val version: String? = null,
)

@Serializable
data class ExploreIdea(
    val id: String,
    val botId: String? = null,
    val title: String,
    val note: String,
    val status: String,
    val sourceOutcomeId: String? = null,
    val sourceReferences: List<ExploreSourceReference> = emptyList(),
    val budget: OutcomeBudget? = null,
    val planningDraftId: String? = null,
    val proposedOutcomeId: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val discardedAt: String? = null,
)

@Serializable
data class ExploreIdeaPage(
    val items: List<ExploreIdea>,
    val nextCursor: String? = null,
)

@Serializable
data class CreateExploreIdeaRequest(
    val title: String,
    val note: String? = null,
    val botId: String? = null,
    val sourceOutcomeId: String? = null,
    val sourceReferences: List<ExploreSourceReference>? = null,
    val budget: OutcomeBudget? = null,
    val status: String? = null,
    val clientRequestId: String,
)

@Serializable
data class ProposeExploreIdeaRequest(
    val botId: String? = null,
    val clientRequestId: String,
)

@Serializable
data class DiscardExploreIdeaRequest(
    val clientRequestId: String,
)

@Serializable
data class ExploreProposal(
    val idea: ExploreIdea,
    val plan: OutcomePlanningDraft,
)

class TransportExploreApi(private val transport: OutcomeGoTransport) {
    suspend fun list(server: String, token: String?, cursor: String? = null): ExploreIdeaPage? {
        val response = transport.execute(server, token, MobileRequest(HttpMethod.GET, exploreListPath(cursor)))
        if (response.status == 404) return null
        return mobileJson.decodeFromString(response.requireSuccess().body)
    }

    suspend fun get(server: String, token: String?, id: String): ExploreIdea =
        mobileJson.decodeFromString(
            transport.execute(server, token, MobileRequest(HttpMethod.GET, exploreItemPath(id))).requireSuccess().body,
        )

    suspend fun create(server: String, token: String?, input: CreateExploreIdeaRequest): ExploreIdea =
        mobileJson.decodeFromString(
            transport.execute(
                server,
                token,
                MobileRequest(HttpMethod.POST, "/api/v0/explore", body = mobileJson.encodeToString(input)),
            ).requireSuccess().body,
        )

    suspend fun propose(server: String, token: String?, id: String, input: ProposeExploreIdeaRequest): ExploreProposal =
        mobileJson.decodeFromString(
            transport.execute(
                server,
                token,
                MobileRequest(HttpMethod.POST, "${exploreItemPath(id)}/propose", body = mobileJson.encodeToString(input)),
            ).requireSuccess().body,
        )

    suspend fun discard(server: String, token: String?, id: String, input: DiscardExploreIdeaRequest): ExploreIdea =
        mobileJson.decodeFromString(
            transport.execute(
                server,
                token,
                MobileRequest(HttpMethod.POST, "${exploreItemPath(id)}/discard", body = mobileJson.encodeToString(input)),
            ).requireSuccess().body,
        )
}

fun exploreListPath(cursor: String? = null): String =
    "/api/v0/explore?limit=20" + (cursor?.let { "&cursor=${outcomeSegment(it)}" } ?: "")

fun exploreItemPath(id: String): String = "/api/v0/explore/${outcomeSegment(id)}"
