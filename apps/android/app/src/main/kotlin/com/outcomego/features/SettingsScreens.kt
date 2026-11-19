@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.outcomego.features

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.outcomego.android.ui.designsystem.SpatialAmbientCanvas
import com.outcomego.android.ui.designsystem.SpatialFloatingTopBar
import com.outcomego.android.ui.designsystem.SpatialGlassBackdropProvider
import com.outcomego.android.ui.designsystem.SpatialGlassTextField
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialPrimaryButton
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSecondaryButton
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.android.ui.designsystem.rememberSpatialGlassBackdrop
import com.outcomego.android.ui.designsystem.spatialGlassBackdropSource
import com.outcomego.mobile.network.ProviderSnapshot
import com.outcomego.mobile.network.ProviderState
import com.outcomego.platform.AndroidUpdateState
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
    settings: AppSettings,
    accountName: String,
    server: String,
    networkSharing: ProviderSnapshot,
    onToggleNetworkSharing: (Boolean) -> Unit,
    onNetworkSharingDetails: () -> Unit,
    androidUpdateState: AndroidUpdateState,
    onCheckForAndroidUpdate: () -> Unit,
    onDownloadAndroidUpdate: () -> Unit,
    onInstallAndroidUpdate: () -> Unit,
    androidUpdateChannel: String,
    onSetAndroidUpdateChannel: (String) -> Unit,
    onChange: (AppSettings) -> Unit,
    onSignOut: () -> Unit,
    onBack: () -> Unit,
    onProviders: () -> Unit,
    onRealtimeVoice: () -> Unit,
    onWebProviders: () -> Unit,
    onOutbox: () -> Unit,
    onAccount: () -> Unit,
    onPlugins: () -> Unit,
    onSidebar: () -> Unit,
) {
    val haptic = LocalAppHaptics.current
    var confirmSignOut by remember { mutableStateOf(false) }
    val language = settings.language
    val text: (String, String) -> String = { english, chinese ->
        if (language == AppSettings.Language.Chinese) chinese else english
    }

    val backdrop = rememberSpatialGlassBackdrop()

    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .spatialGlassBackdropSource(backdrop),
        ) {
            SpatialAmbientCanvas(Modifier.fillMaxSize()) {
                LazyColumn(
                    Modifier
                        .fillMaxSize()
                        .navigationBarsPadding()
                        .pointerInput(haptic) {
                            // Mirror the way settings opens: dragging it back to the left closes it.
                            val trigger = 72.dp.toPx()
                            var total = 0f
                            var fired = false
                            detectHorizontalDragGestures(onDragStart = { total = 0f; fired = false }) { _, delta ->
                                total += delta
                                if (!fired && total <= -trigger) {
                                    fired = true
                                    haptic.play(HapticEffect.Medium)
                                    onBack()
                                }
                            }
                        }
                        .padding(horizontal = SpatialSpacing.md),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    contentPadding = PaddingValues(top = 86.dp, bottom = 32.dp),
                ) {
                item {
                    SettingsGroup {
                        Row(Modifier.padding(horizontal = 18.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                Modifier
                                    .size(46.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.primary),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    accountName.take(1).uppercase().ifBlank { "O" },
                                    color = MaterialTheme.colorScheme.onPrimary,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                            Spacer(Modifier.width(14.dp))
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(
                                    accountName.ifBlank { "OutcomeGo" },
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = SpatialTheme.colors.textPrimary,
                                )
                                Text(
                                    server,
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    color = SpatialTheme.colors.textSecondary,
                                )
                                Text(
                                    text("Connected", "已连接"),
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.tertiary,
                                    fontWeight = FontWeight.Medium,
                                )
                            }
                        }
                    }
                }

                item { SettingsSectionTitle(text("Updates", "更新")) }
                item {
                    SettingsGroup {
                        AndroidUpdateRow(
                            state = androidUpdateState,
                            text = text,
                            onCheck = onCheckForAndroidUpdate,
                            onDownload = onDownloadAndroidUpdate,
                            onInstall = onInstallAndroidUpdate,
                        )
                        SettingsDivider()
                        UpdateChannelRow(
                            channel = androidUpdateChannel,
                            onSetChannel = onSetAndroidUpdateChannel,
                            text = text,
                        )
                    }
                }

                item { SettingsSectionTitle(text("Appearance", "外观")) }
                item {
                    SettingsGroup {
                        SettingsRow(text("Theme", "主题"), "", inline = false) {
                            SettingsSegmented(
                                choices = AppSettings.Appearance.entries,
                                selected = settings.appearance,
                                label = { choice ->
                                    when (choice) {
                                        AppSettings.Appearance.System -> text("System", "系统")
                                        AppSettings.Appearance.Light -> text("Light", "浅色")
                                        AppSettings.Appearance.Dark -> text("Dark", "深色")
                                    }
                                },
                                onSelected = { onChange(settings.copy(appearance = it)) },
                            )
                        }
                        SettingsDivider()
                        SettingsRow(text("Accent", "强调色"), "", inline = false) {
                            SettingsSegmented(
                                choices = AppSettings.Accent.entries,
                                selected = settings.accent,
                                label = { choice ->
                                    when (choice) {
                                        AppSettings.Accent.Black -> text("Black", "黑色")
                                        AppSettings.Accent.Blue -> text("Blue", "蓝色")
                                        AppSettings.Accent.Purple -> text("Purple", "紫色")
                                        AppSettings.Accent.Green -> text("Green", "绿色")
                                    }
                                },
                                onSelected = { onChange(settings.copy(accent = it)) },
                            )
                        }
                    }
                }

                item { SettingsSectionTitle(text("Language", "语言")) }
                item {
                    SettingsGroup {
                        SettingsRow(text("Interface language", "界面语言"), "", inline = false) {
                            SettingsSegmented(
                                choices = AppSettings.Language.entries,
                                selected = language,
                                label = { choice -> if (choice == AppSettings.Language.Chinese) "中文" else "English" },
                                onSelected = { onChange(settings.copy(language = it)) },
                            )
                        }
                    }
                }

                item { SettingsSectionTitle(text("Preferences", "偏好设置")) }
                item {
                    SettingsGroup {
                        SettingsRow(text("Time zone", "时区"), text("Used for routines and timestamps", "用于例行任务和时间戳"), inline = false) {
                            SearchableTimeZoneSelector(
                                selectedTimeZone = settings.timeZone,
                                overrideTimeZone = settings.overrideTimeZone,
                                detectedTimeZone = settings.detectedTimeZone,
                                includeAutoDetect = true,
                                useChinese = settings.language == AppSettings.Language.Chinese,
                                style = SelectorFieldStyle.Settings,
                                onSelectTimeZone = { zone, override ->
                                    onChange(settings.copy(timeZone = zone, overrideTimeZone = override))
                                },
                            )
                        }
                        SettingsDivider()
                        SettingsRow(text("App haptics", "应用触感反馈"), text("Vibrate for important interactions", "重要交互时提供震动反馈")) {
                            Switch(
                                checked = settings.haptics,
                                onCheckedChange = {
                                    onChange(settings.copy(haptics = it))
                                    if (it) haptic.play(HapticEffect.Selection)
                                },
                            )
                        }
                    }
                }

                item { SettingsSectionTitle(text("Notifications", "通知")) }
                item {
                    SettingsGroup {
                        val enabled = settings.notifications.messages ||
                            settings.notifications.mentions ||
                            settings.notifications.routineRuns
                        SettingsToggleRow(
                            text("Notifications", "通知"),
                            text("Notify about activity from this server", "接收此服务器的活动通知"),
                            enabled,
                        ) {
                            onChange(settings.copy(notifications = NotificationPreferences(it, it, it)))
                        }
                    }
                }

                item { SettingsSectionTitle(text("Connections", "连接")) }
                item {
                    SettingsGroup {
                        val sharing = networkSharing.state != ProviderState.STOPPED
                        val status = when (networkSharing.state) {
                            ProviderState.READY -> text("Sharing is active", "共享已开启")
                            ProviderState.CONNECTING, ProviderState.ENROLLING, ProviderState.RECONNECTING -> text("Connecting…", "正在连接…")
                            ProviderState.UNAVAILABLE -> text("Temporarily unavailable", "暂时不可用")
                            ProviderState.REVOKED -> text("Authorization revoked", "授权已撤销")
                            ProviderState.FAILED -> text("Needs attention", "需要处理")
                            else -> text("Allow this device to provide public network access", "允许此设备提供公共网络出口")
                        }
                        SettingsToggleRow(
                            text("Network sharing", "网络共享"),
                            status,
                            sharing,
                            onToggleNetworkSharing,
                        )
                        SettingsDivider()
                        SettingsActionRow(
                            text("Cloud computer egress", "云端电脑出口"),
                            text("View route, proxy address, traffic, and speed", "查看路由、代理地址、流量和速度"),
                            onNetworkSharingDetails,
                        )
                        SettingsDivider()
                        SettingsActionRow(text("Message outbox", "消息发件箱"), text("Retry messages that could not be delivered", "重试无法投递的消息"), onOutbox)
                        SettingsDivider()
                        SettingsActionRow(text("Account and memory", "账户与记忆"), text("Review account data and saved memories", "查看账户数据和已保存的记忆"), onAccount)
                        SettingsDivider()
                        SettingsActionRow(text("Plugins", "插件"), text("Manage installed connections and tools", "管理已安装的连接和工具"), onPlugins)
                        SettingsDivider()
                        SettingsActionRow(text("Organize conversations", "整理会话"), text("Rename sections and manage hidden conversations", "重命名分区并管理隐藏会话"), onSidebar)
                        SettingsDivider()
                        SettingsActionRow(text("AI model", "AI 模型"), text("Choose the provider and model used by bots", "选择 Bot 使用的服务商和模型"), onProviders)
                        SettingsDivider()
                        SettingsActionRow(text("Realtime voice", "实时语音"), text("Configure speech providers for realtime conversations", "配置实时对话的语音服务商"), onRealtimeVoice)
                        SettingsDivider()
                        SettingsActionRow(text("Web providers", "网络服务商"), text("Choose search and page-fetch services", "选择搜索和网页抓取服务"), onWebProviders)
                    }
                }

                item {
                    SettingsGroup {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .clickable {
                                    haptic.play(HapticEffect.Light)
                                    confirmSignOut = true
                                }
                                .padding(vertical = 15.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text("Sign out", "退出登录"),
                                color = SpatialTheme.colors.danger,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                    }
                }
            }
            }
        }
        SpatialGlassBackdropProvider(backdrop) {
            SpatialFloatingTopBar(
                title = text("Settings", "设置"),
                subtitle = text("Application preferences", "应用偏好"),
                navigationIcon = {
                    SpatialIconOrb(
                        icon = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = text("Back", "返回"),
                        onClick = onBack,
                    )
                },
                modifier = Modifier.align(Alignment.TopCenter),
            )
        }
    }

    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            containerColor = SpatialTheme.colors.glassOverlay,
            title = { Text(text("Sign out?", "退出登录？")) },
            text = { Text(text("You will need to sign in again to use this server.", "你需要重新登录才能使用此服务器。")) },
            confirmButton = {
                TextButton(onClick = { confirmSignOut = false; onSignOut() }) {
                    Text(text("Sign out", "退出登录"), color = SpatialTheme.colors.danger)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmSignOut = false }) { Text(text("Cancel", "取消")) }
            },
        )
    }
}

@Composable
private fun AndroidUpdateRow(
    state: AndroidUpdateState,
    text: (String, String) -> String,
    onCheck: () -> Unit,
    onDownload: () -> Unit,
    onInstall: () -> Unit,
) {
    val (title, description, action, enabled, onClick) = when (state) {
        AndroidUpdateState.Idle -> UpdateRowContent(
            text("Android app", "Android 应用"),
            text("Check GitHub for a signed update.", "检查 GitHub 上是否有已签名更新。"),
            text("Check for updates", "检查更新"),
            true,
            onCheck,
        )
        AndroidUpdateState.Checking -> UpdateRowContent(
            text("Checking for updates", "正在检查更新"),
            text("Verifying the signed GitHub release manifest.", "正在验证 GitHub 已签名发布清单。"),
            text("Checking…", "检查中…"),
            false,
            {},
        )
        is AndroidUpdateState.Available -> UpdateRowContent(
            text("Update available", "有可用更新"),
            text("OutcomeGo ${state.manifest.version} is ready to download.", "OutcomeGo ${state.manifest.version} 已准备下载。"),
            text("Download", "下载"),
            true,
            onDownload,
        )
        is AndroidUpdateState.Downloading -> UpdateRowContent(
            text("Downloading update", "正在下载更新"),
            text("The APK is verified before it can be installed.", "APK 会在安装前完成验证。"),
            state.progress?.let { "$it%" } ?: text("Downloading…", "下载中…"),
            false,
            {},
        )
        is AndroidUpdateState.Ready -> UpdateRowContent(
            text("Update ready", "更新已准备好"),
            text("Install OutcomeGo ${state.manifest.version}.", "安装 OutcomeGo ${state.manifest.version}。"),
            text("Install", "安装"),
            true,
            onInstall,
        )
        is AndroidUpdateState.NeedsInstallPermission -> UpdateRowContent(
            text("Allow APK installs", "允许安装 APK"),
            text("Allow installs from OutcomeGo, then tap Install again.", "允许 OutcomeGo 安装应用，然后再次点击安装。"),
            text("Allow installs", "允许安装"),
            true,
            onInstall,
        )
        is AndroidUpdateState.Installing -> UpdateRowContent(
            text("Installing update", "正在安装更新"),
            text("Android will finish the installation in its system installer.", "Android 将在系统安装器中完成安装。"),
            text("Installing…", "安装中…"),
            false,
            {},
        )
        is AndroidUpdateState.UpToDate -> UpdateRowContent(
            text("You're up to date", "已是最新版本"),
            text("Installed version ${state.currentVersion}.", "当前版本 ${state.currentVersion}。"),
            text("Check again", "再次检查"),
            true,
            onCheck,
        )
        is AndroidUpdateState.Error -> UpdateRowContent(
            text("Update check failed", "更新检查失败"),
            state.message,
            text("Retry", "重试"),
            true,
            onCheck,
        )
    }

    SettingsRow(title, description, inline = false) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
            if (state is AndroidUpdateState.Downloading) {
                LinearProgressIndicator(
                    progress = { (state.progress ?: 0) / 100f },
                    modifier = Modifier.fillMaxWidth().clip(CircleShape),
                )
                Spacer(Modifier.height(8.dp))
            }
            SpatialPrimaryButton(
                label = action,
                onClick = onClick,
                enabled = enabled,
                loading = state is AndroidUpdateState.Checking || state is AndroidUpdateState.Installing,
            )
        }
    }
}

private data class UpdateRowContent(
    val title: String,
    val description: String,
    val action: String,
    val enabled: Boolean,
    val onClick: () -> Unit,
)

@Composable
private fun UpdateChannelRow(
    channel: String,
    onSetChannel: (String) -> Unit,
    text: (String, String) -> String,
) {
    val isBeta = channel == "beta"
    SettingsRow(
        title = text("Update channel", "更新通道"),
        description = if (isBeta)
            text("Receive beta pre-releases and stable updates.", "接收 Beta 预发布版本和稳定更新。")
        else
            text("Only receive stable releases.", "仅接收稳定版更新。"),
        inline = true,
    ) {
        Row(
            Modifier
                .background(
                    MaterialTheme.colorScheme.surfaceVariant,
                    RoundedCornerShape(8.dp),
                )
                .padding(2.dp),
            horizontalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            listOf("stable" to text("Stable", "稳定版"), "beta" to text("Beta", "开发版")).forEach { (ch, label) ->
                val selected = channel == ch
                Box(
                    Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(
                            if (selected) MaterialTheme.colorScheme.surface
                            else Color.Transparent,
                        )
                        .clickable { if (!selected) onSetChannel(ch) }
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        label,
                        fontSize = 12.sp,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (selected) SpatialTheme.colors.textPrimary
                        else SpatialTheme.colors.textSecondary,
                    )
                }
            }
        }
    }
}

@Composable
fun ProviderSettingsScreen(
    state: FeatureLoadState<List<ProviderConnection>>,
    onRetry: () -> Unit,
    onBack: () -> Unit,
    language: AppSettings.Language,
    onConnect: (ProviderConnection, String?) -> Unit,
    onDisconnect: (ProviderConnection) -> Unit,
    onRemove: (ProviderConnection) -> Unit,
    loadPresets: suspend () -> Result<List<ProviderPreset>>,
    onAdd: suspend (ProviderPreset?, String, String, ProviderProtocol, String?) -> Result<String>,
    onModelChange: (ProviderConnection, String) -> Unit,
    onReasoningChange: (ProviderConnection, String) -> Unit,
) {
    var pendingDisconnect by remember { mutableStateOf<ProviderConnection?>(null) }
    var pendingRemove by remember { mutableStateOf<ProviderConnection?>(null) }
    var adding by remember { mutableStateOf(false) }
    val text: (String, String) -> String = { english, chinese -> if (language == AppSettings.Language.Chinese) chinese else english }
    FeaturePage(text("AI model", "AI 模型"), onBack = onBack, settingsStyle = true) {
        LoadStateContent(state, onRetry) { providers ->
            LazyColumn(
                Modifier.fillMaxSize().padding(horizontal = SpatialSpacing.md),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(top = 12.dp, bottom = 28.dp),
            ) {
                item { SettingsSectionTitle(text("Choose the provider and model used by bots.", "选择 Bot 使用的服务商和模型。")) }
                items(providers, key = { it.id }) { provider ->
                    SettingsGroup {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                ProviderIcon(provider.icon)
                                Spacer(Modifier.width(10.dp))
                                Text(provider.name, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = SpatialTheme.colors.textPrimary)
                                Text(
                                    if (provider.connected) text("Connected", "已连接") else text("Disconnected", "未连接"),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = if (provider.connected) MaterialTheme.colorScheme.tertiary else SpatialTheme.colors.textSecondary,
                                )
                            }
                            provider.error?.let { Text(it, color = SpatialTheme.colors.danger, style = MaterialTheme.typography.bodySmall) }
                            if (!provider.connected) {
                                if (provider.authMode == AuthMode.ApiKey) {
                                    var apiKey by remember(provider.id) { mutableStateOf("") }
                                    SpatialGlassTextField(
                                        value = apiKey,
                                        onValueChange = { apiKey = it },
                                        label = if (provider.apiKeySaved) text("Replace API key", "替换 API 密钥") else text("API key", "API 密钥"),
                                        visualTransformation = PasswordVisualTransformation(),
                                        modifier = Modifier.fillMaxWidth(),
                                        singleLine = true,
                                    )
                                    SpatialPrimaryButton(
                                        label = text("Save and connect", "保存并连接"),
                                        onClick = {
                                            onConnect(provider.copy(apiKeySaved = true), apiKey.takeIf { it.isNotBlank() })
                                            apiKey = ""
                                        },
                                        enabled = apiKey.isNotBlank() || provider.apiKeySaved,
                                    )
                                } else {
                                    SpatialPrimaryButton(
                                        label = if (provider.authMode == AuthMode.OAuth) text("Connect with OAuth", "使用 OAuth 连接") else text("Connect", "连接"),
                                        onClick = { onConnect(provider, null) },
                                    )
                                }
                            } else {
                                SettingsRow(text("Model", "模型"), text("Used by this provider", "此服务商使用的模型"), inline = false) {
                                    ChoiceChips(provider.models, provider.selectedModel ?: provider.models.firstOrNull().orEmpty(), { it }) {
                                        onModelChange(provider, it)
                                    }
                                }
                                SettingsRow(text("Reasoning", "推理强度"), text("How much effort the model uses", "模型使用的推理强度"), inline = false) {
                                    ChoiceChips(provider.reasoningLevels, provider.selectedReasoning ?: provider.reasoningLevels.firstOrNull().orEmpty(), { it }) {
                                        onReasoningChange(provider, it)
                                    }
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    if (provider.custom) {
                                        TextButton(onClick = { pendingRemove = provider }) {
                                            Text(text("Remove", "移除"), color = SpatialTheme.colors.danger)
                                        }
                                    }
                                    TextButton(onClick = { pendingDisconnect = provider }) {
                                        Text(text("Disconnect", "断开连接"), color = SpatialTheme.colors.danger)
                                    }
                                }
                            }
                        }
                    }
                }
                item {
                    SpatialSecondaryButton(
                        label = text("Add provider", "添加服务商"),
                        onClick = { adding = true },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
        pendingDisconnect?.let { provider ->
            AlertDialog(
                onDismissRequest = { pendingDisconnect = null },
                containerColor = SpatialTheme.colors.glassOverlay,
                title = { Text(text("Disconnect ${provider.name}?", "断开 ${provider.name}？")) },
                text = { Text(text("The server will remove this provider connection and its selected model.", "服务器将移除此服务商连接及其已选模型。")) },
                confirmButton = {
                    TextButton(onClick = { pendingDisconnect = null; onDisconnect(provider) }) {
                        Text(text("Disconnect", "断开连接"), color = SpatialTheme.colors.danger)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { pendingDisconnect = null }) { Text(text("Cancel", "取消")) }
                },
            )
        }
        pendingRemove?.let { provider ->
            AlertDialog(
                onDismissRequest = { pendingRemove = null },
                containerColor = SpatialTheme.colors.glassOverlay,
                title = { Text(text("Remove ${provider.name}?", "移除 ${provider.name}？")) },
                text = { Text(text("Its address and key are deleted from your server.", "它的地址和密钥会从你的服务器上删除。")) },
                confirmButton = {
                    TextButton(onClick = { pendingRemove = null; onRemove(provider) }) {
                        Text(text("Remove", "移除"), color = SpatialTheme.colors.danger)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { pendingRemove = null }) { Text(text("Cancel", "取消")) }
                },
            )
        }
        if (adding) AddProviderSheet(text = text, loadPresets = loadPresets, onAdd = onAdd, onDismiss = { adding = false })
    }
}

private val providerGroups = listOf(
    "vendor" to ("Model makers" to "模型厂商"),
    "cloud" to ("Cloud platforms" to "云平台"),
    "relay" to ("Hosts and gateways" to "托管与网关"),
    "local" to ("On this server" to "在此服务器上"),
)

/** Adds a provider over a standard protocol. The server keeps the key and removes the provider again if the key is refused. */
@Composable
private fun AddProviderSheet(
    text: (String, String) -> String,
    loadPresets: suspend () -> Result<List<ProviderPreset>>,
    onAdd: suspend (ProviderPreset?, String, String, ProviderProtocol, String?) -> Result<String>,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    var presets by remember { mutableStateOf<List<ProviderPreset>>(emptyList()) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var preset by remember { mutableStateOf<ProviderPreset?>(null) }
    var protocol by remember { mutableStateOf(ProviderProtocol.OpenAiChat) }
    var name by remember { mutableStateOf("") }
    var baseUrl by remember { mutableStateOf("") }
    var apiKey by remember { mutableStateOf("") }
    var failure by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var serviceMenu by remember { mutableStateOf(false) }
    var protocolMenu by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        loadPresets().onSuccess { presets = it }.onFailure { loadError = it.message ?: text("Could not load the provider list", "无法加载服务商列表") }
    }
    // The key field is shown unless the server never takes one; an optional key may stay empty.
    val showsKey = preset?.noKey != true
    val withoutKey = !showsKey || (preset?.keyOptional == true && apiKey.isBlank())
    val protocols = preset?.protocols ?: ProviderProtocol.values().toList()
    val ready = name.isNotBlank() && baseUrl.isNotBlank() && (withoutKey || apiKey.isNotBlank())
    fun pick(next: ProviderPreset?) {
        preset = next
        failure = null
        if (next != null) {
            protocol = next.defaultProtocol
            name = next.name
            baseUrl = next.baseUrl(protocol)
        }
    }
    ModalBottomSheet(
        onDismissRequest = { if (!busy) onDismiss() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = SpatialTheme.colors.glassOverlay,
        shape = RoundedCornerShape(topStart = SpatialRadii.xl, topEnd = SpatialRadii.xl),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 20.dp)
                .imePadding()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(text("Add provider", "添加服务商"), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, color = SpatialTheme.colors.textPrimary)
            Text(
                text("Connect any service that speaks OpenAI Chat, OpenAI Responses or Anthropic Messages. The key stays on your server.", "连接任何支持 OpenAI Chat、OpenAI Responses 或 Anthropic Messages 的服务。密钥只保存在你的服务器上。"),
                fontSize = 13.sp,
                color = SpatialTheme.colors.textSecondary,
            )
            Box {
                SelectorTriggerField(
                    value = preset?.name ?: text("Custom endpoint", "自定义地址"),
                    onClick = { if (!busy) serviceMenu = true },
                    enabled = !busy,
                    style = SelectorFieldStyle.Settings,
                    leadingContent = { ProviderIcon(preset?.icon ?: protocol.genericIcon, 18.dp) },
                )
                DropdownMenu(
                    expanded = serviceMenu,
                    onDismissRequest = { serviceMenu = false },
                    containerColor = SpatialTheme.colors.glassOverlay,
                    modifier = Modifier.heightIn(max = 420.dp),
                ) {
                    DropdownMenuItem(
                        leadingIcon = { ProviderIcon(protocol.genericIcon, 18.dp) },
                        text = { Text(text("Custom endpoint", "自定义地址")) },
                        onClick = { serviceMenu = false; pick(null) },
                    )
                    providerGroups.forEach { (group, titles) ->
                        val members = presets.filter { it.group == group }
                        if (members.isNotEmpty()) {
                            Text(
                                text(titles.first, titles.second),
                                Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                                fontSize = 12.sp,
                                color = SpatialTheme.colors.textSecondary,
                            )
                            members.forEach { member ->
                                DropdownMenuItem(
                                    leadingIcon = { ProviderIcon(member.icon, 18.dp) },
                                    text = { Text(member.name) },
                                    onClick = { serviceMenu = false; pick(member) },
                                )
                            }
                        }
                    }
                }
            }
            loadError?.let { Text(it, color = SpatialTheme.colors.danger, fontSize = 13.sp) }
            Box {
                SelectorTriggerField(
                    value = protocol.label,
                    onClick = { if (!busy && protocols.size > 1) protocolMenu = true },
                    enabled = !busy && protocols.size > 1,
                    style = SelectorFieldStyle.Settings,
                )
                DropdownMenu(
                    expanded = protocolMenu,
                    onDismissRequest = { protocolMenu = false },
                    containerColor = SpatialTheme.colors.glassOverlay,
                ) {
                    protocols.forEach { option ->
                        DropdownMenuItem(
                            text = { Text(option.label) },
                            onClick = {
                                protocolMenu = false
                                protocol = option
                                // A vendor documents an address per protocol; a typed address stays as it is.
                                preset?.takeIf { it.endpoints.containsKey(option.wire) }?.let { baseUrl = it.baseUrl(option) }
                            },
                        )
                    }
                }
            }
            SpatialGlassTextField(
                value = name,
                onValueChange = { name = it },
                label = text("Name", "名称"),
                enabled = !busy,
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            SpatialGlassTextField(
                value = baseUrl,
                onValueChange = { baseUrl = it },
                label = text("API base URL", "API 基础地址"),
                enabled = !busy,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            if (showsKey) {
                SpatialGlassTextField(
                    value = apiKey,
                    onValueChange = { apiKey = it },
                    label = if (preset?.keyOptional == true) text("API key (optional)", "API 密钥（可选）") else text("API key", "API 密钥"),
                    enabled = !busy,
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )
                preset?.keysUrl?.let { url ->
                    TextButton(onClick = { uriHandler.openUri(url) }) { Text(text("Get a key", "获取密钥")) }
                }
            }
            if (preset?.noKey == true || preset?.keyOptional == true) {
                preset?.note?.let { Text(it, fontSize = 13.sp, color = SpatialTheme.colors.textSecondary) }
            }
            failure?.let { Text(it, color = SpatialTheme.colors.danger, fontSize = 13.sp) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss, enabled = !busy) { Text(text("Cancel", "取消")) }
                SpatialPrimaryButton(
                    label = if (busy) text("Checking the key…", "正在检查密钥…") else text("Add", "添加"),
                    enabled = ready && !busy,
                    loading = busy,
                    modifier = Modifier.weight(1f),
                    onClick = {
                        busy = true
                        failure = null
                        scope.launch {
                            onAdd(preset, name.trim(), baseUrl.trim(), protocol, if (withoutKey) null else apiKey.trim())
                                .onSuccess { onDismiss() }
                                .onFailure { failure = it.message ?: text("Could not add this provider", "无法添加此服务商") }
                            busy = false
                        }
                    },
                )
            }
        }
    }
}

/** Display-only mirror of the server's per-provider defaults, shown as placeholders for blank fields. */
private data class VoiceDefaults(val sttModel: String, val ttsModel: String, val voice: String, val language: String)

private val volcengineDefaults = VoiceDefaults("bigmodel", "", "zh_female_vv_uranus_bigtts", "zh-CN")
private val deepgramDefaults = VoiceDefaults("nova-3", "aura-2-thalia-en", "alloy", "en-US")

@Composable
fun VoiceSettingsScreen(
    state: FeatureLoadState<VoiceSettings>,
    language: AppSettings.Language,
    onRetry: () -> Unit,
    onSave: (VoiceSettings, String?, String?, Boolean, Boolean) -> Unit,
    onBack: () -> Unit,
) {
    val text: (String, String) -> String = { english, chinese -> if (language == AppSettings.Language.Chinese) chinese else english }
    var draft by remember { mutableStateOf<VoiceSettings?>(null) }
    var apiKey by remember { mutableStateOf("") }
    var removeKey by remember { mutableStateOf(false) }
    var advancedOpen by remember { mutableStateOf(false) }
    LaunchedEffect(state) { if (state is FeatureLoadState.Ready) draft = state.value }
    FeaturePage(text("Realtime voice", "实时语音"), onBack = onBack, settingsStyle = true) {
        LoadStateContent(state, onRetry) { loaded ->
            val value = draft ?: loaded
            val volcengine = value.defaultProvider == "volcengine"
            val provider = if (volcengine) value.volcengine else value.deepgram
            val providerName = if (volcengine) "Volcengine" else "Deepgram"
            val defaults = if (volcengine) volcengineDefaults else deepgramDefaults
            val changed = value != loaded || apiKey.isNotBlank() || removeKey
            fun update(next: VoiceSettings) { draft = next }
            fun updateProvider(change: (VoiceProviderSettings) -> VoiceProviderSettings) {
                update(if (volcengine) value.copy(volcengine = change(value.volcengine)) else value.copy(deepgram = change(value.deepgram)))
            }
            LazyColumn(
                Modifier.fillMaxSize().padding(horizontal = SpatialSpacing.md),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = PaddingValues(top = 10.dp, bottom = 32.dp),
            ) {
                item {
                    SettingsGroup {
                        SettingsToggleRow(
                            text("Enable realtime voice", "启用实时语音"),
                            text("Allow authenticated speech sessions from macOS and Android", "允许 macOS 和 Android 建立认证语音会话"),
                            value.enabled,
                        ) { update(value.copy(enabled = it)) }
                    }
                }
                item { SettingsSectionTitle(text("Provider", "服务商")) }
                item {
                    SettingsGroup {
                        Column(Modifier.padding(horizontal = 18.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            SettingsSegmented(listOf("volcengine", "deepgram"), value.defaultProvider, { if (it == "volcengine") "Volcengine" else "Deepgram" }) {
                                update(value.copy(defaultProvider = it))
                                apiKey = ""
                                removeKey = false
                            }
                            VoiceStatus(
                                ok = provider.configured,
                                label = if (provider.configured) text("$providerName is configured.", "$providerName 已配置。") else text("$providerName needs an API key.", "$providerName 需要 API 密钥。"),
                            )
                        }
                        SettingsDivider()
                        Column(Modifier.padding(horizontal = 18.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(text("$providerName API key", "$providerName API 密钥"), fontWeight = FontWeight.Medium, color = SpatialTheme.colors.textPrimary)
                            Text(
                                when {
                                    removeKey -> text("The saved key will be deleted when you save.", "保存时将删除已保存的密钥。")
                                    provider.configured -> text("Enter a new key to replace the saved key.", "输入新密钥以替换已保存的密钥。")
                                    else -> text("The key is stored encrypted on the server.", "密钥将加密存储在服务器上。")
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = SpatialTheme.colors.textSecondary,
                            )
                            SettingsTextField(
                                value = apiKey,
                                onChange = { apiKey = it; if (it.isNotBlank()) removeKey = false },
                                placeholder = if (provider.configured) "••••${provider.apiKeySuffix.orEmpty()}" else text("API key", "API 密钥"),
                                secret = true,
                            )
                            if (provider.configured) {
                                TextButton(
                                    onClick = { removeKey = !removeKey; if (removeKey) apiKey = "" },
                                    contentPadding = PaddingValues(horizontal = 4.dp),
                                ) {
                                    Text(
                                        if (removeKey) text("Undo deletion", "撤销删除") else text("Delete key", "删除密钥"),
                                        color = if (removeKey) SpatialTheme.colors.textSecondary else SpatialTheme.colors.danger,
                                    )
                                }
                            }
                        }
                    }
                }
                item {
                    SettingsGroup {
                        Row(
                            Modifier.fillMaxWidth().clickable { advancedOpen = !advancedOpen }.padding(horizontal = 18.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(text("Advanced settings", "高级设置"), fontWeight = FontWeight.Medium, color = SpatialTheme.colors.textPrimary)
                                Text(
                                    text("Provider endpoints, resource IDs, models, and speech defaults", "服务商端点、资源 ID、模型和语音默认值"),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = SpatialTheme.colors.textSecondary,
                                )
                            }
                            Icon(
                                if (advancedOpen) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                                contentDescription = null,
                                tint = SpatialTheme.colors.textSecondary,
                            )
                        }
                    }
                }
                if (advancedOpen) {
                    item { SettingsSectionTitle(text("$providerName connection", "$providerName 连接")) }
                    item {
                        SettingsGroup {
                            if (volcengine) {
                                VoiceField(text("Base URL", "基础 URL"), provider.baseUrl.orEmpty(), "https://openspeech.bytedance.com") { v -> updateProvider { it.copy(baseUrl = v) } }
                                SettingsDivider()
                                VoiceField(text("STT WebSocket URL", "STT WebSocket URL"), provider.sttUrl.orEmpty(), text("Optional provider-specific URL", "可选，服务商专用 URL")) { v -> updateProvider { it.copy(sttUrl = v) } }
                                SettingsDivider()
                                VoiceField(text("TTS WebSocket URL", "TTS WebSocket URL"), provider.ttsUrl.orEmpty(), text("Optional provider-specific URL", "可选，服务商专用 URL")) { v -> updateProvider { it.copy(ttsUrl = v) } }
                                SettingsDivider()
                                VoiceField(text("STT resource ID", "STT 资源 ID"), provider.sttResourceId.orEmpty(), "volc.seedasr.sauc.duration") { v -> updateProvider { it.copy(sttResourceId = v) } }
                                SettingsDivider()
                                VoiceField(text("TTS resource ID", "TTS 资源 ID"), provider.ttsResourceId.orEmpty(), "seed-tts-2.0") { v -> updateProvider { it.copy(ttsResourceId = v) } }
                            } else {
                                VoiceField(text("Base URL", "基础 URL"), provider.baseUrl.orEmpty(), "https://api.deepgram.com") { v -> updateProvider { it.copy(baseUrl = v) } }
                            }
                        }
                    }
                    item { SettingsSectionTitle(text("Speech defaults", "语音默认值")) }
                    item {
                        SettingsGroup {
                            val automatic = text("Automatic", "自动")
                            VoiceField(text("STT model", "语音识别模型"), value.sttModel, defaults.sttModel.ifBlank { automatic }) { update(value.copy(sttModel = it)) }
                            SettingsDivider()
                            VoiceField(text("TTS model", "语音合成模型"), value.ttsModel, defaults.ttsModel.ifBlank { automatic }) { update(value.copy(ttsModel = it)) }
                            SettingsDivider()
                            if (volcengine) {
                                SettingsRow(text("TTS voice", "语音"), "", inline = false) {
                                    VolcengineVoiceSelector(
                                        selectedVoiceId = value.voice,
                                        automaticLabel = defaults.voice.ifBlank { automatic },
                                        useChinese = language == AppSettings.Language.Chinese,
                                        style = SelectorFieldStyle.Settings,
                                        onSelectVoice = { update(value.copy(voice = it)) },
                                    )
                                }
                            } else {
                                VoiceField(text("TTS voice", "语音"), value.voice, defaults.voice.ifBlank { automatic }) { update(value.copy(voice = it)) }
                            }
                            SettingsDivider()
                            VoiceField(text("Language", "语言"), value.language, defaults.language.ifBlank { automatic }) { update(value.copy(language = it)) }
                            SettingsDivider()
                            VoiceField(
                                text("Narration model", "旁白模型"),
                                value.narrationModel,
                                text("Same as the bot", "与 Bot 相同"),
                                hint = text("Speaks short progress updates while the agent works. Use a fast model as provider/model. Leave empty to use the bot's own model.", "Agent 工作时朗读简短的进度更新。请使用 provider/model 格式的快速模型，留空则使用 Bot 自己的模型。"),
                            ) { update(value.copy(narrationModel = it)) }
                        }
                    }
                    item {
                        Text(
                            text("Leave fields empty to use the recommended values.", "字段留空将使用推荐值。"),
                            style = MaterialTheme.typography.bodySmall,
                            color = SpatialTheme.colors.textSecondary,
                            modifier = Modifier.padding(horizontal = 6.dp),
                        )
                    }
                }
                item {
                    SpatialPrimaryButton(
                        label = text("Save settings", "保存设置"),
                        onClick = {
                            onSave(
                                value,
                                if (volcengine) apiKey.takeIf { it.isNotBlank() } else null,
                                if (volcengine) null else apiKey.takeIf { it.isNotBlank() },
                                volcengine && removeKey,
                                !volcengine && removeKey,
                            )
                            apiKey = ""
                            removeKey = false
                        },
                        enabled = changed,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

@Composable
private fun VoiceStatus(ok: Boolean, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(if (ok) MaterialTheme.colorScheme.tertiary else SpatialTheme.colors.danger),
        )
        Text(label, style = MaterialTheme.typography.bodySmall, color = SpatialTheme.colors.textSecondary)
    }
}

@Composable
private fun VoiceField(title: String, value: String, placeholder: String, hint: String? = null, onChange: (String) -> Unit) {
    Column(Modifier.padding(horizontal = 18.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, fontWeight = FontWeight.Medium, color = SpatialTheme.colors.textPrimary)
        hint?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = SpatialTheme.colors.textSecondary) }
        SettingsTextField(value, onChange, placeholder)
    }
}

@Composable
fun WebProviderSettingsScreen(
    state: FeatureLoadState<WebProvidersState>,
    onRetry: () -> Unit,
    onBack: () -> Unit,
    language: AppSettings.Language,
    onSelect: (tool: String, provider: WebProvider) -> Unit,
    onSaveKey: (tool: String, provider: WebProvider, key: String) -> Unit,
    onRemoveKey: (tool: String, provider: WebProvider) -> Unit,
    onCheck: (tool: String, provider: WebProvider) -> Unit,
) {
    val text: (String, String) -> String = { english, chinese -> if (language == AppSettings.Language.Chinese) chinese else english }
    FeaturePage(text("Web providers", "网络服务商"), onBack = onBack, settingsStyle = true) {
        LoadStateContent(state, onRetry) { providers ->
            LazyColumn(
                Modifier.fillMaxSize().padding(horizontal = SpatialSpacing.md),
                verticalArrangement = Arrangement.spacedBy(14.dp),
                contentPadding = PaddingValues(top = 12.dp, bottom = 28.dp),
            ) {
                item {
                    WebProviderTool(
                        text("Search", "搜索"),
                        text("The service bots use to find information on the web.", "Bot 用于在网络上查找信息的服务。"),
                        "search",
                        providers.search,
                        language,
                        onSelect,
                        onSaveKey,
                        onRemoveKey,
                        onCheck,
                    )
                }
                item {
                    WebProviderTool(
                        text("Fetch", "抓取"),
                        text("How bots read a web page without opening their browser.", "Bot 不打开浏览器时读取网页的方式。"),
                        "fetch",
                        providers.fetch,
                        language,
                        onSelect,
                        onSaveKey,
                        onRemoveKey,
                        onCheck,
                    )
                }
            }
        }
    }
}

@Composable
private fun WebProviderTool(
    title: String,
    description: String,
    tool: String,
    providers: List<WebProvider>,
    language: AppSettings.Language,
    onSelect: (String, WebProvider) -> Unit,
    onSaveKey: (String, WebProvider, String) -> Unit,
    onRemoveKey: (String, WebProvider) -> Unit,
    onCheck: (String, WebProvider) -> Unit,
) {
    val text: (String, String) -> String = { english, chinese -> if (language == AppSettings.Language.Chinese) chinese else english }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SettingsSectionTitle(title)
        Text(description, style = MaterialTheme.typography.bodySmall, color = SpatialTheme.colors.textSecondary, modifier = Modifier.padding(horizontal = 8.dp))
        providers.forEach { provider ->
            var key by remember(provider.id) { mutableStateOf("") }
            var confirmRemove by remember(provider.id) { mutableStateOf(false) }
            SettingsGroup {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = provider.selected, onClick = { if (provider.ready || !provider.requiresApiKey) onSelect(tool, provider) })
                        Column(Modifier.weight(1f)) {
                            Text(provider.name, fontWeight = FontWeight.SemiBold, color = SpatialTheme.colors.textPrimary)
                            Text(provider.description, style = MaterialTheme.typography.bodySmall, color = SpatialTheme.colors.textSecondary)
                        }
                        Text(
                            if (provider.check?.passed == true) text("Checked", "已检查")
                            else if (provider.requiresApiKey && !provider.ready) text("Add API key", "添加 API 密钥")
                            else text("Not checked", "未检查"),
                            style = MaterialTheme.typography.labelSmall,
                            color = SpatialTheme.colors.textTertiary,
                        )
                    }
                    if (provider.requiresApiKey) {
                        SpatialGlassTextField(
                            value = key,
                            onValueChange = { key = it },
                            label = if (provider.secretSaved) text("Replace API key", "替换 API 密钥") else text("API key", "API 密钥"),
                            visualTransformation = PasswordVisualTransformation(),
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            SpatialPrimaryButton(
                                label = text("Save", "保存"),
                                onClick = { onSaveKey(tool, provider, key); key = "" },
                                enabled = key.isNotBlank(),
                                modifier = Modifier.weight(1f),
                            )
                            if (provider.secretSaved && !provider.selected) {
                                TextButton(onClick = { confirmRemove = true }) {
                                    Text(text("Remove key", "删除密钥"), color = SpatialTheme.colors.danger)
                                }
                            }
                            TextButton(onClick = { onCheck(tool, provider) }, enabled = provider.ready || key.isNotBlank()) {
                                Text(text("Check", "检查"))
                            }
                        }
                    }
                    provider.check?.let { check ->
                        Text(
                            check.message,
                            color = if (check.passed) MaterialTheme.colorScheme.tertiary else SpatialTheme.colors.danger,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    if (confirmRemove) {
                        AlertDialog(
                            onDismissRequest = { confirmRemove = false },
                            containerColor = SpatialTheme.colors.glassOverlay,
                            title = { Text(text("Remove API key?", "删除 API 密钥？")) },
                            text = { Text(text("The saved key for ${provider.name} will be removed from the server.", "服务器将删除 ${provider.name} 的已保存密钥。")) },
                            confirmButton = {
                                TextButton(onClick = { confirmRemove = false; onRemoveKey(tool, provider) }) {
                                    Text(text("Remove", "删除"), color = SpatialTheme.colors.danger)
                                }
                            },
                            dismissButton = {
                                TextButton(onClick = { confirmRemove = false }) { Text(text("Cancel", "取消")) }
                            },
                        )
                    }
                }
            }
        }
    }
}
