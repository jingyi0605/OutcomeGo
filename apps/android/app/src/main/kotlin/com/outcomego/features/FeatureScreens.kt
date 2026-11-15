@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.outcomego.features

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialEdgeFade
import com.outcomego.android.ui.designsystem.SpatialFloatingTopBar
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialGlassTextField
import com.outcomego.android.ui.designsystem.SpatialGroupedSection
import com.outcomego.android.ui.designsystem.SpatialHairlineDivider
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialPrimaryButton
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialTheme

@Composable
internal fun featureTopBarColors() = TopAppBarDefaults.topAppBarColors(
    containerColor = Color.Transparent,
    scrolledContainerColor = Color.Transparent,
)

@Composable
internal fun featureCardColors() = CardDefaults.cardColors(
    containerColor = SpatialTheme.colors.glassCard,
)

@Composable
internal fun FeaturePage(
    title: String,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    @Suppress("UNUSED_PARAMETER") settingsStyle: Boolean = false,
    content: @Composable () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .navigationBarsPadding(),
    ) {
        val backLabel = localizedText("Back", "返回")
        SpatialFloatingTopBar(
            title = title,
            subtitle = subtitle,
            navigationIcon = onBack?.let { back ->
                {
                    SpatialIconOrb(
                        icon = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = backLabel,
                        onClick = back,
                    )
                }
            },
        )
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            content()
        }
    }
}

@Composable
internal fun <T> LoadStateContent(
    state: FeatureLoadState<T>,
    onRetry: () -> Unit,
    emptyAction: (@Composable () -> Unit)? = null,
    content: @Composable (T) -> Unit,
) {
    when (state) {
        FeatureLoadState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
            CircularProgressIndicator(strokeWidth = 2.5.dp)
        }
        is FeatureLoadState.Failure -> StateMessage(state.message, onRetry)
        is FeatureLoadState.Empty -> Box(Modifier.fillMaxSize().padding(24.dp), Alignment.Center) {
            SpatialGlassSurface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(SpatialRadii.lg),
                tier = GlassTier.Card,
            ) {
                Column(
                    Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(state.message, color = SpatialTheme.colors.textSecondary)
                    emptyAction?.invoke()
                }
            }
        }
        is FeatureLoadState.Ready -> content(state.value)
    }
}

@Composable
internal fun StateMessage(message: String, onRetry: () -> Unit) {
    Box(Modifier.fillMaxSize().padding(24.dp), Alignment.Center) {
        SpatialGlassSurface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(SpatialRadii.lg),
            tier = GlassTier.Card,
        ) {
            Column(
                Modifier.fillMaxWidth().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(message, color = SpatialTheme.colors.danger)
                SpatialPrimaryButton(
                    label = localizedText("Retry", "重试"),
                    onClick = onRetry,
                )
            }
        }
    }
}

@Composable
internal fun OperationStatus(state: FeatureOperationState) {
    when (state) {
        FeatureOperationState.Idle -> Unit
        FeatureOperationState.Pending -> Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
            Text(
                localizedText("Working…", "处理中…"),
                style = MaterialTheme.typography.bodySmall,
                color = SpatialTheme.colors.textSecondary,
            )
        }
        is FeatureOperationState.Succeeded -> state.message?.let {
            Text(it, color = MaterialTheme.colorScheme.tertiary, style = MaterialTheme.typography.bodySmall)
        }
        is FeatureOperationState.Failed -> Text(
            state.message,
            color = SpatialTheme.colors.danger,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
internal fun SettingsSectionTitle(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        color = SpatialTheme.colors.textSecondary,
        modifier = Modifier.padding(start = 10.dp, top = 12.dp, end = 10.dp, bottom = 2.dp),
    )
}

@Composable
internal fun SettingsGroup(content: @Composable ColumnScope.() -> Unit) {
    SpatialGroupedSection(content = content)
}

@Composable
internal fun SettingsDivider() {
    SpatialHairlineDivider(Modifier.padding(start = 18.dp))
}

@Composable
internal fun SettingsRowText(title: String, description: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = MaterialTheme.typography.bodyLarge, color = SpatialTheme.colors.textPrimary)
        if (description.isNotBlank()) {
            Text(
                description,
                fontSize = 13.sp,
                lineHeight = 18.sp,
                color = SpatialTheme.colors.textSecondary,
            )
        }
    }
}

@Composable
internal fun SettingsRow(title: String, description: String, inline: Boolean = true, content: @Composable () -> Unit) {
    val rowModifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp)
    if (!inline) {
        Column(rowModifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SettingsRowText(title, description)
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) { content() }
        }
    } else {
        Row(rowModifier, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            SettingsRowText(title, description, Modifier.weight(1f))
            content()
        }
    }
}

@Composable
internal fun SettingsToggleRow(title: String, description: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    val haptic = LocalAppHaptics.current
    SettingsRow(title, description) {
        Switch(
            checked = checked,
            onCheckedChange = {
                haptic.play(HapticEffect.Selection)
                onCheckedChange(it)
            },
        )
    }
}

/** A tappable navigation row with a trailing chevron, like a spatial NavigationLink. */
@Composable
internal fun SettingsActionRow(title: String, description: String, onClick: () -> Unit) {
    val haptic = LocalAppHaptics.current
    Row(
        Modifier
            .fillMaxWidth()
            .clickable {
                haptic.play(HapticEffect.Light)
                onClick()
            }
            .padding(horizontal = 18.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SettingsRowText(title, description, Modifier.weight(1f))
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = SpatialTheme.colors.textTertiary,
        )
    }
}

@Composable
internal fun <T> SettingsSegmented(choices: List<T>, selected: T, label: (T) -> String, onSelected: (T) -> Unit) {
    val haptic = LocalAppHaptics.current
    val trackShape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(trackShape)
            .background(SpatialTheme.colors.glassSubtle)
            .border(0.75.dp, SpatialTheme.colors.glassBorderStart, trackShape)
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        choices.forEach { choice ->
            val active = choice == selected
            Box(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(11.dp))
                    .background(if (active) SpatialTheme.colors.glassFloating else Color.Transparent)
                    .then(
                        if (active) Modifier.border(0.75.dp, SpatialTheme.colors.glassBorderStart, RoundedCornerShape(11.dp))
                        else Modifier,
                    )
                    .clickable {
                        if (!active) haptic.play(HapticEffect.Selection)
                        onSelected(choice)
                    }
                    .padding(vertical = 9.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label(choice),
                    fontSize = 13.sp,
                    fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (active) SpatialTheme.colors.textPrimary else SpatialTheme.colors.textSecondary,
                )
            }
        }
    }
}

@Composable
internal fun SettingsTextField(value: String, onChange: (String) -> Unit, placeholder: String, secret: Boolean = false) {
    SpatialGlassTextField(
        value = value,
        onValueChange = onChange,
        placeholder = placeholder,
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
internal fun <T> ChoiceChips(choices: List<T>, selected: T, label: (T) -> String, onSelected: (T) -> Unit) {
    val haptics = LocalAppHaptics.current
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        choices.forEach { choice ->
            val isSelected = choice == selected
            Box(
                Modifier
                    .clip(CircleShape)
                    .background(if (isSelected) MaterialTheme.colorScheme.primary else SpatialTheme.colors.glassSubtle)
                    .border(
                        0.75.dp,
                        if (isSelected) MaterialTheme.colorScheme.primary else SpatialTheme.colors.glassBorderStart,
                        CircleShape,
                    )
                    .clickable {
                        haptics.play(HapticEffect.Selection)
                        onSelected(choice)
                    }
                    .padding(horizontal = 14.dp, vertical = 7.dp),
            ) {
                Text(
                    label(choice),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (isSelected) MaterialTheme.colorScheme.onPrimary else SpatialTheme.colors.textPrimary,
                )
            }
        }
    }
}

/**
 * A vendor mark from the provider icon set (scripts/icons/export-provider-icons.ts). Names ending in
 * "-color" keep their colours; the rest are black on transparent and take the text colour.
 */
@Composable
internal fun ProviderIcon(name: String?, size: Dp = 20.dp) {
    val context = LocalContext.current
    val id = remember(name) {
        name?.let { context.resources.getIdentifier("provider_" + it.replace('-', '_'), "drawable", context.packageName) } ?: 0
    }
    if (id == 0) {
        Spacer(Modifier.size(size))
        return
    }
    Image(
        painter = painterResource(id),
        contentDescription = null,
        modifier = Modifier.size(size),
        contentScale = ContentScale.Fit,
        colorFilter = if (name!!.endsWith("-color")) null else ColorFilter.tint(SpatialTheme.colors.textPrimary),
    )
}
