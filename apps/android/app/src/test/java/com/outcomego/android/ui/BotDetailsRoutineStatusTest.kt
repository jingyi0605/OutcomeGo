package com.outcomego.android.ui

import com.outcomego.features.FeatureLoadState
import com.outcomego.features.Routine
import com.outcomego.features.RoutineSchedule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BotDetailsRoutineStatusTest {
    private fun routine(id: String, enabled: Boolean) = Routine(
        id = id,
        name = "Routine $id",
        prompt = "Run $id",
        schedule = RoutineSchedule(),
        enabled = enabled,
    )

    @Test
    fun readyStateDisplaysTotalAndEnabledCountsInEnglishAndChinese() {
        val state = FeatureLoadState.Ready(
            listOf(
                routine("r1", enabled = true),
                routine("r2", enabled = false),
                routine("r3", enabled = true),
            ),
        )
        assertEquals("3 total, 2 enabled", formatRoutineStatus(state, isChinese = false))
        assertEquals("共 3 个，已开启 2 个", formatRoutineStatus(state, isChinese = true))
    }

    @Test
    fun readyStateWithAllDisabledAndEmptyStateShowZeroEnabled() {
        val allDisabled = FeatureLoadState.Ready(
            listOf(
                routine("r1", enabled = false),
                routine("r2", enabled = false),
            ),
        )
        assertEquals("2 total, 0 enabled", formatRoutineStatus(allDisabled, isChinese = false))
        assertEquals("共 2 个，已开启 0 个", formatRoutineStatus(allDisabled, isChinese = true))

        val empty = FeatureLoadState.Empty<List<Routine>>("No routines yet")
        assertEquals("0 total, 0 enabled", formatRoutineStatus(empty, isChinese = false))
        assertEquals("共 0 个，已开启 0 个", formatRoutineStatus(empty, isChinese = true))
    }

    @Test
    fun loadingFailureAndNullStatesFormatAppropriately() {
        assertEquals("Loading…", formatRoutineStatus(FeatureLoadState.Loading, isChinese = false))
        assertEquals("加载中…", formatRoutineStatus(FeatureLoadState.Loading, isChinese = true))

        val failure = FeatureLoadState.Failure<List<Routine>>("Network error")
        assertNull(formatRoutineStatus(failure, isChinese = false))
        assertNull(formatRoutineStatus(failure, isChinese = true))
        assertNull(formatRoutineStatus(null, isChinese = false))
        assertNull(formatRoutineStatus(null, isChinese = true))
    }
}
