package com.aiteamos.mobile.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable
data class VoiceAudioConfig(
    val codec: String = "opus",
    val sampleRate: Int,
    val channels: Int = 1,
    val frameMs: Int = 20,
    val maxFrameBytes: Int = 1500,
)

const val VOICE_PROTOCOL_VERSION: Int = 1
const val VOICE_FRAME_HEADER_BYTES: Int = 18
const val VOICE_MAX_OPUS_PACKET_BYTES: Int = 1_275
const val VOICE_MAX_FRAME_BYTES: Int = 1_500

data class VoiceSessionTicket(
    val id: String,
    val path: String,
    val protocols: List<String>,
    val input: VoiceAudioConfig,
    val output: VoiceAudioConfig,
)

data class VoiceFrame(
    val kind: Kind,
    val generation: UInt,
    val sequence: UInt,
    val timestampMs: UInt,
    val payload: ByteArray,
) {
    enum class Kind { Input, Output }
}

fun encodeVoiceFrame(frame: VoiceFrame): ByteArray {
    require(frame.payload.size <= VOICE_MAX_OPUS_PACKET_BYTES) { "Opus packet is too large" }
    val result = ByteArray(VOICE_FRAME_HEADER_BYTES + frame.payload.size)
    result[0] = 0x4f
    result[1] = 0x56
    result[2] = VOICE_PROTOCOL_VERSION.toByte()
    result[3] = if (frame.kind == VoiceFrame.Kind.Input) 1 else 2
    putUInt(result, 4, frame.generation)
    putUInt(result, 8, frame.sequence)
    putUInt(result, 12, frame.timestampMs)
    putUShort(result, 16, frame.payload.size)
    frame.payload.copyInto(result, VOICE_FRAME_HEADER_BYTES)
    return result
}

fun decodeVoiceFrame(bytes: ByteArray, expected: VoiceFrame.Kind? = null): VoiceFrame {
    require(bytes.size in VOICE_FRAME_HEADER_BYTES..VOICE_MAX_FRAME_BYTES) { "Voice frame length is invalid" }
    require(bytes[0].toInt() and 0xff == 0x4f && bytes[1].toInt() and 0xff == 0x56) { "Voice frame header is invalid" }
    require(bytes[2].toInt() and 0xff == VOICE_PROTOCOL_VERSION) { "Voice frame version is unsupported" }
    val kind = when (bytes[3].toInt() and 0xff) {
        1 -> VoiceFrame.Kind.Input
        2 -> VoiceFrame.Kind.Output
        else -> error("Voice frame direction is invalid")
    }
    require(expected == null || kind == expected) { "Voice frame direction is invalid" }
    val payloadSize = readUShort(bytes, 16)
    require(payloadSize <= VOICE_MAX_OPUS_PACKET_BYTES && payloadSize + VOICE_FRAME_HEADER_BYTES == bytes.size) { "Voice frame payload length is invalid" }
    return VoiceFrame(kind, readUInt(bytes, 4), readUInt(bytes, 8), readUInt(bytes, 12), bytes.copyOfRange(VOICE_FRAME_HEADER_BYTES, bytes.size))
}

fun voiceControl(type: String, sessionId: String, sequence: UInt, fields: JsonObject = JsonObject(emptyMap())): JsonObject = buildJsonObject {
    put("type", type)
    put("version", VOICE_PROTOCOL_VERSION)
    put("sessionId", sessionId)
    put("sequence", sequence.toLong())
    fields.forEach { (key, value) -> put(key, value) }
}

private fun putUShort(target: ByteArray, offset: Int, value: Int) {
    target[offset] = (value ushr 8).toByte()
    target[offset + 1] = value.toByte()
}

private fun putUInt(target: ByteArray, offset: Int, value: UInt) {
    target[offset] = (value shr 24).toByte()
    target[offset + 1] = (value shr 16).toByte()
    target[offset + 2] = (value shr 8).toByte()
    target[offset + 3] = value.toByte()
}

private fun readUShort(bytes: ByteArray, offset: Int): Int =
    ((bytes[offset].toInt() and 0xff) shl 8) or (bytes[offset + 1].toInt() and 0xff)

private fun readUInt(bytes: ByteArray, offset: Int): UInt =
    (((bytes[offset].toUInt() and 0xffu) shl 24) or
        ((bytes[offset + 1].toUInt() and 0xffu) shl 16) or
        ((bytes[offset + 2].toUInt() and 0xffu) shl 8) or
        (bytes[offset + 3].toUInt() and 0xffu))

@Serializable
data class VoiceSessionSnapshot(
    val sessionId: String,
    val state: VoiceState = VoiceState.Disconnected,
    val generation: UInt = 0u,
    val partialTranscript: String = "",
    val echoCancellation: Boolean = false,
    val input: VoiceAudioConfig? = null,
    val output: VoiceAudioConfig? = null,
)

@Serializable
enum class VoiceState { Disconnected, Connecting, Listening, Processing, Speaking, Interrupted, Reconnecting, Error, Ended }

sealed interface VoiceCommand {
    data class Hello(val sessionId: String, val echoCancellation: Boolean) : VoiceCommand
    data object Ready : VoiceCommand
    data class TranscriptPartial(val text: String) : VoiceCommand
    data class TranscriptFinal(val text: String) : VoiceCommand
    data class AudioStopped(val generation: UInt) : VoiceCommand
    data class BargeIn(val generation: UInt) : VoiceCommand
    data object Ended : VoiceCommand
    data class Failure(val message: String) : VoiceCommand
}

fun reduceVoice(snapshot: VoiceSessionSnapshot, command: VoiceCommand): VoiceSessionSnapshot = when (command) {
    is VoiceCommand.Hello -> snapshot.copy(sessionId = command.sessionId, state = VoiceState.Connecting, echoCancellation = command.echoCancellation)
    VoiceCommand.Ready -> snapshot.copy(state = VoiceState.Listening)
    is VoiceCommand.TranscriptPartial -> snapshot.copy(state = VoiceState.Listening, partialTranscript = command.text.take(8_000))
    is VoiceCommand.TranscriptFinal -> snapshot.copy(state = VoiceState.Processing, partialTranscript = command.text.take(20_000))
    is VoiceCommand.AudioStopped -> snapshot.copy(state = VoiceState.Interrupted, generation = maxOf(snapshot.generation, command.generation))
    is VoiceCommand.BargeIn -> snapshot.copy(state = VoiceState.Interrupted, generation = maxOf(snapshot.generation, command.generation), partialTranscript = "")
    VoiceCommand.Ended -> snapshot.copy(state = VoiceState.Ended)
    is VoiceCommand.Failure -> snapshot.copy(state = VoiceState.Error, partialTranscript = command.message.take(500))
}

interface LiveVoicePlatform {
    suspend fun openCapture(config: VoiceAudioConfig): VoiceCaptureStream
    suspend fun openPlayback(config: VoiceAudioConfig): VoicePlaybackSink
    suspend fun requestMicrophone(): Boolean
    suspend fun closeAudio()
}

interface VoiceCaptureStream { suspend fun nextFrame(): ByteArray?; suspend fun close() }
interface VoicePlaybackSink { suspend fun play(frame: ByteArray); suspend fun stop(); suspend fun close() }
