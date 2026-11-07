package com.openteam.mobile.core

import kotlin.test.Test
import kotlin.test.assertEquals

class LiveVoiceTests {
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
}
