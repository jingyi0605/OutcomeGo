package com.aiteamos.android

import org.junit.Test
import org.junit.Assert.assertEquals
import com.aiteamos.mobile.core.VoiceSessionSnapshot
import com.aiteamos.mobile.core.VoiceState
import com.aiteamos.mobile.core.VoiceCommand
import com.aiteamos.mobile.core.reduceVoice

class LiveVoiceAudioTest {
    @Test
    fun generationChangesOnBargeIn() {
        val next = reduceVoice(VoiceSessionSnapshot("s", VoiceState.Speaking, 2u), VoiceCommand.BargeIn(3u))
        assertEquals(3u, next.generation)
    }
}
