package com.outcomego.android.ui.screens.details

import android.webkit.WebView
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.outcomego.android.R
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialFloatingTopBar
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialGlassTextField
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.features.FeatureLoadState
import com.outcomego.features.Plugin
import com.outcomego.features.localizedText
import com.outcomego.platform.AndroidVncWebViewRenderer
import com.outcomego.platform.ComputerInput
import com.outcomego.platform.ComputerVncGrant
import com.outcomego.platform.VncRendererState
import java.net.URI
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Composable
internal fun MarketplaceScreen(
    state: FeatureLoadState<List<Plugin>>,
    onBack: () -> Unit,
    onOpenExtensions: () -> Unit,
) {
    val colors = SpatialTheme.colors
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(top = 82.dp, start = SpatialSpacing.md, end = SpatialSpacing.md),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                stringResource(R.string.marketplace_detail),
                color = colors.textSecondary,
                style = MaterialTheme.typography.bodyLarge,
            )
            SpatialGlassSurface(
                tier = GlassTier.Card,
                shape = RoundedCornerShape(SpatialRadii.lg),
                onClick = onOpenExtensions,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(colors.accent.copy(alpha = 0.14f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null, tint = colors.accent)
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            stringResource(R.string.marketplace_extensions),
                            fontWeight = FontWeight.SemiBold,
                            color = colors.textPrimary,
                        )
                        Text(
                            when (state) {
                                is FeatureLoadState.Ready -> stringResource(R.string.marketplace_extensions_count, state.value.size)
                                is FeatureLoadState.Loading -> stringResource(R.string.marketplace_loading)
                                is FeatureLoadState.Empty -> state.message
                                is FeatureLoadState.Failure -> state.message
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textSecondary,
                        )
                    }
                    Icon(
                        Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        tint = colors.textTertiary,
                    )
                }
            }
        }
        SpatialFloatingTopBar(
            title = stringResource(R.string.marketplace_title),
            navigationIcon = {
                SpatialIconOrb(
                    icon = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = localizedText("Back to conversations", "返回对话列表"),
                    onClick = onBack,
                )
            },
        )
    }
}

@Composable
internal fun ComputerViewerScreen(
    title: String,
    botId: String,
    server: String?,
    requestGrant: suspend (String) -> Result<ComputerVncGrant>,
    requestStatus: suspend (String) -> Result<JsonObject>,
    setTakeover: suspend (String, Boolean, Boolean) -> Result<JsonObject>,
    setPaused: suspend (String, Boolean) -> Result<JsonObject>,
    sendAction: suspend (String, JsonObject) -> Result<JsonObject>,
    sendClipboard: suspend (String, String) -> Result<JsonObject>,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val renderer = remember { AndroidVncWebViewRenderer(context) }
    val rendererState by renderer.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<JsonObject?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var clipboardText by remember { mutableStateOf("") }
    var clipboardOpen by remember { mutableStateOf(false) }
    val controlling = status?.get("humanTakeover")?.toString()?.toBoolean() == true
    val paused = status?.get("agentInputPaused")?.toString()?.toBoolean() == true
    val colors = SpatialTheme.colors

    DisposableEffect(renderer) {
        onDispose { renderer.detach() }
    }
    LaunchedEffect(renderer, botId, server) {
        if (server.isNullOrBlank()) {
            renderer.onSocketError("Cloud computer viewing requires a connected server.")
            return@LaunchedEffect
        }
        if (botId.isBlank()) {
            renderer.onSocketError("This conversation is not linked to a bot.")
            return@LaunchedEffect
        }
        var retryDelay = 500L
        while (isActive) {
            val grant = requestGrant(botId).getOrElse {
                failure = it.message ?: "Unable to request the computer viewer."
                renderer.prepareForReconnect()
                null
            }
            if (grant != null) {
                runCatching { renderer.connect(grant, URI(server), botId) }
                    .onSuccess {
                        failure = null
                        retryDelay = 500L
                    }
                    .onFailure {
                        failure = it.message ?: "Unable to connect to the computer."
                        renderer.prepareForReconnect()
                    }
                while (isActive && renderer.state.value == VncRendererState.Connected) {
                    delay(250)
                }
            }
            if (!isActive) break
            delay(retryDelay)
            retryDelay = (retryDelay * 2).coerceAtMost(5_000L)
        }
    }
    LaunchedEffect(botId, server, controlling) {
        if (botId.isBlank() || server.isNullOrBlank()) return@LaunchedEffect
        while (isActive) {
            requestStatus(botId).onSuccess { status = it }.onFailure { failure = it.message }
            if (controlling) {
                setTakeover(botId, true, true).onSuccess { status = it }.onFailure { failure = it.message }
            }
            delay(20_000)
        }
    }
    LaunchedEffect(rendererState, controlling, paused) {
        if (rendererState == VncRendererState.Connected) {
            renderer.setControl(controlling && !paused)
        }
    }
    DisposableEffect(botId) {
        onDispose {
            if (controlling) scope.launch { setTakeover(botId, false, false) }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xFF050609)),
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { viewContext -> WebView(viewContext).also(renderer::attach) },
        )

        if (rendererState != VncRendererState.Connected) {
            SpatialGlassSurface(
                tier = GlassTier.Overlay,
                shape = RoundedCornerShape(SpatialRadii.lg),
                containerColor = Color(0xFF151821).copy(alpha = 0.88f),
                contentColor = Color.White,
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(24.dp),
            ) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.computer_title), color = Color.White, style = MaterialTheme.typography.titleLarge)
                    Text(
                        when (val state = rendererState) {
                            is VncRendererState.Failed -> state.message
                            is VncRendererState.Reconnecting -> {
                                val reason = state.reason.trim()
                                if (reason.isBlank()) "Computer connection interrupted. Reconnecting…"
                                else "Computer connection interrupted. Reconnecting…\n$reason"
                            }
                            else -> stringResource(R.string.computer_connecting)
                        },
                        color = Color.White.copy(alpha = 0.78f),
                    )
                }
            }
        }

        // Top floating glass control bar
        Row(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SpatialIconOrb(
                icon = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = localizedText("Back to conversations", "返回对话列表"),
                onClick = onBack,
                containerColor = Color(0xFF191D26).copy(alpha = 0.85f),
                tint = Color.White,
            )
            SpatialGlassSurface(
                tier = GlassTier.Floating,
                shape = CircleShape,
                containerColor = Color(0xFF191D26).copy(alpha = 0.85f),
                contentColor = Color.White,
                modifier = Modifier.weight(1f),
            ) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleSmall,
                    color = Color.White,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 11.dp),
                )
            }
            SpatialGlassSurface(
                tier = GlassTier.Floating,
                shape = CircleShape,
                containerColor = if (controlling) colors.accent else Color(0xFF191D26).copy(alpha = 0.85f),
                onClick = {
                    scope.launch {
                        setTakeover(botId, !controlling, false).fold(
                            onSuccess = { status = it; failure = null },
                            onFailure = { failure = it.message },
                        )
                    }
                },
            ) {
                Text(
                    if (controlling) localizedText("Release", "释放控制") else localizedText("Take control", "接管控制"),
                    style = MaterialTheme.typography.labelLarge,
                    color = if (controlling) colors.onAccent else Color.White,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                )
            }
            SpatialGlassSurface(
                tier = GlassTier.Floating,
                shape = CircleShape,
                containerColor = Color(0xFF191D26).copy(alpha = 0.85f),
                onClick = {
                    scope.launch {
                        setPaused(botId, !paused).fold(
                            onSuccess = { status = it; failure = null },
                            onFailure = { failure = it.message },
                        )
                    }
                },
            ) {
                Text(
                    if (paused) localizedText("Resume", "继续") else localizedText("Pause", "暂停"),
                    style = MaterialTheme.typography.labelLarge,
                    color = Color.White,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                )
            }
        }

        // Bottom floating glass keyboard & app launcher dock
        val toolbarButtonColors = ButtonDefaults.textButtonColors(
            contentColor = Color.White,
            disabledContentColor = Color.White.copy(alpha = 0.36f),
        )
        SpatialGlassSurface(
            tier = GlassTier.Overlay,
            shape = RoundedCornerShape(SpatialRadii.lg),
            containerColor = Color(0xFF13161F).copy(alpha = 0.86f),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.sm),
        ) {
            Column(
                Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                failure?.let { Text(it, color = Color(0xFFFF8A80), style = MaterialTheme.typography.bodySmall) }
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { clipboardOpen = true }, enabled = controlling && !paused, colors = toolbarButtonColors) {
                        Text(localizedText("Clipboard", "剪贴板"))
                    }
                    listOf("Return", "Tab", "Escape", "BackSpace").forEach { key ->
                        TextButton(
                            onClick = { scope.launch { runCatching { renderer.send(ComputerInput.Key(listOf(key))) } } },
                            enabled = controlling && !paused,
                            colors = toolbarButtonColors,
                        ) {
                            Text(key)
                        }
                    }
                }
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf("chromium" to "Browser", "thunar" to "Files", "terminal" to "Terminal").forEach { (app, label) ->
                        TextButton(
                            onClick = { scope.launch { sendAction(botId, buildJsonObject { put("action", "open_app"); put("app", app) }) } },
                            enabled = controlling && !paused,
                            colors = toolbarButtonColors,
                        ) {
                            Text(label)
                        }
                    }
                }
            }
        }
    }

    if (clipboardOpen) {
        AlertDialog(
            onDismissRequest = { clipboardOpen = false },
            containerColor = colors.glassOverlay,
            title = { Text(localizedText("Send text to computer", "发送文本到云电脑"), color = colors.textPrimary) },
            text = {
                SpatialGlassTextField(
                    value = clipboardText,
                    onValueChange = { clipboardText = it },
                    label = localizedText("Text", "文本"),
                    singleLine = false,
                    minLines = 3,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            sendClipboard(botId, clipboardText).onFailure { failure = it.message }
                            clipboardOpen = false
                        }
                    },
                    enabled = clipboardText.isNotBlank() && controlling && !paused,
                ) { Text(localizedText("Send", "发送"), color = colors.accent) }
            },
            dismissButton = {
                TextButton(onClick = { clipboardOpen = false }) {
                    Text(localizedText("Cancel", "取消"), color = colors.textSecondary)
                }
            },
        )
    }
}
