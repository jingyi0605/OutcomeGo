package com.aiteamos.platform

import com.aiteamos.android.data.MobileFeatureApi
import com.aiteamos.mobile.core.HttpMethod
import com.aiteamos.mobile.core.VoiceFrame
import com.aiteamos.mobile.core.decodeVoiceFrame
import com.aiteamos.mobile.core.encodeVoiceFrame
import com.aiteamos.mobile.core.voiceControl
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.util.UUID
import java.util.concurrent.TimeUnit

enum class AndroidLiveVoiceState { Idle, Connecting, Listening, Processing, Speaking, Interrupted, Reconnecting, Error }

data class AndroidLiveVoiceTranscript(
    val id: String,
    val role: Role,
    val text: String,
) {
    enum class Role { User, Assistant }
}

data class AndroidLiveVoiceSnapshot(
    val state: AndroidLiveVoiceState = AndroidLiveVoiceState.Idle,
    val partialTranscript: String = "",
    val error: String? = null,
    val transcript: List<AndroidLiveVoiceTranscript> = emptyList(),
)

/** Native Android client for the authenticated realtime voice protocol. */
class AndroidLiveVoiceSession(
    private val api: MobileFeatureApi,
    private val audio: LiveVoiceAudio,
    private val scope: CoroutineScope,
    private val onSnapshot: (AndroidLiveVoiceSnapshot) -> Unit,
    private val onTranscript: (String, Boolean, String?) -> Unit = { _, _, _ -> },
) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()
    private var socket: WebSocket? = null
    private var captureJob: Job? = null
    private var sessionId: String? = null
    private var sequence = 0u
    private var inputSequence = 0u
    private var stoppedGeneration: UInt? = null
    private var microphoneMuted = false
    private var speakerMuted = false
    private var serverReady = false
    private val transcript = mutableListOf<AndroidLiveVoiceTranscript>()

    fun start(botId: String, channelId: String) {
        if (sessionId != null) return
        transcript.clear()
        microphoneMuted = false
        speakerMuted = false
        serverReady = false
        emit(AndroidLiveVoiceState.Connecting)
        scope.launch {
            runCatching {
                val ticket = api.request(
                    HttpMethod.POST,
                    "/api/voice/sessions",
                    buildJsonObject {
                        put("botId", botId)
                        put("channelId", channelId)
                        put("clientPlatform", "android")
                        put("clientInstanceId", "android:${UUID.randomUUID()}")
                    },
                )
                val id = ticket.string("id")
                val path = ticket.string("path")
                val protocols = ticket["protocols"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty()
                require(id.isNotBlank() && path.isNotBlank() && protocols.size == 2) {
                    "The server returned an invalid voice ticket"
                }
                sessionId = id
                val capabilities = audio.start()
                openSocket(path, protocols, capabilities)
            }.onFailure { error -> fail(error.message ?: "Realtime voice is unavailable") }
        }
    }

    fun stop() {
        val id = sessionId
        captureJob?.cancel()
        captureJob = null
        socket?.send(control("stop"))
        sessionId = null
        serverReady = false
        socket?.close(1000, "Voice session stopped")
        socket = null
        audio.close()
        if (id != null) scope.launch { runCatching { api.request(HttpMethod.DELETE, "/api/voice/sessions/$id") } }
        emit(AndroidLiveVoiceState.Idle)
    }

    fun setMicrophoneMuted(muted: Boolean) {
        microphoneMuted = muted
        emit(currentState())
    }

    fun setSpeakerMuted(muted: Boolean) {
        speakerMuted = muted
        emit(currentState())
    }

    private fun openSocket(path: String, protocols: List<String>, capabilities: LiveVoiceAudioCapabilities) {
        val server = requireNotNull(api.serverAddress) { "Sign in to a server first" }
        val socketUrl = server.trimEnd('/')
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://") + path
        val request = Request.Builder()
            .url(socketUrl)
            .header("Sec-WebSocket-Protocol", protocols.joinToString(", "))
            .build()
        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(control("hello", buildJsonObject { put("echoCancellation", capabilities.echoCancellation) }))
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleControl(text)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                runCatching { handleOutput(bytes.toByteArray()) }
                    .onFailure { fail(it.message ?: "Invalid voice audio frame") }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (sessionId != null) fail(t.message ?: "Voice connection failed")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (sessionId != null && code != 1000) fail("Voice connection closed ($code)")
            }
        })
    }

    private fun startCapture() {
        captureJob = scope.launch(Dispatchers.IO) {
            val readBuffer = ShortArray(960)
            val frame = ShortArray(960)
            var frameSamples = 0
            while (isActive && sessionId != null && serverReady) {
                val count = audio.read(readBuffer)
                if (count <= 0) continue
                if (microphoneMuted) continue
                var offset = 0
                while (offset < count) {
                    val copied = minOf(count - offset, frame.size - frameSamples)
                    readBuffer.copyInto(frame, frameSamples, offset, offset + copied)
                    frameSamples += copied
                    offset += copied
                    if (frameSamples == frame.size) {
                        val payload = audio.encodeInputFrame(frame)
                        val packet = encodeVoiceFrame(
                            VoiceFrame(
                                VoiceFrame.Kind.Input,
                                0u,
                                inputSequence++,
                                (System.currentTimeMillis() and 0xffffffffL).toUInt(),
                                payload,
                            ),
                        )
                        socket?.send(ByteString.of(*packet))
                        frameSamples = 0
                    }
                }
            }
        }
    }

    private fun handleControl(text: String) {
        val message = com.aiteamos.mobile.core.mobileJson.parseToJsonElement(text).jsonObject
        when (message.string("type")) {
            "ready" -> {
                socket?.send(control("client_ready"))
                serverReady = true
                if (captureJob == null && sessionId != null) startCapture()
                emit(AndroidLiveVoiceState.Listening)
            }
            "turn.started" -> emit(AndroidLiveVoiceState.Listening)
            "transcript.partial" -> {
                val value = message.string("text")
                onTranscript(value, false, message.string("turnId"))
                emit(AndroidLiveVoiceState.Listening, partialTranscript = value)
            }
            "transcript.final" -> {
                val value = message.string("text")
                onTranscript(value, true, message.string("turnId"))
                if (value.isNotBlank()) {
                    transcript += AndroidLiveVoiceTranscript(
                        id = "${message.string("turnId")}:user",
                        role = AndroidLiveVoiceTranscript.Role.User,
                        text = value,
                    )
                }
                emit(AndroidLiveVoiceState.Processing)
            }
            "reply.message" -> {
                val value = message.string("text")
                if (value.isNotBlank()) {
                    transcript += AndroidLiveVoiceTranscript(
                        id = message.string("messageId"),
                        role = AndroidLiveVoiceTranscript.Role.Assistant,
                        text = value,
                    )
                }
                emit(AndroidLiveVoiceState.Speaking)
            }
            "audio.started" -> emit(AndroidLiveVoiceState.Speaking)
            "barge_in", "audio.stopped" -> {
                val generation = runCatching {
                    message["generation"]?.jsonPrimitive?.contentOrNull?.toUIntOrNull()
                }.getOrNull()
                if (generation != null) stoppedGeneration = maxOf(stoppedGeneration ?: 0u, generation)
                audio.closePlayback()
                emit(AndroidLiveVoiceState.Interrupted)
            }
            "ended" -> stop()
            "error" -> fail(message.string("message").ifBlank { "Voice session failed" })
        }
    }

    private fun handleOutput(bytes: ByteArray) {
        val frame = decodeVoiceFrame(bytes, VoiceFrame.Kind.Output)
        if (stoppedGeneration?.let { frame.generation <= it } == true) return
        if (speakerMuted) {
            socket?.send(control("playback.ack", buildJsonObject {
                put("generation", frame.generation.toLong())
                put("frameSequence", frame.sequence.toLong())
            }))
            return
        }
        audio.playOutputPacket(frame.payload, frame.generation, frame.sequence) { generation, sequence ->
            socket?.send(control("playback.ack", buildJsonObject {
                put("generation", generation.toLong())
                put("frameSequence", sequence.toLong())
            }))
        }
    }

    private fun control(type: String, fields: JsonObject = JsonObject(emptyMap())): String =
        com.aiteamos.mobile.core.mobileJson.encodeToString(
            JsonObject.serializer(),
            voiceControl(type, sessionId.orEmpty(), sequence++, fields),
        )

    private fun fail(message: String) {
        val id = sessionId
        sessionId = null
        serverReady = false
        captureJob?.cancel()
        captureJob = null
        socket?.close(1011, message.take(120))
        socket = null
        audio.close()
        if (id != null) {
            scope.launch { runCatching { api.request(HttpMethod.DELETE, "/api/voice/sessions/$id") } }
        }
        emit(AndroidLiveVoiceState.Error, error = message)
    }

    private fun currentState(): AndroidLiveVoiceState =
        when {
            sessionId == null -> AndroidLiveVoiceState.Idle
            socket == null -> AndroidLiveVoiceState.Connecting
            else -> AndroidLiveVoiceState.Listening
        }

    private fun emit(
        state: AndroidLiveVoiceState,
        partialTranscript: String = "",
        error: String? = null,
    ) {
        onSnapshot(
            AndroidLiveVoiceSnapshot(
                state = state,
                partialTranscript = partialTranscript,
                error = error,
                transcript = transcript.toList(),
            ),
        )
    }

    private fun JsonObject.string(name: String): String =
        this[name]?.jsonPrimitive?.contentOrNull.orEmpty()

    private fun String.toUIntOrNull(): UInt? =
        toULongOrNull()?.toUInt()
}
