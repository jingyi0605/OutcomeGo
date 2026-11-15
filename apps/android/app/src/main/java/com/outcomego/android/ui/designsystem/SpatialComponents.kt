package com.outcomego.android.ui.designsystem

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.outcomego.features.HapticEffect

@Composable
fun SpatialFloatingTopBar(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    titleModifier: Modifier = Modifier,
    navigationIcon: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val colors = SpatialTheme.colors
    Box(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.sm),
        ) {
            if (navigationIcon != null) {
                navigationIcon()
            }
            SpatialGlassSurface(
                tier = GlassTier.Floating,
                shape = RoundedCornerShape(SpatialRadii.pill),
                shadowElevation = 6.dp,
                modifier = Modifier.weight(1f),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 46.dp)
                        .padding(horizontal = SpatialSpacing.md, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = title,
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontWeight = FontWeight.SemiBold,
                                letterSpacing = (-0.2).sp,
                            ),
                            color = colors.textPrimary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = titleModifier,
                        )
                        if (!subtitle.isNullOrBlank()) {
                            Text(
                                text = subtitle,
                                style = MaterialTheme.typography.labelSmall,
                                color = colors.textSecondary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                content = actions,
            )
        }
    }
}

@Composable
fun SpatialIconOrb(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    size: Dp = 44.dp,
    iconSize: Dp = 20.dp,
    tint: Color = SpatialTheme.colors.textPrimary,
    containerColor: Color? = null,
    tier: GlassTier = GlassTier.Floating,
    hapticEffect: HapticEffect = HapticEffect.Selection,
    testTag: String? = null,
) {
    val taggedModifier = if (testTag != null) modifier.testTag(testTag) else modifier
    SpatialGlassSurface(
        modifier = taggedModifier
            .size(size)
            .semantics { this.contentDescription = contentDescription },
        tier = tier,
        shape = CircleShape,
        containerColor = containerColor,
        enabled = enabled,
        hapticEffect = hapticEffect,
        onClick = onClick,
    ) {
        Box(
            modifier = Modifier
                .size(size)
                .alpha(if (enabled) 1f else 0.38f),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = contentDescription,
                tint = tint,
                modifier = Modifier.size(iconSize),
            )
        }
    }
}

@Composable
fun SpatialGroupedSection(
    modifier: Modifier = Modifier,
    title: String? = null,
    footer: String? = null,
    tier: GlassTier = GlassTier.Subtle,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = SpatialTheme.colors
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
    ) {
        if (!title.isNullOrBlank()) {
            Text(
                text = title,
                style = MaterialTheme.typography.labelMedium.copy(
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 0.2.sp,
                ),
                color = colors.textSecondary,
                modifier = Modifier.padding(horizontal = SpatialSpacing.xs),
            )
        }
        SpatialGlassSurface(
            tier = tier,
            shape = RoundedCornerShape(SpatialRadii.lg),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                content = content,
            )
        }
        if (!footer.isNullOrBlank()) {
            Text(
                text = footer,
                style = MaterialTheme.typography.bodySmall,
                color = colors.textTertiary,
                modifier = Modifier.padding(horizontal = SpatialSpacing.xs),
            )
        }
    }
}

@Composable
fun SpatialHairlineDivider(
    modifier: Modifier = Modifier,
    insetStart: Dp = SpatialSpacing.md,
) {
    HorizontalDivider(
        modifier = modifier.padding(start = insetStart),
        thickness = 0.5.dp,
        color = SpatialTheme.colors.hairline,
    )
}

@Composable
fun SpatialPrimaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    testTag: String? = null,
) {
    val colors = SpatialTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val bg by animateColorAsState(
        targetValue = if (enabled) colors.accent else colors.accent.copy(alpha = 0.35f),
        animationSpec = tween(180),
        label = "primaryBtnBg",
    )
    val taggedModifier = (if (testTag != null) modifier.testTag(testTag) else modifier)
        .fillMaxWidth()
        .heightIn(min = 52.dp)
        .spatialPressScale(interactionSource, enabled = enabled && !loading, hapticEffect = HapticEffect.Light)

    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        interactionSource = interactionSource,
        shape = RoundedCornerShape(SpatialRadii.pill),
        colors = ButtonDefaults.buttonColors(
            containerColor = bg,
            contentColor = colors.onAccent,
            disabledContainerColor = colors.accent.copy(alpha = 0.30f),
            disabledContentColor = colors.onAccent.copy(alpha = 0.65f),
        ),
        contentPadding = PaddingValues(horizontal = SpatialSpacing.lg, vertical = 14.dp),
        modifier = taggedModifier,
    ) {
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = colors.onAccent,
            )
            Spacer(Modifier.width(SpatialSpacing.xs))
        }
        Text(
            text = label,
            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
        )
    }
}

@Composable
fun SpatialSecondaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    testTag: String? = null,
) {
    val colors = SpatialTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val taggedModifier = (if (testTag != null) modifier.testTag(testTag) else modifier)
        .fillMaxWidth()
        .heightIn(min = 50.dp)
        .spatialPressScale(interactionSource, enabled = enabled, hapticEffect = HapticEffect.Selection)

    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        interactionSource = interactionSource,
        shape = RoundedCornerShape(SpatialRadii.pill),
        border = androidx.compose.foundation.BorderStroke(1.dp, colors.glassBorderStart.copy(alpha = 0.65f)),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = colors.glassSubtle,
            contentColor = colors.textPrimary,
        ),
        contentPadding = PaddingValues(horizontal = SpatialSpacing.lg, vertical = 13.dp),
        modifier = taggedModifier,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium),
        )
    }
}

@Composable
fun SpatialGlassTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    singleLine: Boolean = true,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else 6,
    enabled: Boolean = true,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
) {
    val colors = SpatialTheme.colors
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        enabled = enabled,
        singleLine = singleLine,
        minLines = minLines,
        maxLines = maxLines,
        label = label?.let { { Text(it) } },
        placeholder = placeholder?.let { { Text(it, color = colors.textTertiary) } },
        leadingIcon = leadingIcon,
        trailingIcon = trailingIcon,
        visualTransformation = visualTransformation,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        shape = RoundedCornerShape(SpatialRadii.md),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = colors.glassCard,
            unfocusedContainerColor = colors.glassSubtle,
            disabledContainerColor = colors.glassSubtle.copy(alpha = 0.4f),
            focusedBorderColor = colors.accent.copy(alpha = 0.72f),
            unfocusedBorderColor = colors.hairline,
            focusedTextColor = colors.textPrimary,
            unfocusedTextColor = colors.textPrimary,
            cursorColor = colors.accent,
        ),
    )
}

@Composable
fun SpatialPulseOrb(
    color: Color = SpatialTheme.colors.accent,
    size: Dp = 8.dp,
    modifier: Modifier = Modifier,
) {
    val transition = rememberInfiniteTransition(label = "pulseOrb")
    val scale by transition.animateFloat(
        initialValue = 0.85f,
        targetValue = 1.25f,
        animationSpec = infiniteRepeatable(
            animation = tween(950),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulseOrbScale",
    )
    val alpha by transition.animateFloat(
        initialValue = 0.55f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(950),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulseOrbAlpha",
    )
    Box(
        modifier = modifier
            .size(size)
            .scale(scale)
            .alpha(alpha)
            .clip(CircleShape)
            .background(color),
    )
}
