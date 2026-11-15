package com.outcomego.android.ui.designsystem

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.IntOffset
import androidx.navigation.NavBackStackEntry
import com.outcomego.features.HapticEffect
import com.outcomego.features.LocalAppHaptics

object SpatialMotion {
    const val NAV_ENTER_MILLIS = 320
    const val NAV_EXIT_MILLIS = 320
    const val PRESS_SCALE = 0.965f

    private val SpatialEase = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)

    val SnappySpring = spring<Float>(
        dampingRatio = 0.82f,
        stiffness = 480f,
    )

    val SpatialSpring = spring<Float>(
        dampingRatio = 0.88f,
        stiffness = 360f,
    )

    val GentleSpring = spring<Float>(
        dampingRatio = 0.92f,
        stiffness = 240f,
    )

    val ContentSizeSpring = spring<androidx.compose.ui.unit.IntSize>(
        dampingRatio = 0.86f,
        stiffness = Spring.StiffnessMediumLow,
    )

    private val NavOffsetEnterSpec = tween<IntOffset>(NAV_ENTER_MILLIS, easing = SpatialEase)
    private val NavOffsetExitSpec = tween<IntOffset>(NAV_EXIT_MILLIS, easing = SpatialEase)
    private val NavFloatEnterSpec = tween<Float>(NAV_ENTER_MILLIS, easing = SpatialEase)
    private val NavFloatExitSpec = tween<Float>(NAV_EXIT_MILLIS, easing = SpatialEase)

    // Opaque edge-to-edge parallax slides ensure incoming and outgoing pages never alpha-blend
    // text over each other during navigation transitions.
    fun AnimatedContentTransitionScope<NavBackStackEntry>.spatialPushEnter(): EnterTransition =
        slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.Left, NavOffsetEnterSpec) { it }

    fun AnimatedContentTransitionScope<NavBackStackEntry>.spatialPushExit(): ExitTransition =
        slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.Left, NavOffsetExitSpec) { it / 4 } +
            scaleOut(targetScale = 0.96f, animationSpec = NavFloatExitSpec)

    fun AnimatedContentTransitionScope<NavBackStackEntry>.spatialPopEnter(): EnterTransition =
        slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.Right, NavOffsetEnterSpec) { it / 4 } +
            scaleIn(initialScale = 0.96f, animationSpec = NavFloatEnterSpec)

    fun AnimatedContentTransitionScope<NavBackStackEntry>.spatialPopExit(): ExitTransition =
        slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.Right, NavOffsetExitSpec) { it }

    // Settings slides in from the left edge to mirror the right-swipe open gesture on DirectoryScreen.
    fun AnimatedContentTransitionScope<NavBackStackEntry>.spatialDrawerEnter(): EnterTransition =
        slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.Right, NavOffsetEnterSpec) { it }

    fun AnimatedContentTransitionScope<NavBackStackEntry>.spatialDrawerExit(): ExitTransition =
        slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.Left, NavOffsetExitSpec) { it }

    fun AnimatedContentTransitionScope<NavBackStackEntry>.spatialDrawerBackdropExit(): ExitTransition =
        slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.Right, NavOffsetExitSpec) { it / 4 } +
            scaleOut(targetScale = 0.96f, animationSpec = NavFloatExitSpec)

    fun AnimatedContentTransitionScope<NavBackStackEntry>.spatialDrawerBackdropPopEnter(): EnterTransition =
        slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.Left, NavOffsetEnterSpec) { it / 4 } +
            scaleIn(initialScale = 0.96f, animationSpec = NavFloatEnterSpec)
}

fun Modifier.spatialPressScale(
    interactionSource: MutableInteractionSource,
    enabled: Boolean = true,
    targetScale: Float = SpatialMotion.PRESS_SCALE,
    hapticEffect: HapticEffect? = HapticEffect.Selection,
): Modifier = composed {
    val pressed by interactionSource.collectIsPressedAsState()
    val haptics = LocalAppHaptics.current
    var wasPressed by remember { mutableStateOf(false) }
    LaunchedEffect(pressed, enabled) {
        if (enabled && pressed && !wasPressed && hapticEffect != null) {
            haptics.play(hapticEffect)
        }
        wasPressed = pressed
    }
    val scale by animateFloatAsState(
        targetValue = if (enabled && pressed) targetScale else 1f,
        animationSpec = SpatialMotion.SnappySpring,
        label = "spatialPressScale",
    )
    graphicsLayer {
        scaleX = scale
        scaleY = scale
    }
}
