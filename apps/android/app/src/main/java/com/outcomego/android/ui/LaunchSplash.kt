package com.outcomego.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.animation.core.Animatable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

private const val MIN_VISIBLE_MS = 700L
private const val MAX_VISIBLE_MS = 2_500L

/** Planet glyph size; matches `res/drawable/splash_icon.xml` (108 units * 1.2 scale) so the handoff is seamless. */
private val GlyphSize = 130.dp
private val WordmarkGap = 20.dp

/**
 * App-level launch screen drawn above the app while the stored session is restored. The system splash
 * shows the same glyph at the same position, so only the wordmark appears to fade in.
 */
@Composable
fun LaunchSplash(restoring: Boolean, content: @Composable () -> Unit) {
    var minElapsed by remember { mutableStateOf(false) }
    var expired by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(MIN_VISIBLE_MS)
        minElapsed = true
        delay(MAX_VISIBLE_MS - MIN_VISIBLE_MS)
        expired = true
    }
    val visible = !minElapsed || (restoring && !expired)
    Box(Modifier.fillMaxSize()) {
        content()
        AnimatedVisibility(
            visible = visible,
            exit = fadeOut(tween(280, easing = FastOutSlowInEasing)),
        ) {
            val reveal = remember { Animatable(0f) }
            LaunchedEffect(Unit) { reveal.animateTo(1f, tween(450, delayMillis = 120, easing = FastOutSlowInEasing)) }
            Box(
                Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
                contentAlignment = Alignment.Center,
            ) {
                PlanetMark(
                    size = GlyphSize,
                    ink = MaterialTheme.colorScheme.onBackground,
                    canvas = MaterialTheme.colorScheme.background,
                )
                // Anchored below the glyph so the glyph itself stays exactly centred.
                Text(
                    text = "OutcomeGo",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 1.2.sp,
                    modifier = Modifier
                        .graphicsLayer { translationY = (GlyphSize / 2 + WordmarkGap + 14.dp).toPx() + (1f - reveal.value) * 6.dp.toPx() }
                        .alpha(reveal.value),
                )
            }
        }
    }
}

/** Monochrome planet: ring behind and in front of a disc, two pill eyes cut out in the canvas colour. */
@Composable
fun PlanetMark(size: Dp, ink: Color, canvas: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.size(size)) {
        val u = this.size.minDimension / 108f
        fun o(x: Float, y: Float) = Offset(x * u, y * u)
        val ringTopLeft = o(16f, 48f)
        val ringSize = Size(76f * u, 20f * u)
        val pivot = o(54f, 58f)
        rotate(-14f, pivot) {
            drawArc(ink, 180f, 180f, false, ringTopLeft, ringSize, style = Stroke(3.2f * u, cap = StrokeCap.Round))
        }
        drawCircle(ink, 24f * u, o(54f, 52f))
        rotate(-14f, pivot) {
            drawArc(canvas, 0f, 180f, false, ringTopLeft, ringSize, style = Stroke(7.6f * u, cap = StrokeCap.Butt))
            drawArc(ink, 0f, 180f, false, ringTopLeft, ringSize, style = Stroke(3.2f * u, cap = StrokeCap.Round))
        }
        for (x in floatArrayOf(46f, 58f)) {
            drawRoundRect(canvas, o(x, 45f), Size(5f * u, 12f * u), CornerRadius(2.5f * u))
        }
    }
}
