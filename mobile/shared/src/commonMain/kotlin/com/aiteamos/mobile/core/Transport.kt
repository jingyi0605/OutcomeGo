package com.aiteamos.mobile.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

enum class HttpMethod { GET, POST, PUT, PATCH, DELETE }

data class MobileRequest(
    val method: HttpMethod,
    val path: String,
    val headers: Map<String, String> = emptyMap(),
    val body: String? = null,
)

data class MobileResponse(
    val status: Int,
    val headers: Map<String, String> = emptyMap(),
    val body: String = "",
) {
    val isSuccessful: Boolean get() = status in 200..299
}

/** Platform implementations own HTTP, redirect, cookie, and timeout policy. */
interface AiTeamOSTransport {
    suspend fun execute(server: String, token: String?, request: MobileRequest): MobileResponse
}

data class AiTeamOSError(
    val status: Int,
    val code: String?,
    val message: String,
    val retryable: Boolean? = null,
    val requestId: String? = null,
)

class AiTeamOSRequestException(val error: AiTeamOSError) : Exception(error.message)

/** Structured server error fields are retained; malformed error bodies still expose HTTP status. */
fun MobileResponse.requireSuccess(json: Json = mobileJson): MobileResponse {
    if (isSuccessful) return this

    val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull()
    val nested = root?.get("error")?.let { runCatching { it.jsonObject }.getOrNull() }
    val error = AiTeamOSError(
        status = status,
        code = nested?.get("code")?.jsonPrimitive?.contentOrNull()
            ?: root?.get("code")?.jsonPrimitive?.contentOrNull(),
        message = nested?.get("message")?.jsonPrimitive?.contentOrNull()
            ?: root?.get("message")?.jsonPrimitive?.contentOrNull()
            ?: "Request failed ($status)",
        retryable = nested?.get("retryable")?.jsonPrimitive?.booleanOrNull,
        requestId = nested?.get("requestId")?.jsonPrimitive?.contentOrNull(),
    )
    throw AiTeamOSRequestException(error)
}

private fun kotlinx.serialization.json.JsonPrimitive.contentOrNull(): String? =
    if (isString) content else null

val mobileJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}
