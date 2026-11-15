package com.outcomego.android.ui.designsystem

import android.os.Build
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.outcomego.features.HapticEffect

enum class GlassTier {
    Subtle,
    Card,
    Floating,
    Overlay,
}

@Stable
class SpatialGlassBackdropState internal constructor(
    internal val layer: GraphicsLayer,
) {
    internal var sourceOriginInRoot by mutableStateOf(Offset.Zero)
}

@Composable
fun rememberSpatialGlassBackdrop(): SpatialGlassBackdropState {
    val layer = rememberGraphicsLayer()
    return remember(layer) { SpatialGlassBackdropState(layer) }
}

val LocalSpatialGlassBackdrop = staticCompositionLocalOf<SpatialGlassBackdropState?> { null }

@Composable
fun SpatialGlassBackdropProvider(
    backdrop: SpatialGlassBackdropState?,
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(LocalSpatialGlassBackdrop provides backdrop, content = content)
}

/**
 * Records a background/scroll layer into [backdrop] so sibling [SpatialGlassSurface] elements
 * stacked above it can render modern matte frosted blur on Android 12+ (API 31+).
 * Must only wrap content behind floating chrome, never an ancestor of those bars.
 */
fun Modifier.spatialGlassBackdropSource(backdrop: SpatialGlassBackdropState?): Modifier =
    if (backdrop == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        this
    } else {
        this
            .onGloballyPositioned { coords ->
                backdrop.sourceOriginInRoot = coords.positionInRoot()
            }
            .drawWithContent {
                backdrop.layer.record {
                    this@drawWithContent.drawContent()
                }
                drawLayer(backdrop.layer)
            }
    }

/**
 * Ultra-minimalist spatial canvas: clean obsidian/alabaster surface with whisper-subtle
 * cached ambient mist so typography and frosted floating controls take center stage.
 */
@Composable
fun SpatialAmbientCanvas(
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val colors = SpatialTheme.colors
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(colors.canvasBase)
            .drawWithCache {
                val primaryCenter = Offset(size.width * 0.20f, size.height * 0.08f)
                val primaryRadius = size.maxDimension * 0.62f
                val primaryBrush = Brush.radialGradient(
                    colors = listOf(colors.ambientGlowPrimary, Color.Transparent),
                    center = primaryCenter,
                    radius = primaryRadius,
                )
                val secondaryCenter = Offset(size.width * 0.85f, size.height * 0.85f)
                val secondaryRadius = size.maxDimension * 0.55f
                val secondaryBrush = Brush.radialGradient(
                    colors = listOf(colors.ambientGlowSecondary, Color.Transparent),
                    center = secondaryCenter,
                    radius = secondaryRadius,
                )
                onDrawBehind {
                    drawRect(brush = primaryBrush)
                    drawRect(brush = secondaryBrush)
                }
            },
        content = content,
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SpatialGlassSurface(
    modifier: Modifier = Modifier,
    tier: GlassTier = GlassTier.Card,
    shape: Shape = RoundedCornerShape(SpatialRadii.lg),
    borderWidth: Dp = 0.65.dp,
    shadowElevation: Dp = when (tier) {
        GlassTier.Subtle -> 0.dp
        GlassTier.Card -> 0.dp
        GlassTier.Floating -> 8.dp
        GlassTier.Overlay -> 16.dp
    },
    containerColor: Color? = null,
    contentColor: Color = SpatialTheme.colors.textPrimary,
    enabled: Boolean = true,
    hapticEffect: HapticEffect? = HapticEffect.Selection,
    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
    content: @Composable BoxScope.() -> Unit,
) {
    val colors = SpatialTheme.colors
    val backdrop = LocalSpatialGlassBackdrop.current
    val useLiveBlur = backdrop != null &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        (tier == GlassTier.Floating || tier == GlassTier.Overlay) &&
        containerColor == null
    val blurRadius = when (tier) {
        GlassTier.Floating -> 26.dp
        GlassTier.Overlay -> 32.dp
        else -> 18.dp
    }

    val fillColor = containerColor ?: when {
        useLiveBlur && tier == GlassTier.Floating -> colors.glassBlurTint
        useLiveBlur && tier == GlassTier.Overlay -> colors.glassBlurTint.copy(
            alpha = if (colors.isDark) 0.78f else 0.84f,
        )
        tier == GlassTier.Subtle -> colors.glassSubtle
        tier == GlassTier.Card -> colors.glassCard
        tier == GlassTier.Floating -> colors.glassFloating
        else -> colors.glassOverlay
    }
    val borderBrush = remember(
        colors.glassBorderStart,
        colors.glassBorderMid,
        colors.glassBorderEnd,
        colors.glassBorderBounce,
    ) {
        Brush.linearGradient(
            0.0f to colors.glassBorderStart,
            0.40f to colors.glassBorderMid,
            0.75f to colors.glassBorderEnd,
            1.0f to colors.glassBorderBounce,
        )
    }
    val interactionSource = remember { MutableInteractionSource() }
    val interactive = onClick != null || onLongClick != null

    val outerModifier = modifier
        .then(
            if (interactive) {
                Modifier.spatialPressScale(
                    interactionSource = interactionSource,
                    enabled = enabled,
                    hapticEffect = hapticEffect,
                )
            } else {
                Modifier
            },
        )
        .then(
            if (shadowElevation > 0.dp) {
                Modifier.shadow(
                    elevation = shadowElevation,
                    shape = shape,
                    ambientColor = if (colors.isDark) Color.Black.copy(alpha = 0.45f) else Color(0xFF0F172A).copy(alpha = 0.10f),
                    spotColor = if (colors.isDark) Color.Black.copy(alpha = 0.35f) else Color(0xFF0F172A).copy(alpha = 0.08f),
                )
            } else {
                Modifier
            },
        )
        .clip(shape)
        .then(
            when {
                onLongClick != null -> Modifier.combinedClickable(
                    interactionSource = interactionSource,
                    indication = null,
                    enabled = enabled,
                    onClick = { onClick?.invoke() },
                    onLongClick = onLongClick,
                )
                onClick != null -> Modifier.clickable(
                    interactionSource = interactionSource,
                    indication = null,
                    enabled = enabled,
                    role = Role.Button,
                    onClick = onClick,
                )
                else -> Modifier
            },
        )

    var selfOriginInRoot by remember { mutableStateOf(Offset.Zero) }
    val activeBackdrop = if (useLiveBlur) backdrop else null
    if (activeBackdrop != null) {
        Box(
            modifier = outerModifier
                .onGloballyPositioned { coords ->
                    selfOriginInRoot = coords.positionInRoot()
                },
            propagateMinConstraints = true,
        ) {
            Box(
                modifier = Modifier
                    .matchParentSize()
                    .graphicsLayer {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            val r = blurRadius.toPx()
                            renderEffect = BlurEffect(r, r, TileMode.Clamp)
                        }
                    }
                    .drawBehind {
                        val dx = activeBackdrop.sourceOriginInRoot.x - selfOriginInRoot.x
                        val dy = activeBackdrop.sourceOriginInRoot.y - selfOriginInRoot.y
                        translate(left = dx, top = dy) {
                            drawLayer(activeBackdrop.layer)
                        }
                    },
            )
            SpatialGlassForegroundBox(
                fillColor = fillColor,
                borderWidth = borderWidth,
                borderBrush = borderBrush,
                shape = shape,
                contentColor = contentColor,
                content = content,
            )
        }
    } else {
        Box(
            modifier = outerModifier,
            propagateMinConstraints = true,
        ) {
            SpatialGlassForegroundBox(
                fillColor = fillColor,
                borderWidth = borderWidth,
                borderBrush = borderBrush,
                shape = shape,
                contentColor = contentColor,
                content = content,
            )
        }
    }
}

@Composable
private fun SpatialGlassForegroundBox(
    fillColor: Color,
    borderWidth: Dp,
    borderBrush: Brush,
    shape: Shape,
    contentColor: Color,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(
        modifier = Modifier
            .background(fillColor)
            .border(BorderStroke(borderWidth, borderBrush), shape),
        propagateMinConstraints = true,
    ) {
        CompositionLocalProvider(LocalContentColor provides contentColor) {
            content()
        }
    }
}

/**
 * Applies hardware blur on Android 12+ (API 31+) for static or modal backdrop layers,
 * gracefully degrading to translucent layering on API 26-30.
 */
fun Modifier.spatialBackdropBlur(radius: Dp = 18.dp): Modifier =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        this.blur(radius)
    } else {
        this
    }

@Composable
fun SpatialEdgeFade(
    top: Boolean,
    modifier: Modifier = Modifier,
    height: Dp = 28.dp,
) {
    val base = SpatialTheme.colors.canvasBase
    val brush = remember(base, top) {
        if (top) {
            Brush.verticalGradient(listOf(base.copy(alpha = 0.72f), Color.Transparent))
        } else {
            Brush.verticalGradient(listOf(Color.Transparent, base.copy(alpha = 0.72f)))
        }
    }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
            .background(brush),
    )
}
