package com.outcomego.features

import android.content.Context
import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.staticCompositionLocalOf

/** Same vocabulary as the iOS `HapticEffect`, so call sites read the same on both platforms. */
enum class HapticEffect { Selection, Light, Medium, Rigid, Soft, Heavy, Success, Warning, Error }

/** The iOS gate: the user preference must be on and the app must be in the foreground. */
object HapticPolicy {
    fun allows(enabled: Boolean, active: Boolean): Boolean = enabled && active

    /** Same SharedPreferences file and key that the ViewModel writes when Settings changes. */
    const val PREFERENCES_NAME = "outcomego-settings"
    const val PREFERENCE_KEY = "haptics"

    /** The preference defaults to on until the user switches it off, like the iOS `haptics` default. */
    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE).getBoolean(PREFERENCE_KEY, true)
}

fun interface HapticPlayer {
    fun play(effect: HapticEffect)
}

/** Previews and tests get silence, never a crash. */
val LocalAppHaptics = staticCompositionLocalOf { HapticPlayer { } }

/**
 * The only owner of app-generated feedback. `performHapticFeedback` already honours the
 * system touch-feedback setting and unsupported hardware, and no failure can block an action.
 */
class AndroidHaptics(
    private val view: View,
    private val enabled: () -> Boolean,
    private val active: () -> Boolean,
) : HapticPlayer {
    override fun play(effect: HapticEffect) {
        // Checked per call, so an async result that lands in the background stays silent.
        if (!HapticPolicy.allows(enabled(), active())) return
        runCatching { view.performHapticFeedback(effect.constant(Build.VERSION.SDK_INT)) }
    }
}

internal fun HapticEffect.constant(sdk: Int): Int = when (this) {
    HapticEffect.Selection ->
        if (sdk >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) HapticFeedbackConstants.SEGMENT_TICK
        else HapticFeedbackConstants.CLOCK_TICK
    HapticEffect.Soft -> HapticFeedbackConstants.CLOCK_TICK
    HapticEffect.Light -> HapticFeedbackConstants.VIRTUAL_KEY
    HapticEffect.Rigid -> HapticFeedbackConstants.KEYBOARD_TAP
    HapticEffect.Medium -> HapticFeedbackConstants.CONTEXT_CLICK
    HapticEffect.Heavy, HapticEffect.Warning -> HapticFeedbackConstants.LONG_PRESS
    HapticEffect.Success ->
        if (sdk >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
    HapticEffect.Error ->
        if (sdk >= Build.VERSION_CODES.R) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
}
