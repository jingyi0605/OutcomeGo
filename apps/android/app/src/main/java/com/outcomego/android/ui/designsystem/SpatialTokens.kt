package com.outcomego.android.ui.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.unit.dp
import com.outcomego.features.AppSettings

@Immutable
data class SpatialColors(
    val isDark: Boolean,
    val accent: Color,
    val onAccent: Color,
    val canvasBase: Color,
    val canvasElevated: Color,
    val ambientGlowPrimary: Color,
    val ambientGlowSecondary: Color,
    val ambientGlowTertiary: Color,
    val glassSubtle: Color,
    val glassCard: Color,
    val glassFloating: Color,
    val glassOverlay: Color,
    val glassBlurTint: Color,
    val glassBorderStart: Color,
    val glassBorderMid: Color,
    val glassBorderEnd: Color,
    val glassBorderBounce: Color,
    val hairline: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textTertiary: Color,
    val userBubbleStart: Color,
    val userBubbleEnd: Color,
    val onUserBubble: Color,
    val assistantSurface: Color,
    val codeSurface: Color,
    val success: Color,
    val warning: Color,
    val danger: Color,
    val scrim: Color,
)

object SpatialSpacing {
    val xxs = 4.dp
    val xs = 8.dp
    val sm = 12.dp
    val md = 16.dp
    val lg = 20.dp
    val xl = 28.dp
    val xxl = 36.dp
}

object SpatialRadii {
    val xs = 10.dp
    val sm = 14.dp
    val md = 20.dp
    val lg = 24.dp
    val xl = 28.dp
    val pill = 999.dp
}

fun buildSpatialColors(
    darkTheme: Boolean,
    accent: AppSettings.Accent,
): SpatialColors {
    val accentColor = when (accent) {
        AppSettings.Accent.Black -> if (darkTheme) Color(0xFFF3F4F6) else Color(0xFF111318)
        AppSettings.Accent.Blue -> if (darkTheme) Color(0xFF60A5FA) else Color(0xFF1769E0)
        AppSettings.Accent.Purple -> if (darkTheme) Color(0xFFA78BFA) else Color(0xFF7B4FD1)
        AppSettings.Accent.Green -> if (darkTheme) Color(0xFF34D399) else Color(0xFF1A7F54)
    }
    val onAccentColor = when {
        accent == AppSettings.Accent.Black && darkTheme -> Color(0xFF0A0B0E)
        darkTheme && accent == AppSettings.Accent.Green -> Color(0xFF05291C)
        darkTheme && accent == AppSettings.Accent.Blue -> Color(0xFF061B38)
        else -> Color.White
    }
    val glowPrimaryHue = when (accent) {
        AppSettings.Accent.Black -> if (darkTheme) Color(0xFF64748B) else Color(0xFF94A3B8)
        else -> accentColor
    }
    val glowSecondaryHue = when (accent) {
        AppSettings.Accent.Purple -> Color(0xFF818CF8)
        AppSettings.Accent.Green -> Color(0xFF2DD4BF)
        AppSettings.Accent.Blue -> Color(0xFF6366F1)
        AppSettings.Accent.Black -> Color(0xFF475569)
    }

    return if (darkTheme) {
        val userBubbleTop = when (accent) {
            AppSettings.Accent.Black -> Color(0xFF2D2D33)
            else -> accentColor.copy(alpha = 0.94f)
        }
        val userBubbleBottom = when (accent) {
            AppSettings.Accent.Black -> Color(0xFF232328)
            else -> lerp(accentColor, Color(0xFF0A0B0F), 0.22f).copy(alpha = 0.92f)
        }
        val bubbleText = if (accent == AppSettings.Accent.Black) Color(0xFFF4F4F6) else onAccentColor
        val glowAlpha = if (accent == AppSettings.Accent.Black) 0.0f else 0.025f
        SpatialColors(
            isDark = true,
            accent = accentColor,
            onAccent = onAccentColor,
            // Grok-inspired neutral matte charcoal canvas (zero bluish cast).
            canvasBase = Color(0xFF121214),
            canvasElevated = Color(0xFF1C1C1F),
            ambientGlowPrimary = glowPrimaryHue.copy(alpha = glowAlpha),
            ambientGlowSecondary = glowSecondaryHue.copy(alpha = glowAlpha * 0.6f),
            ambientGlowTertiary = Color.Transparent,
            // Neutral graphite surfaces & smoked frosted chrome.
            glassSubtle = Color(0xFF1A1A1D),
            glassCard = Color(0xFF202024),
            glassFloating = Color(0xFF232327).copy(alpha = 0.88f),
            glassOverlay = Color(0xFF1E1E22).copy(alpha = 0.96f),
            glassBlurTint = Color(0xFF202024).copy(alpha = 0.66f),
            glassBorderStart = Color.White.copy(alpha = 0.14f),
            glassBorderMid = Color.White.copy(alpha = 0.08f),
            glassBorderEnd = Color.White.copy(alpha = 0.06f),
            glassBorderBounce = Color.White.copy(alpha = 0.10f),
            hairline = Color.White.copy(alpha = 0.08f),
            textPrimary = Color(0xFFF4F4F6),
            textSecondary = Color(0xFF989BA3),
            textTertiary = Color(0xFF6B6E76),
            userBubbleStart = userBubbleTop,
            userBubbleEnd = userBubbleBottom,
            onUserBubble = bubbleText,
            assistantSurface = Color(0xFF1A1A1F),
            codeSurface = Color(0xFF17171A),
            success = Color(0xFF6EE7B7),
            warning = Color(0xFFFCD34D),
            danger = Color(0xFFFCA5A5),
            scrim = Color(0xFF070709).copy(alpha = 0.62f),
        )
    } else {
        val userBubbleTop = when (accent) {
            AppSettings.Accent.Black -> Color(0xFFEEEFF4)
            else -> accentColor
        }
        val userBubbleBottom = when (accent) {
            AppSettings.Accent.Black -> Color(0xFFE4E7EE)
            else -> lerp(accentColor, Color(0xFF0A0E17), 0.14f)
        }
        val bubbleText = if (accent == AppSettings.Accent.Black) Color(0xFF111318) else Color.White
        SpatialColors(
            isDark = false,
            accent = accentColor,
            onAccent = onAccentColor,
            // Crisp pure alabaster canvas (Gemini / ChatGPT light aesthetic).
            canvasBase = Color(0xFFFCFCFD),
            canvasElevated = Color(0xFFFFFFFF),
            ambientGlowPrimary = glowPrimaryHue.copy(alpha = 0.045f),
            ambientGlowSecondary = glowSecondaryHue.copy(alpha = 0.03f),
            ambientGlowTertiary = glowPrimaryHue.copy(alpha = 0.02f),
            glassSubtle = Color(0xFFF3F4F7),
            glassCard = Color(0xFFFFFFFF),
            glassFloating = Color(0xFFFFFFFF).copy(alpha = 0.90f),
            glassOverlay = Color(0xFFFFFFFF).copy(alpha = 0.97f),
            glassBlurTint = Color(0xFFFAFAFC).copy(alpha = 0.72f),
            glassBorderStart = Color(0xFF0F172A).copy(alpha = 0.09f),
            glassBorderMid = Color(0xFF0F172A).copy(alpha = 0.06f),
            glassBorderEnd = Color(0xFF0F172A).copy(alpha = 0.05f),
            glassBorderBounce = Color(0xFF0F172A).copy(alpha = 0.08f),
            hairline = Color(0xFF0F172A).copy(alpha = 0.08f),
            textPrimary = Color(0xFF0D1117),
            textSecondary = Color(0xFF57606F),
            textTertiary = Color(0xFF8C95A6),
            userBubbleStart = userBubbleTop,
            userBubbleEnd = userBubbleBottom,
            onUserBubble = bubbleText,
            assistantSurface = Color(0xFFFFFFFF),
            codeSurface = Color(0xFFF3F5F8),
            success = Color(0xFF137C55),
            warning = Color(0xFFB45309),
            danger = Color(0xFFC83A3A),
            scrim = Color(0xFF0A0E17).copy(alpha = 0.32f),
        )
    }
}

val LocalSpatialColors = staticCompositionLocalOf {
    buildSpatialColors(darkTheme = false, accent = AppSettings.Accent.Black)
}

object SpatialTheme {
    val colors: SpatialColors
        @Composable
        @ReadOnlyComposable
        get() = LocalSpatialColors.current
}
