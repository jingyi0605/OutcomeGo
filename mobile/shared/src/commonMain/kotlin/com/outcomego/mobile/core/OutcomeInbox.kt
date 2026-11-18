package com.outcomego.mobile.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString

@Serializable
data class OutcomeInboxItem(
    val id: String,
    val outcomeId: String,
    val contractRevision: Int,
    val decisionId: String? = null,
    val workItemId: String? = null,
    val criterionIds: List<String> = emptyList(),
    val category: String,
    val priority: Int,
    val title: String,
    val completed: String,
    val problem: String,
    val next: String,
    val requiresAction: Boolean,
    val availableAt: String,
    val createdAt: String,
    val read: Boolean,
)

@Serializable
data class OutcomeInboxPage(val items: List<OutcomeInboxItem>,
    val nextCursor: String? = null)

@Serializable
data class OutcomeDecisionOption(
    val id: String,
    val label: String,
    val consequence: String,
    val resolutionEffect: String,
    val source: String,
    val recommended: Boolean = false,
    val reason: String? = null,
)

@Serializable
data class OutcomeRecommendation(val optionId: String,
    val reason: String)

@Serializable
data class OutcomeDecision(
    val id: String,
    val outcomeId: String,
    val contractRevisionId: String,
    val contractRevision: Int,
    val runId: String? = null,
    val workItemId: String? = null,
    val status: String,
    val reasonCode: String,
    val completedSummary: String,
    val problemSummary: String,
    val nextStepSummary: String,
    val recommendation: OutcomeRecommendation? = null,
    val options: List<OutcomeDecisionOption>,
    val customEntryAllowed: Boolean,
    val expiresAt: String? = null,
    val resolvedOption: OutcomeDecisionOption? = null,
    val customText: String? = null,
    val resolvedBy: String? = null,
    val resolvedAt: String? = null,
    val truncatedOptionCount: Int = 0,
    val createdAt: String,
) {
    val canResolve: Boolean get() = status == "open" || status == "presented"
}

@Serializable
data class ResolveOutcomeDecision(
    val optionId: String? = null,
    val customText: String? = null,
    val expectedContractRevision: Int,
    val clientRequestId: String,
)

@Serializable
data class OutcomeDecisionResolution(
    val decisionId: String,
    val status: String,
    val outcomeId: String,
    val contractRevision: Int,
    val resolutionEffect: String,
    val resume: OutcomeDecisionResume,
)

@Serializable
data class OutcomeDecisionResume(
    val status: String,
    val workItemIds: List<String>,
    val revisionId: String? = null,
    val cardId: String? = null,
)

@Serializable
data class OutcomeKnowledgeReference(
    val id: String,
    val title: String,
    val sourceType: String,
    val sourceRef: String,
    val version: String,
    val updatedAt: String,
    val projectScope: String,
    val excerpt: String? = null,
    val digest: String? = null,
    val stale: Boolean,
    val permissionSummary: String,
)

@Serializable
data class HumanActionPrerequisite(val label: String,
    val completed: Boolean)
@Serializable
data class HumanActionStep(val id: String,
    val ordinal: Int,
    val text: String,
    val optional: Boolean)
@Serializable
data class HumanActionInputField(val id: String,
    val label: String,
    val type: String,
    val required: Boolean)
@Serializable
data class HumanActionEvidenceRequirement(
    val criterionId: String,
    val label: String,
    val acceptedTypes: List<String>,
    val required: Boolean,
)
@Serializable
data class HumanActionDraft(
    val currentStepId: String? = null,
    val draftSummary: String,
    val readReferenceIds: List<String>,
    val reason: String,
)
@Serializable
data class OutcomeHumanActionCard(
    val id: String,
    val workItemId: String,
    val outcomeId: String,
    val contractRevision: Int,
    val title: String,
    val purpose: String,
    val prerequisites: List<HumanActionPrerequisite>,
    val steps: List<HumanActionStep>,
    val inputFields: List<HumanActionInputField>,
    val evidenceRequirements: List<HumanActionEvidenceRequirement>,
    val references: List<OutcomeKnowledgeReference>,
    val status: String,
    val draft: HumanActionDraft? = null,
    val startedBy: String? = null,
    val startedAt: String? = null,
    val submittedAt: String? = null,
    val acceptedAt: String? = null,
)
@Serializable
data class OutcomeHumanWorkItem(
    val id: String,
    val outcomeId: String,
    val executorType: String,
    val kind: String,
    val status: String,
    val title: String,
    val contractRevision: Int,
    val runId: String? = null,
    val humanActionCardId: String? = null,
    val evidenceCount: Int,
    val nextAction: String? = null,
    val startedAt: String? = null,
    val card: OutcomeHumanActionCard? = null,
    val receipts: List<OutcomeHumanReceipt> = emptyList(),
)


@Serializable
data class OutcomeHumanReceipt(
    val id: String,
    val sequence: Int,
    val status: String,
    val submittedAt: String,
    val reviewComment: String? = null,
    val payload: OutcomeHumanReceiptPayload,
    val evidenceIds: List<String>,
    val missingRequirements: List<OutcomeHumanEvidenceGap>,
)
@Serializable
data class OutcomeHumanReceiptPayload(val comment: String = "", val text: String = "")
@Serializable
data class OutcomeHumanEvidenceGap(val criterionId: String, val kind: String, val label: String)

/** Immutable attempts survive ambiguous failures; editing the choice starts a new attempt. */
data class OutcomeDecisionDraft(
    val optionId: String? = null,
    val customText: String = "",
    val attempt: ResolveOutcomeDecision? = null,
) {
    fun choose(id: String?): OutcomeDecisionDraft = if (id == optionId) this else copy(optionId = id, attempt = null)
    fun edit(text: String): OutcomeDecisionDraft = if (text == customText && optionId == null) this
        else copy(optionId = null, customText = text, attempt = null)
    fun validFor(decision: OutcomeDecision): Boolean = decision.canResolve &&
        (if (optionId != null) decision.options.any { it.id == optionId }
        else decision.customEntryAllowed && customText.isNotBlank() && customText.length <= 4000)
    fun prepare(decision: OutcomeDecision, newRequestId: () -> String): OutcomeDecisionDraft {
        require(validFor(decision))
        if (attempt != null) return this
        return copy(attempt = ResolveOutcomeDecision(
            optionId = optionId, customText = if (optionId == null) customText.trim() else null,
            expectedContractRevision = decision.contractRevision, clientRequestId = newRequestId(),
        ))
    }
}

@Serializable
data class HumanWorkMutationRequest(
    val clientRequestId: String,
    val expectedContractRevision: Int,
)

@Serializable
data class HumanWorkPauseRequest(
    val clientRequestId: String,
    val expectedContractRevision: Int,
    val currentStepId: String? = null,
    val draftSummary: String = "",
    val readReferenceIds: List<String> = emptyList(),
    val reason: String,
)

@Serializable
data class HumanReceiptSourceRef(
    val type: String,
    val ref: String,
)

@Serializable
data class HumanReceiptObservation(
    val criterionId: String,
    val result: String = "observed",
    val value: String,
)

@Serializable
data class HumanReceiptRequest(
    val clientRequestId: String,
    val expectedContractRevision: Int,
    val comment: String = "",
    val text: String = "",
    val assetRefs: List<String> = emptyList(),
    val sourceRefs: List<HumanReceiptSourceRef> = emptyList(),
    val observations: List<HumanReceiptObservation> = emptyList(),
)

@Serializable
data class HumanKnowledgeSearchRequest(
    val text: String,
    val limit: Int = 20,
)

@Serializable
data class HumanKnowledgeReadRequest(
    val reference: OutcomeKnowledgeReference,
)

@Serializable
data class OutcomeKnowledgeDocument(
    val text: String,
    val digest: String,
)

class TransportOutcomeInboxApi(private val transport: OutcomeGoTransport) {
    suspend fun list(server: String, token: String?, category: String? = null, cursor: String? = null): OutcomeInboxPage? {
        val response = transport.execute(server, token, MobileRequest(HttpMethod.GET, outcomeInboxPath(category, cursor)))
        if (response.status == 404) return null
        return mobileJson.decodeFromString(response.requireSuccess().body)
    }
    suspend fun decision(server: String, token: String?, id: String): OutcomeDecision =
        mobileJson.decodeFromString(transport.execute(server, token,
            MobileRequest(HttpMethod.GET, outcomeDecisionPath(id))).requireSuccess().body)
    suspend fun resolve(server: String, token: String?, id: String, input: ResolveOutcomeDecision): OutcomeDecisionResolution =
        mobileJson.decodeFromString(transport.execute(server, token,
            MobileRequest(HttpMethod.POST, outcomeDecisionPath(id) + "/resolve", body = mobileJson.encodeToString(input)))
            .requireSuccess().body)
    suspend fun humanWorkItem(server: String, token: String?, id: String): OutcomeHumanWorkItem =
        mobileJson.decodeFromString(transport.execute(server, token,
            MobileRequest(HttpMethod.GET, outcomeHumanWorkItemPath(id))).requireSuccess().body)
    suspend fun startHumanWork(server: String, token: String?, id: String, input: HumanWorkMutationRequest): OutcomeHumanWorkItem =
        mobileJson.decodeFromString(transport.execute(server, token,
            MobileRequest(HttpMethod.POST, outcomeHumanWorkItemPath(id) + "/start", body = mobileJson.encodeToString(input)))
            .requireSuccess().body)
    suspend fun pauseHumanWork(server: String, token: String?, id: String, input: HumanWorkPauseRequest): OutcomeHumanWorkItem =
        mobileJson.decodeFromString(transport.execute(server, token,
            MobileRequest(HttpMethod.POST, outcomeHumanWorkItemPath(id) + "/pause", body = mobileJson.encodeToString(input)))
            .requireSuccess().body)
    suspend fun submitHumanReceipt(server: String, token: String?, id: String, input: HumanReceiptRequest): OutcomeHumanReceipt =
        mobileJson.decodeFromString(transport.execute(server, token,
            MobileRequest(HttpMethod.POST, outcomeHumanWorkItemPath(id) + "/receipts", body = mobileJson.encodeToString(input)))
            .requireSuccess().body)
    suspend fun searchKnowledge(server: String, token: String?, outcomeId: String, text: String): List<OutcomeKnowledgeReference> =
        mobileJson.decodeFromString(transport.execute(server, token,
            MobileRequest(HttpMethod.POST, "${outcomeDetailPath(outcomeId)}/knowledge/search", body = mobileJson.encodeToString(HumanKnowledgeSearchRequest(text))))
            .requireSuccess().body)
    suspend fun readKnowledge(server: String, token: String?, outcomeId: String, reference: OutcomeKnowledgeReference): OutcomeKnowledgeDocument =
        mobileJson.decodeFromString(transport.execute(server, token,
            MobileRequest(HttpMethod.POST, "${outcomeDetailPath(outcomeId)}/knowledge/read", body = mobileJson.encodeToString(HumanKnowledgeReadRequest(reference))))
            .requireSuccess().body)
}

fun outcomeInboxPath(category: String? = null, cursor: String? = null): String =
    "/api/v0/outcome-inbox?status=all&limit=30" +
        (category?.let { "&category=${outcomeSegment(it)}" } ?: "") +
        (cursor?.let { "&cursor=${outcomeSegment(it)}" } ?: "")
fun outcomeDecisionPath(id: String): String = "/api/v0/decisions/${outcomeSegment(id)}"
fun outcomeHumanWorkItemPath(id: String): String = "/api/v0/work-items/${outcomeSegment(id)}"

/** Only identity enters pending navigation. Notification text is never used to render a card. */
data class OutcomeLinkTarget(val outcomeId: String? = null,
    val decisionId: String? = null) {
    val deepLink: String get() = if (decisionId != null) "outcomego://app/v1/outcomes/decision?id=$decisionId"
        else "outcomego://app/v1/outcomes?id=$outcomeId"
}
private val outcomeUuid = Regex("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}")
fun parseOutcomeDeepLink(raw: String?): OutcomeLinkTarget? {
    if (raw == null) return null
    val prefix = when {
        raw.startsWith("outcomego://app/v1/outcomes/decision?id=") -> "outcomego://app/v1/outcomes/decision?id="
        raw.startsWith("outcomego://app/v1/outcomes?id=") -> "outcomego://app/v1/outcomes?id="
        else -> return null
    }
    val id = raw.removePrefix(prefix)
    if (!outcomeUuid.matches(id)) return null
    return if (prefix.contains("/decision")) OutcomeLinkTarget(decisionId = id) else OutcomeLinkTarget(outcomeId = id)
}
fun parseOutcomePushTarget(data: Map<String, String>): OutcomeLinkTarget? {
    if (data["schemaVersion"] != "1" || data["kind"] != "outcome") return null
    if (data["type"] !in setOf("outcome.decision.required", "outcome.review.required", "outcome.human_action.required", "outcome.accepted", "outcome.failed", "outcome.blocked")) return null
    val outcomeId = data["outcomeId"]?.takeIf { outcomeUuid.matches(it) } ?: return null
    val target = parseOutcomeDeepLink(data["deepLink"]) ?: return null
    return if (data["type"] == "outcome.decision.required") {
        target.takeIf { it.decisionId != null && it.decisionId == data["decisionId"] }
    } else target.takeIf { it.outcomeId == outcomeId }
}
