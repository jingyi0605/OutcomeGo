package com.aiteamos.platform

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler

data class LiveVoiceAudioCapabilities(val echoCancellation: Boolean, val sampleRate: Int = 48_000, val channels: Int = 1, val frameMs: Int = 20)

class LiveVoiceAudio {
    private var record: AudioRecord? = null
    private var track: AudioTrack? = null
    private var echo: AcousticEchoCanceler? = null
    private var inputCodec: AndroidOpus? = null
    private var outputCodec: AndroidOpus? = null

    fun capabilities(): LiveVoiceAudioCapabilities = LiveVoiceAudioCapabilities(AcousticEchoCanceler.isAvailable())

    fun start(): LiveVoiceAudioCapabilities {
        val min = AudioRecord.getMinBufferSize(48_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT).coerceAtLeast(1_920)
        val recorder = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 48_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, min * 2)
        if (AcousticEchoCanceler.isAvailable()) echo = AcousticEchoCanceler.create(recorder.audioSessionId)?.also { it.enabled = true }
        val outputMin = AudioTrack.getMinBufferSize(24_000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT).coerceAtLeast(960)
        val audioTrack = AudioTrack.Builder().setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).setAudioFormat(AudioFormat.Builder().setSampleRate(24_000).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()).setBufferSizeInBytes(outputMin * 2).setTransferMode(AudioTrack.MODE_STREAM).build()
        inputCodec = AndroidOpus(48_000)
        outputCodec = AndroidOpus(24_000)
        record = recorder; track = audioTrack
        recorder.startRecording(); audioTrack.play()
        return capabilities()
    }

    fun read(buffer: ShortArray): Int = record?.read(buffer, 0, buffer.size) ?: 0
    fun play(buffer: ShortArray) { track?.write(buffer, 0, buffer.size) }
    fun encodeInputFrame(pcm: ShortArray): ByteArray = inputCodec?.encode(pcm) ?: error("Live voice audio is not started")
    fun playOutputPacket(packet: ByteArray) { play(outputCodec?.decode(packet) ?: error("Live voice audio is not started")) }
    fun close() {
        runCatching { record?.stop() }; runCatching { track?.stop() }
        record?.release(); track?.release(); echo?.release()
        inputCodec?.close(); outputCodec?.close()
        record = null; track = null; echo = null
        inputCodec = null; outputCodec = null
    }
}

/** Raw 20 ms Opus codec backed by the vendored libopus JNI bridge. */
class AndroidOpus(private val sampleRate: Int) : AutoCloseable {
    private var handle: Long = nativeCreate(sampleRate)

    init { check(handle != 0L) { "Unable to create libopus codec at $sampleRate Hz" } }

    fun encode(pcm: ShortArray): ByteArray {
        check(handle != 0L) { "Opus codec is closed" }
        return nativeEncode(handle, pcm) ?: error("Opus encode failed")
    }

    fun decode(packet: ByteArray): ShortArray {
        check(handle != 0L) { "Opus codec is closed" }
        return nativeDecode(handle, packet) ?: error("Opus decode failed")
    }

    override fun close() {
        if (handle != 0L) {
            nativeClose(handle)
            handle = 0L
        }
    }

    private external fun nativeCreate(sampleRate: Int): Long
    private external fun nativeEncode(handle: Long, pcm: ShortArray): ByteArray?
    private external fun nativeDecode(handle: Long, packet: ByteArray): ShortArray?
    private external fun nativeClose(handle: Long)

    companion object {
        init { System.loadLibrary("aiteamos_opus") }
    }
}
