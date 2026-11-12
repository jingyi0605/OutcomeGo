package com.outcomego.android

import org.junit.Test
import org.junit.Assert.assertEquals
import com.outcomego.mobile.core.VoiceSessionSnapshot
import com.outcomego.mobile.core.VoiceState
import com.outcomego.mobile.core.VoiceCommand
import com.outcomego.mobile.core.reduceVoice

class LiveVoiceAudioTest {
    @Test
    fun generationChangesOnBargeIn() {
        val next = reduceVoice(VoiceSessionSnapshot("s", VoiceState.Speaking, 2u), VoiceCommand.BargeIn(3u))
        assertEquals(3u, next.generation)
    }
}
