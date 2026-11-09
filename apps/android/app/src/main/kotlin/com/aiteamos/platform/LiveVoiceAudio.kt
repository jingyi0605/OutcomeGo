package com.aiteamos.platform

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import java.util.ArrayDeque

data class LiveVoiceAudioCapabilities(val echoCancellation: Boolean, val sampleRate: Int = 48_000, val channels: Int = 1, val frameMs: Int = 20)

class LiveVoiceAudio(private val context: Context? = null) {
    private var record: AudioRecord? = null
    private var track: AudioTrack? = null
    private var echo: AcousticEchoCanceler? = null
    private var inputCodec: AndroidOpus? = null
    private var outputCodec: AndroidOpus? = null
    private val playbackHandler = Handler(Looper.getMainLooper())
    private val pendingAcks = ArrayDeque<PlaybackAck>()
    private var writtenFrames = 0L
    private var playbackEpoch = 0
    private var audioManager: AudioManager? = null
    private var previousAudioMode: Int? = null
    private var communicationDeviceSet = false
    private var scoStarted = false
    private var inputGain = 1f

    private companion object {
        const val INPUT_TARGET_RMS = 3_000.0
        const val INPUT_NOISE_FLOOR = 400.0
        const val INPUT_MAX_GAIN = 6f
        val HEADSET_TYPES = listOf(
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            AudioDeviceInfo.TYPE_BLE_HEADSET,
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioDeviceInfo.TYPE_USB_HEADSET,
        )
    }

    private data class PlaybackAck(
        val targetFrame: Long,
        val generation: UInt,
        val sequence: UInt,
        val callback: (UInt, UInt) -> Unit,
    )

    fun capabilities(): LiveVoiceAudioCapabilities = LiveVoiceAudioCapabilities(AcousticEchoCanceler.isAvailable())

    fun start(): LiveVoiceAudioCapabilities {
        audioManager = context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        previousAudioMode = audioManager?.mode
        audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
        routeToHeadset()
        val inputMin = AudioRecord.getMinBufferSize(48_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        require(inputMin > 0) { "This device does not support 48 kHz microphone capture." }
        val min = inputMin.coerceAtLeast(1_920)
        val recorder = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 48_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, min * 2)
        check(recorder.state == AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            "Microphone is unavailable. Grant microphone permission and close any other app using the microphone."
        }
        if (AcousticEchoCanceler.isAvailable()) echo = AcousticEchoCanceler.create(recorder.audioSessionId)?.also { it.enabled = true }
        val outputMinValue = AudioTrack.getMinBufferSize(24_000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        require(outputMinValue > 0) {
            recorder.release()
            "This device does not support 24 kHz voice playback."
        }
        val outputMin = outputMinValue.coerceAtLeast(960)
        val audioTrack = AudioTrack.Builder().setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).setAudioFormat(AudioFormat.Builder().setSampleRate(24_000).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()).setBufferSizeInBytes(outputMin * 2).setTransferMode(AudioTrack.MODE_STREAM).build()
        check(audioTrack.state == AudioTrack.STATE_INITIALIZED) {
            recorder.release()
            audioTrack.release()
            "Voice playback is unavailable on this device."
        }
        inputCodec = AndroidOpus(48_000)
        outputCodec = AndroidOpus(24_000)
        record = recorder; track = audioTrack
        synchronized(pendingAcks) {
            pendingAcks.clear()
            writtenFrames = 0
            playbackEpoch += 1
        }
        try {
            recorder.startRecording()
            check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                "Microphone could not start. Grant microphone permission and close any other app using the microphone."
            }
            audioTrack.play()
        } catch (error: Throwable) {
            runCatching { recorder.release() }
            runCatching { audioTrack.release() }
            inputCodec?.close()
            outputCodec?.close()
            inputCodec = null
            outputCodec = null
            throw IllegalStateException(error.message ?: "Microphone could not start.", error)
        }
        return capabilities()
    }

    /**
     * Sends call audio to a connected headset instead of the loudspeaker. Without an explicit
     * communication device, Android keeps VOICE_COMMUNICATION audio on the built-in speaker.
     */
    private fun routeToHeadset() {
        val manager = audioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val granted = context?.let {
                ContextCompat.checkSelfPermission(it, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
            } == true
            val devices = if (granted) manager.availableCommunicationDevices else emptyList()
            val preferred = HEADSET_TYPES.firstNotNullOfOrNull { type -> devices.firstOrNull { it.type == type } }
            if (preferred != null) communicationDeviceSet = manager.setCommunicationDevice(preferred)
        } else if (manager.isBluetoothScoAvailableOffCall) {
            @Suppress("DEPRECATION")
            manager.startBluetoothSco()
            @Suppress("DEPRECATION")
            manager.isBluetoothScoOn = true
            scoStarted = true
        }
    }

    private fun releaseHeadsetRoute() {
        val manager = audioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (communicationDeviceSet) manager.clearCommunicationDevice()
        } else if (scoStarted) {
            @Suppress("DEPRECATION")
            manager.isBluetoothScoOn = false
            @Suppress("DEPRECATION")
            manager.stopBluetoothSco()
        }
        communicationDeviceSet = false
        scoStarted = false
    }

    fun read(buffer: ShortArray): Int = record?.read(buffer, 0, buffer.size) ?: 0
    fun play(buffer: ShortArray) { track?.write(buffer, 0, buffer.size) }

    /**
     * Phone microphones in VOICE_COMMUNICATION mode often deliver quiet speech, below the server's
     * voice-activity threshold. This lifts quiet speech toward a target level and leaves frames at
     * or below the noise floor alone, so room noise is not amplified into a false turn.
     */
    private fun applyInputGain(pcm: ShortArray) {
        var sum = 0.0
        for (sample in pcm) sum += sample.toDouble() * sample
        val rms = kotlin.math.sqrt(sum / pcm.size.coerceAtLeast(1))
        val desired = if (rms > INPUT_NOISE_FLOOR) (INPUT_TARGET_RMS / rms).toFloat().coerceIn(1f, INPUT_MAX_GAIN) else 1f
        inputGain += (desired - inputGain) * 0.2f
        if (inputGain <= 1.01f) return
        for (index in pcm.indices) {
            pcm[index] = (pcm[index] * inputGain).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
    }

    fun encodeInputFrame(pcm: ShortArray): ByteArray {
        val codec = inputCodec ?: error("Live voice audio is not started")
        applyInputGain(pcm)
        return codec.encode(pcm)
    }
    fun playOutputPacket(packet: ByteArray, generation: UInt, sequence: UInt, onPlayed: (UInt, UInt) -> Unit) {
        val pcm = outputCodec?.decode(packet) ?: error("Live voice audio is not started")
        val audioTrack = track ?: return
        val written = audioTrack.write(pcm, 0, pcm.size)
        if (written <= 0) return
        val epoch = synchronized(pendingAcks) {
            writtenFrames += written
            pendingAcks.addLast(PlaybackAck(writtenFrames, generation, sequence, onPlayed))
            playbackEpoch
        }
        pollPlayback(epoch)
    }

    private fun pollPlayback(epoch: Int) {
        playbackHandler.post {
            val callbacks = mutableListOf<PlaybackAck>()
            synchronized(pendingAcks) {
                if (epoch != playbackEpoch) return@post
                val played = (track?.playbackHeadPosition?.toLong() ?: 0L) and 0xffffffffL
                while (pendingAcks.isNotEmpty() && pendingAcks.first().targetFrame <= played) {
                    callbacks += pendingAcks.removeFirst()
                }
            }
            callbacks.forEach { it.callback(it.generation, it.sequence) }
            synchronized(pendingAcks) {
                if (epoch == playbackEpoch && pendingAcks.isNotEmpty()) {
                    playbackHandler.postDelayed({ pollPlayback(epoch) }, 10)
                }
            }
        }
    }

    fun closePlayback() {
        runCatching { track?.pause() }
        runCatching { track?.flush() }
        synchronized(pendingAcks) {
            playbackEpoch += 1
            pendingAcks.clear()
            writtenFrames = 0
        }
        runCatching { track?.play() }
    }
    fun close() {
        playbackHandler.removeCallbacksAndMessages(null)
        synchronized(pendingAcks) {
            playbackEpoch += 1
            pendingAcks.clear()
        }
        runCatching { record?.stop() }; runCatching { track?.stop() }
        record?.release(); track?.release(); echo?.release()
        inputCodec?.close(); outputCodec?.close()
        record = null; track = null; echo = null
        inputCodec = null; outputCodec = null
        releaseHeadsetRoute()
        inputGain = 1f
        previousAudioMode?.let { audioManager?.mode = it }
        previousAudioMode = null
        audioManager = null
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
