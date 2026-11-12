package com.outcomego.features

import android.os.Build
import android.view.HapticFeedbackConstants
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppHapticsTest {
    @Test fun feedbackRequiresBothPreferenceAndForeground() {
        assertFalse(HapticPolicy.allows(enabled = false, active = true))
        assertFalse(HapticPolicy.allows(enabled = true, active = false))
        assertFalse(HapticPolicy.allows(enabled = false, active = false))
        assertTrue(HapticPolicy.allows(enabled = true, active = true))
    }

    @Test fun everyEffectMapsOnEveryLegacyAndCurrentSdk() {
        for (sdk in listOf(Build.VERSION_CODES.O, Build.VERSION_CODES.R, Build.VERSION_CODES.UPSIDE_DOWN_CAKE)) {
            HapticEffect.entries.forEach { it.constant(sdk) }
        }
    }

    @Test fun outcomesUseTheSystemConfirmAndRejectCuesWhereAvailable() {
        assertEquals(HapticFeedbackConstants.CONFIRM, HapticEffect.Success.constant(Build.VERSION_CODES.R))
        assertEquals(HapticFeedbackConstants.REJECT, HapticEffect.Error.constant(Build.VERSION_CODES.R))
        assertEquals(HapticFeedbackConstants.VIRTUAL_KEY, HapticEffect.Success.constant(Build.VERSION_CODES.O))
        assertEquals(HapticFeedbackConstants.LONG_PRESS, HapticEffect.Error.constant(Build.VERSION_CODES.O))
    }

    @Test fun selectionUsesTheSegmentTickOnlyWhereItExists() {
        assertEquals(HapticFeedbackConstants.SEGMENT_TICK, HapticEffect.Selection.constant(Build.VERSION_CODES.UPSIDE_DOWN_CAKE))
        assertEquals(HapticFeedbackConstants.CLOCK_TICK, HapticEffect.Selection.constant(Build.VERSION_CODES.TIRAMISU))
    }
}
