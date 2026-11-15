package com.outcomego.android.ui.screens.auth

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.outcomego.android.R
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialGlassTextField
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialMotion
import com.outcomego.android.ui.designsystem.SpatialPrimaryButton
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSecondaryButton
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.features.localizedText

private enum class SignInStep { WELCOME, ENDPOINT, CREDENTIALS }

@Composable
internal fun SignInScreen(
    loading: Boolean,
    checkingServer: Boolean,
    validatedServer: String?,
    error: String?,
    onCheckServer: (String) -> Unit,
    onClearValidation: () -> Unit,
    onContinue: (String, String, String) -> Unit,
    onPreview: (String, String, String) -> Unit,
) {
    var step by remember { mutableStateOf(SignInStep.WELCOME) }
    var server by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var credential by remember { mutableStateOf("") }
    var showingPassword by remember { mutableStateOf(false) }
    var showingInstall by remember { mutableStateOf(false) }
    val scrollState = rememberScrollState()
    val resolvedServer = validatedServer ?: server.trim()
    val colors = SpatialTheme.colors

    Column(
        Modifier
            .fillMaxSize()
            .imePadding()
            .windowInsetsPadding(WindowInsets.statusBars)
            .verticalScroll(scrollState)
            .padding(horizontal = SpatialSpacing.lg, vertical = SpatialSpacing.md),
    ) {
        AnimatedContent(
            targetState = step,
            transitionSpec = {
                val forward = targetState.ordinal > initialState.ordinal
                val spec = tween<androidx.compose.ui.unit.IntOffset>(
                    SpatialMotion.NAV_ENTER_MILLIS,
                    easing = FastOutSlowInEasing,
                )
                (slideInHorizontally(spec) { if (forward) it / 3 else -it / 3 } + fadeIn(tween(240))) togetherWith
                    (slideOutHorizontally(spec) { if (forward) -it / 3 else it / 3 } + fadeOut(tween(180)))
            },
            label = "sign-in-step",
        ) { currentStep ->
            Column(verticalArrangement = Arrangement.spacedBy(SpatialSpacing.md)) {
                when (currentStep) {
                    SignInStep.WELCOME -> {
                        SpatialWizardHero(stage = "server")
                        Column(verticalArrangement = Arrangement.spacedBy(SpatialSpacing.xs)) {
                            Text(
                                text = stringResource(R.string.login_welcome_title),
                                modifier = Modifier.testTag("login-welcome-title"),
                                style = MaterialTheme.typography.headlineLarge,
                                color = colors.textPrimary,
                            )
                            Text(
                                text = stringResource(R.string.login_welcome_detail),
                                color = colors.textSecondary,
                                style = MaterialTheme.typography.bodyLarge,
                            )
                        }
                        AnimatedVisibility(visible = showingInstall) {
                            SpatialGlassSurface(
                                tier = GlassTier.Card,
                                shape = RoundedCornerShape(SpatialRadii.lg),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(
                                    Modifier.padding(SpatialSpacing.md),
                                    verticalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                                ) {
                                    Text(
                                        stringResource(R.string.login_install_server),
                                        style = MaterialTheme.typography.titleSmall,
                                        fontWeight = FontWeight.SemiBold,
                                        color = colors.textPrimary,
                                    )
                                    Text(
                                        stringResource(R.string.login_install_command),
                                        fontFamily = FontFamily.Monospace,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = colors.accent,
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(SpatialRadii.xs))
                                            .background(colors.codeSurface)
                                            .horizontalScroll(rememberScrollState())
                                            .padding(horizontal = 12.dp, vertical = 10.dp),
                                    )
                                    Text(
                                        stringResource(R.string.login_install_detail),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = colors.textSecondary,
                                    )
                                }
                            }
                        }
                        Spacer(Modifier.height(SpatialSpacing.xxs))
                        SpatialPrimaryButton(
                            label = stringResource(R.string.login_get_started),
                            onClick = { step = SignInStep.ENDPOINT },
                            enabled = !loading,
                            testTag = "get-started",
                        )
                        Column(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(SpatialSpacing.xxs),
                        ) {
                            TextButton(
                                onClick = { showingInstall = !showingInstall },
                                modifier = Modifier.fillMaxWidth(),
                                enabled = !loading,
                            ) {
                                Text(
                                    stringResource(
                                        if (showingInstall) R.string.login_have_server
                                        else R.string.login_install_hint,
                                    ),
                                    color = colors.textSecondary,
                                )
                            }
                            TextButton(
                                onClick = { onPreview("", "", "") },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .testTag("preview-workspace"),
                                enabled = !loading,
                            ) {
                                Text(
                                    stringResource(R.string.login_sample),
                                    color = colors.accent,
                                    fontWeight = FontWeight.Medium,
                                )
                            }
                            Text(
                                stringResource(R.string.login_sample_detail),
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.textTertiary,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }

                    SignInStep.ENDPOINT -> {
                        WizardTopBar(stepIndex = 1, onBack = { step = SignInStep.WELCOME })
                        SpatialWizardHero(stage = "endpoint")
                        WizardHeader(
                            title = stringResource(R.string.login_server_title),
                            detail = stringResource(R.string.login_server_detail),
                        )
                        SpatialGlassSurface(
                            tier = GlassTier.Card,
                            shape = RoundedCornerShape(SpatialRadii.lg),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(
                                Modifier.padding(SpatialSpacing.md),
                                verticalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
                            ) {
                                SpatialGlassTextField(
                                    value = server,
                                    onValueChange = {
                                        server = it
                                        if (validatedServer != null) onClearValidation()
                                    },
                                    modifier = Modifier.testTag("server-field"),
                                    label = stringResource(R.string.login_server_address),
                                    placeholder = stringResource(R.string.login_server_placeholder),
                                    singleLine = true,
                                    trailingIcon = {
                                        if (server.isNotEmpty() && !checkingServer) {
                                            IconButton(onClick = { server = "" }) {
                                                Icon(
                                                    Icons.Default.Close,
                                                    contentDescription = stringResource(R.string.login_clear_server),
                                                )
                                            }
                                        }
                                    },
                                )
                                if (checkingServer) {
                                    WizardStatusLine(
                                        text = stringResource(R.string.login_connecting) + " " + server.trim(),
                                        loading = true,
                                    )
                                } else if (validatedServer != null) {
                                    WizardStatusLine(
                                        text = stringResource(
                                            R.string.login_server_found,
                                            resolvedServer.removePrefix("https://").removePrefix("http://"),
                                        ),
                                        done = true,
                                    )
                                }
                            }
                        }
                        if (error != null) {
                            GlassErrorNotice(error)
                        }
                        Text(
                            stringResource(R.string.login_server_hint),
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textTertiary,
                        )
                        if (server.trim().startsWith("http://", ignoreCase = true)) {
                            Text(
                                stringResource(R.string.login_http_warning),
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.danger,
                            )
                        }
                        val serverValidated = validatedServer != null
                        SpatialPrimaryButton(
                            label = stringResource(
                                when {
                                    serverValidated -> R.string.login_connection_successful
                                    checkingServer -> R.string.login_connecting
                                    else -> R.string.login_connect
                                },
                            ),
                            onClick = { onCheckServer(server) },
                            enabled = !serverValidated && server.isNotBlank() && !checkingServer && !loading,
                            loading = checkingServer,
                            testTag = "connect-button",
                        )
                        if (checkingServer) {
                            TextButton(
                                onClick = { step = SignInStep.ENDPOINT },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(stringResource(R.string.login_cancel), color = colors.textSecondary)
                            }
                        } else if (validatedServer != null) {
                            SpatialSecondaryButton(
                                label = stringResource(R.string.login_continue_credentials),
                                onClick = { step = SignInStep.CREDENTIALS },
                                enabled = !loading,
                            )
                        }
                    }

                    SignInStep.CREDENTIALS -> {
                        WizardTopBar(stepIndex = 2, onBack = { step = SignInStep.ENDPOINT })
                        SpatialWizardHero(stage = "credentials")
                        WizardHeader(
                            title = stringResource(R.string.login_credentials_title),
                            detail = stringResource(R.string.login_credentials_detail),
                        )
                        ServerGlassChip(resolvedServer)
                        SpatialGlassSurface(
                            tier = GlassTier.Card,
                            shape = RoundedCornerShape(SpatialRadii.lg),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(
                                Modifier.padding(SpatialSpacing.md),
                                verticalArrangement = Arrangement.spacedBy(SpatialSpacing.sm),
                            ) {
                                SpatialGlassTextField(
                                    value = username,
                                    onValueChange = { username = it },
                                    modifier = Modifier.testTag("username-field"),
                                    label = stringResource(R.string.login_username),
                                    singleLine = true,
                                )
                                SpatialGlassTextField(
                                    value = credential,
                                    onValueChange = { credential = it },
                                    modifier = Modifier.testTag("credential-field"),
                                    label = stringResource(R.string.login_credential),
                                    singleLine = true,
                                    visualTransformation = if (showingPassword) VisualTransformation.None else PasswordVisualTransformation(),
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                    trailingIcon = {
                                        TextButton(onClick = { showingPassword = !showingPassword }) {
                                            Text(
                                                stringResource(
                                                    if (showingPassword) R.string.login_hide
                                                    else R.string.login_show,
                                                ),
                                            )
                                        }
                                    },
                                )
                            }
                        }
                        if (error != null) {
                            GlassErrorNotice(error)
                        }
                        Text(
                            stringResource(R.string.login_forgot),
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textTertiary,
                        )
                        if (resolvedServer.startsWith("http://", ignoreCase = true)) {
                            Text(
                                stringResource(R.string.login_credential_http_warning),
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.danger,
                            )
                        }
                        SpatialPrimaryButton(
                            label = stringResource(
                                if (loading) R.string.login_signing_in
                                else R.string.login_sign_in,
                            ),
                            onClick = { onContinue(resolvedServer, username, credential) },
                            enabled = username.isNotBlank() && credential.isNotBlank() && !loading,
                            loading = loading,
                            testTag = "sign-in-button",
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SpatialWizardHero(stage: String) {
    val colors = SpatialTheme.colors
    val stageColor = when (stage) {
        "credentials" -> Color(0xFF7C4DFF)
        "endpoint" -> Color(0xFF2F6FEB)
        else -> Color(0xFF12A4B4)
    }
    val pulse = rememberInfiniteTransition(label = "hero-aura").animateFloat(
        initialValue = 0.94f,
        targetValue = 1.06f,
        animationSpec = infiniteRepeatable(tween(2800, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "hero-aura-scale",
    )

    SpatialGlassSurface(
        tier = GlassTier.Subtle,
        shape = RoundedCornerShape(SpatialRadii.xl),
        modifier = Modifier
            .fillMaxWidth()
            .height(176.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        listOf(
                            stageColor.copy(alpha = if (colors.isDark) 0.24f else 0.16f),
                            colors.accent.copy(alpha = 0.08f),
                            Color.Transparent,
                        ),
                    ),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier
                    .size(116.dp)
                    .offset(x = (-74).dp, y = 14.dp)
                    .scale(pulse.value)
                    .clip(CircleShape)
                    .background(stageColor.copy(alpha = 0.28f)),
            )
            Box(
                Modifier
                    .size(88.dp)
                    .offset(x = 80.dp, y = (-16).dp)
                    .scale(2f - pulse.value)
                    .clip(CircleShape)
                    .background(colors.accent.copy(alpha = 0.22f)),
            )
            SpatialGlassSurface(
                tier = GlassTier.Overlay,
                shape = RoundedCornerShape(SpatialRadii.md),
                shadowElevation = 12.dp,
                modifier = Modifier.width(262.dp),
            ) {
                Column(
                    Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Box(Modifier.size(7.dp).clip(CircleShape).background(Color(0xFFFF5F57)))
                        Box(Modifier.size(7.dp).clip(CircleShape).background(Color(0xFFFEBC2E)))
                        Box(Modifier.size(7.dp).clip(CircleShape).background(Color(0xFF28C840)))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            "outcomego",
                            color = colors.textTertiary,
                            style = MaterialTheme.typography.labelSmall,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                    Text(
                        "$ outcomego connect",
                        color = colors.textSecondary,
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Text(
                        "✓ ${localizedText("OutcomeGo is ready", "OutcomeGo 已就绪")}",
                        color = colors.success,
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        }
    }
}

@Composable
private fun WizardTopBar(stepIndex: Int, onBack: () -> Unit) {
    val colors = SpatialTheme.colors
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SpatialIconOrb(
            icon = Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = localizedText("Back", "返回"),
            onClick = onBack,
            testTag = "wizard-back",
        )
        Spacer(Modifier.weight(1f))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(1, 2).forEach { index ->
                Box(
                    Modifier
                        .height(6.dp)
                        .width(if (stepIndex == index) 24.dp else 10.dp)
                        .clip(CircleShape)
                        .background(
                            if (stepIndex >= index) colors.accent
                            else colors.hairline,
                        ),
                )
            }
        }
        Spacer(Modifier.weight(1f))
        Text(
            text = stringResource(R.string.app_name),
            style = MaterialTheme.typography.labelMedium,
            color = colors.textTertiary,
        )
    }
}

@Composable
private fun WizardHeader(title: String, detail: String) {
    val colors = SpatialTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            title,
            style = MaterialTheme.typography.headlineMedium,
            color = colors.textPrimary,
        )
        Text(
            detail,
            style = MaterialTheme.typography.bodyLarge,
            color = colors.textSecondary,
        )
    }
}

@Composable
private fun WizardStatusLine(text: String, loading: Boolean = false, done: Boolean = false) {
    val colors = SpatialTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        when {
            loading -> CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = colors.accent)
            done -> Icon(Icons.Default.CheckCircle, contentDescription = null, tint = colors.success, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(8.dp))
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = if (done) colors.success else colors.textSecondary,
        )
    }
}

@Composable
private fun GlassErrorNotice(message: String) {
    val colors = SpatialTheme.colors
    SpatialGlassSurface(
        tier = GlassTier.Subtle,
        shape = RoundedCornerShape(SpatialRadii.sm),
        containerColor = colors.danger.copy(alpha = 0.12f),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(Icons.Default.Close, contentDescription = null, tint = colors.danger, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(message, color = colors.danger, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun ServerGlassChip(server: String) {
    val colors = SpatialTheme.colors
    SpatialGlassSurface(
        tier = GlassTier.Subtle,
        shape = CircleShape,
    ) {
        Text(
            server.removePrefix("https://").removePrefix("http://"),
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
            style = MaterialTheme.typography.labelMedium,
            color = colors.textSecondary,
        )
    }
}
