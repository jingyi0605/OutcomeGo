package com.aiteamos.mobile.core

import kotlinx.serialization.Serializable

@Serializable
data class VoiceAudioConfig(
    val codec: String = "opus",
    val sampleRate: Int,
    val channels: Int = 1,
    val frameMs: Int = 20,
    val maxFrameBytes: Int = 1500,
)

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
