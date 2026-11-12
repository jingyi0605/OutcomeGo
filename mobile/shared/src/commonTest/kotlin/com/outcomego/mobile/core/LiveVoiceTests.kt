package com.outcomego.mobile.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertContentEquals
import kotlin.test.assertFailsWith
import kotlinx.serialization.json.jsonPrimitive

class LiveVoiceTests {
    @Test
    fun voiceFramesRoundTripWithBigEndianHeader() {
        val frame = VoiceFrame(VoiceFrame.Kind.Output, 7u, 11u, 1234u, byteArrayOf(1, 2, 3))
        val decoded = decodeVoiceFrame(encodeVoiceFrame(frame), VoiceFrame.Kind.Output)
        assertEquals(frame.kind, decoded.kind)
        assertEquals(frame.generation, decoded.generation)
        assertEquals(frame.sequence, decoded.sequence)
        assertEquals(frame.timestampMs, decoded.timestampMs)
        assertContentEquals(frame.payload, decoded.payload)
    }

    @Test
    fun voiceFramesRejectTrailingBytes() {
        val frame = VoiceFrame(VoiceFrame.Kind.Input, 0u, 0u, 0u, byteArrayOf(1))
        assertFailsWith<IllegalArgumentException> {
            decodeVoiceFrame(encodeVoiceFrame(frame) + byteArrayOf(0))
        }
    }

    @Test
    fun bargeInStopsTheCurrentGenerationWithoutCancellingTheSession() {
        val initial = VoiceSessionSnapshot("session", VoiceState.Speaking, 3u)
        val next = reduceVoice(initial, VoiceCommand.BargeIn(4u))
        assertEquals(VoiceState.Interrupted, next.state)
        assertEquals(4u, next.generation)
    }

    @Test
    fun finalTranscriptMovesToProcessing() {
        val next = reduceVoice(VoiceSessionSnapshot("session"), VoiceCommand.TranscriptFinal("hello"))
        assertEquals(VoiceState.Processing, next.state)
        assertEquals("hello", next.partialTranscript)
    }

    @Test
    fun controlMessagesKeepProtocolVersionAndSequence() {
        val message = voiceControl("playback.ack", "session", 12u)
        assertEquals("playback.ack", message["type"]?.jsonPrimitive?.content)
        assertEquals("1", message["version"]?.jsonPrimitive?.content)
        assertEquals("session", message["sessionId"]?.jsonPrimitive?.content)
        assertEquals("12", message["sequence"]?.jsonPrimitive?.content)
    }

    @Test
    fun stoppedOutputGenerationIsIgnoredByTheReducerGenerationBoundary() {
        val next = reduceVoice(
            VoiceSessionSnapshot("session", VoiceState.Speaking, 8u),
            VoiceCommand.AudioStopped(6u),
        )
        assertEquals(8u, next.generation)
        assertEquals(VoiceState.Interrupted, next.state)
    }
}
