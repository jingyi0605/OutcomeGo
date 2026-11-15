package com.outcomego.android.ui

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Surface
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import com.outcomego.android.ui.designsystem.LocalSpatialColors
import com.outcomego.android.ui.designsystem.buildSpatialColors
import com.outcomego.features.AppSettings

private val OutcomeGoTypography = Typography().let { base ->
    base.copy(
        displayLarge = base.displayLarge.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.5).sp),
        headlineLarge = base.headlineLarge.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.4).sp),
        headlineMedium = base.headlineMedium.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.3).sp),
        titleLarge = base.titleLarge.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp),
        titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        bodyLarge = base.bodyLarge.copy(lineHeight = 24.sp),
        bodyMedium = base.bodyMedium.copy(lineHeight = 20.sp),
    )
}

private val OutcomeGoShapes = Shapes(
    extraSmall = RoundedCornerShape(10.dp),
    small = RoundedCornerShape(14.dp),
    medium = RoundedCornerShape(20.dp),
    large = RoundedCornerShape(26.dp),
    extraLarge = RoundedCornerShape(32.dp),
)

@Composable
fun OutcomeGoTheme(
    appearance: AppSettings.Appearance = AppSettings.Appearance.System,
    accent: AppSettings.Accent = AppSettings.Accent.Black,
    content: @Composable () -> Unit,
) {
    val systemDark = isSystemInDarkTheme()
    val darkTheme = when (appearance) {
        AppSettings.Appearance.System -> systemDark
        AppSettings.Appearance.Light -> false
        AppSettings.Appearance.Dark -> true
    }
    val view = LocalView.current
    SideEffect {
        val window = (view.context as? Activity)?.window ?: return@SideEffect
        val controller = WindowCompat.getInsetsController(window, view)
        controller.isAppearanceLightStatusBars = !darkTheme
        controller.isAppearanceLightNavigationBars = !darkTheme
    }

    val spatialColors = remember(darkTheme, accent) {
        buildSpatialColors(darkTheme = darkTheme, accent = accent)
    }

    // ColorScheme has no structural equality and LocalColorScheme is static, so a fresh
    // instance on every recomposition invalidates the whole UI tree. Cache it per theme input.
    val colorScheme = remember(spatialColors) {
        if (spatialColors.isDark) {
            darkColorScheme(
                primary = spatialColors.accent,
                onPrimary = spatialColors.onAccent,
                primaryContainer = spatialColors.userBubbleStart,
                onPrimaryContainer = spatialColors.onUserBubble,
                secondary = spatialColors.accent,
                secondaryContainer = spatialColors.glassFloating,
                onSecondaryContainer = spatialColors.textPrimary,
                background = spatialColors.canvasBase,
                surface = spatialColors.glassCard,
                surfaceVariant = spatialColors.glassSubtle,
                onBackground = spatialColors.textPrimary,
                onSurface = spatialColors.textPrimary,
                onSurfaceVariant = spatialColors.textSecondary,
                outline = spatialColors.hairline,
                tertiary = spatialColors.success,
                onTertiary = spatialColors.canvasBase,
                error = spatialColors.danger,
            )
        } else {
            lightColorScheme(
                primary = spatialColors.accent,
                onPrimary = spatialColors.onAccent,
                primaryContainer = spatialColors.userBubbleStart,
                onPrimaryContainer = spatialColors.onUserBubble,
                secondary = spatialColors.accent,
                secondaryContainer = spatialColors.glassFloating,
                onSecondaryContainer = spatialColors.textPrimary,
                background = spatialColors.canvasBase,
                surface = spatialColors.glassCard,
                surfaceVariant = spatialColors.glassSubtle,
                onBackground = spatialColors.textPrimary,
                onSurface = spatialColors.textPrimary,
                onSurfaceVariant = spatialColors.textSecondary,
                outline = spatialColors.hairline,
                tertiary = spatialColors.success,
                onTertiary = spatialColors.canvasElevated,
                error = spatialColors.danger,
            )
        }
    }

    CompositionLocalProvider(LocalSpatialColors provides spatialColors) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = OutcomeGoTypography,
            shapes = OutcomeGoShapes,
        ) {
            Surface(
                modifier = Modifier,
                color = spatialColors.canvasBase,
                contentColor = spatialColors.textPrimary,
                content = content,
            )
        }
    }
}
