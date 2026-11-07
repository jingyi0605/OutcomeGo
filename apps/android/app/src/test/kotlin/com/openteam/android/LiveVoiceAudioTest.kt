package com.openteam.android

import org.junit.Test
import org.junit.Assert.assertEquals
import com.openteam.mobile.core.VoiceSessionSnapshot
import com.openteam.mobile.core.VoiceState
import com.openteam.mobile.core.VoiceCommand
import com.openteam.mobile.core.reduceVoice

class LiveVoiceAudioTest {
    @Test
    fun generationChangesOnBargeIn() {
        val next = reduceVoice(VoiceSessionSnapshot("s", VoiceState.Speaking, 2u), VoiceCommand.BargeIn(3u))
        assertEquals(3u, next.generation)
    }
}
