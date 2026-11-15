package com.outcomego.features

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.outcomego.android.data.AndroidNetworkDetails
import com.outcomego.android.data.AndroidNetworkStatusLoader
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialFloatingTopBar
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialGroupedSection
import com.outcomego.android.ui.designsystem.SpatialHairlineDivider
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialPrimaryButton
import com.outcomego.android.ui.designsystem.SpatialPulseOrb
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.mobile.network.ProviderSnapshot
import com.outcomego.mobile.network.ProviderState
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@Composable
fun NetworkSharingDetailsScreen(
    provider: ProviderSnapshot,
    language: AppSettings.Language,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val loader = remember(context) { AndroidNetworkStatusLoader(context) }
    var details by remember { mutableStateOf<AndroidNetworkDetails?>(null) }
    var loading by remember { mutableStateOf(true) }
    var lastError by remember { mutableStateOf<String?>(null) }
    var qualityDueAt by remember { mutableStateOf(0L) }
    val refreshScope = rememberCoroutineScope()

    suspend fun refresh(forceQuality: Boolean = false) {
        loading = details == null
        val qualityDue = forceQuality || System.currentTimeMillis() >= qualityDueAt
        runCatching { loader.load(includeQuality = qualityDue) }
            .onSuccess { next ->
                val previous = details
                details = if (!qualityDue && previous != null) {
                    next.copy(
                        latencyMs = previous.latencyMs,
                        downloadMbps = previous.downloadMbps,
                        uploadMbps = previous.uploadMbps,
                    )
                } else {
                    qualityDueAt = System.currentTimeMillis() + 60_000
                    next
                }
                lastError = next.error
            }
            .onFailure { lastError = it.message ?: textFor(language, "Could not load network details.", "无法加载网络详情。") }
        loading = false
    }

    LaunchedEffect(provider.state) {
        refresh(forceQuality = true)
        while (isActive) {
            delay(5_000)
            refresh()
        }
    }

    val title = textFor(language, "Cloud computer egress", "云端电脑出口")
    Column(
        Modifier
            .fillMaxSize()
            .navigationBarsPadding(),
    ) {
        SpatialFloatingTopBar(
            title = title,
            navigationIcon = {
                SpatialIconOrb(
                    icon = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = textFor(language, "Back", "返回"),
                    onClick = onBack,
                )
            },
            actions = {
                SpatialIconOrb(
                    icon = Icons.Default.Refresh,
                    contentDescription = textFor(language, "Refresh", "刷新"),
                    onClick = { refreshScope.launch { refresh(forceQuality = true) } },
                )
            },
        )
        LazyColumn(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = SpatialSpacing.md),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            contentPadding = PaddingValues(top = 8.dp, bottom = 28.dp),
        ) {
            item {
                StatusCard(
                    details = details,
                    provider = provider,
                    language = language,
                    loading = loading,
                )
            }
            item {
                DetailCard(
                    title = textFor(language, "Proxy egress", "代理出口"),
                    rows = listOf(
                        textFor(language, "Address", "地址") to (details?.egressIp ?: "—"),
                        textFor(language, "Location", "位置") to (details?.egressLocation ?: "—"),
                        textFor(language, "Active streams", "活动连接") to (details?.activeConnections?.toString() ?: "—"),
                    ),
                )
            }
            item {
                DetailCard(
                    title = textFor(language, "Traffic", "流量"),
                    rows = listOf(
                        textFor(language, "Sent", "发送") to trafficValue(details, details?.bytesSent ?: 0),
                        textFor(language, "Received", "接收") to trafficValue(details, details?.bytesReceived ?: 0),
                    ),
                )
            }
            item {
                DetailCard(
                    title = textFor(language, "Speed", "速度"),
                    rows = listOf(
                        textFor(language, "Latency", "延迟") to (details?.latencyMs?.let { "$it ms" } ?: "—"),
                        textFor(language, "Download", "下载") to (details?.downloadMbps?.let { "%.1f Mbps".format(it) } ?: "—"),
                        textFor(language, "Upload", "上传") to (details?.uploadMbps?.let { "%.1f Mbps".format(it) } ?: "—"),
                    ),
                )
            }
            details?.let { current ->
                networkErrorText(current, language)?.let { message ->
                    item {
                        SpatialGlassSurface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(SpatialRadii.sm),
                            tier = GlassTier.Subtle,
                            shadowElevation = 0.dp,
                        ) {
                            Column(
                                Modifier.padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Text(message, color = SpatialTheme.colors.danger, fontSize = 13.sp)
                                if (current.routeSelectedToThisPhone && !current.egressAvailable) {
                                    Text(
                                        textFor(
                                            language,
                                            "Switch the phone to Wi-Fi or mobile data with internet access, then refresh.",
                                            "请将手机切换到可以访问互联网的 Wi-Fi 或移动数据网络，然后刷新状态。",
                                        ),
                                        color = SpatialTheme.colors.textSecondary,
                                        fontSize = 13.sp,
                                    )
                                }
                            }
                        }
                    }
                }
            } ?: lastError?.takeIf(String::isNotBlank)?.let { message ->
                item { Text(message, color = SpatialTheme.colors.danger, fontSize = 13.sp) }
            }
            item {
                Spacer(Modifier.height(4.dp))
                SpatialPrimaryButton(
                    label = textFor(language, "Refresh status", "刷新状态"),
                    onClick = { refreshScope.launch { refresh(forceQuality = true) } },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun StatusCard(
    details: AndroidNetworkDetails?,
    provider: ProviderSnapshot,
    language: AppSettings.Language,
    loading: Boolean,
) {
    SpatialGroupedSection {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val active = details?.connectedToThisPhone == true || provider.state == ProviderState.READY
                val dotColor = if (active) MaterialTheme.colorScheme.tertiary else SpatialTheme.colors.accent
                if (active) {
                    SpatialPulseOrb(color = dotColor)
                } else {
                    Box(Modifier.size(8.dp))
                }
                Text(
                    textFor(language, "Connection status", "连接状态"),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = SpatialTheme.colors.textPrimary,
                )
                if (loading && details == null) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                }
            }
            SpatialHairlineDivider(insetStart = 0.dp)
            StatusLine(
                textFor(language, "This phone provider", "本机提供者"),
                providerStateLabel(provider.state, language),
            )
            StatusLine(
                textFor(language, "Cloud computer route", "云端电脑路由"),
                when {
                    details?.connectedToThisPhone == true ->
                        textFor(language, "Connected and usable", "已连接且可用")
                    details?.routeSelectedToThisPhone == true ->
                        textFor(language, "Selected, but egress unavailable", "已选择本机，但出口不可用")
                    details?.computerState == "server" -> textFor(language, "Using server connection", "正在使用服务器连接")
                    else -> details?.computerState ?: textFor(language, "Unavailable", "不可用")
                },
            )
        }
    }
}

@Composable
private fun DetailCard(title: String, rows: List<Pair<String, String>>) {
    SpatialGroupedSection {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = SpatialTheme.colors.textPrimary,
            )
            rows.forEachIndexed { index, (label, value) ->
                if (index == 0) {
                    SpatialHairlineDivider(insetStart = 0.dp)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(label, color = SpatialTheme.colors.textSecondary)
                    Text(value, color = SpatialTheme.colors.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                }
            }
        }
    }
}

@Composable
private fun StatusLine(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = SpatialTheme.colors.textSecondary)
        Text(value, fontSize = 14.sp, color = SpatialTheme.colors.textPrimary, fontWeight = FontWeight.Medium)
    }
}

private fun providerStateLabel(
    state: ProviderState,
    language: AppSettings.Language,
): String = when (state) {
    ProviderState.READY -> textFor(language, "Ready", "已就绪")
    ProviderState.ENROLLING -> textFor(language, "Registering", "注册中")
    ProviderState.CONNECTING, ProviderState.RECONNECTING -> textFor(language, "Connecting", "连接中")
    ProviderState.UNAVAILABLE -> textFor(language, "Unavailable", "不可用")
    ProviderState.REVOKED -> textFor(language, "Authorization revoked", "授权已撤销")
    ProviderState.FAILED -> textFor(language, "Needs attention", "需要处理")
    ProviderState.STOPPED -> textFor(language, "Stopped", "已停止")
}

private fun textFor(
    language: AppSettings.Language,
    english: String,
    chinese: String,
): String = if (language == AppSettings.Language.Chinese) chinese else english

private fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val units = arrayOf("KiB", "MiB", "GiB")
    var value = bytes.toDouble()
    var unit = 0
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit++
    }
    return "%.1f %s".format(value, units[unit])
}

private fun trafficValue(details: AndroidNetworkDetails?, bytes: Long): String =
    if (details?.routeSelectedToThisPhone == true && !details.egressAvailable) "—" else formatBytes(bytes)

private fun networkErrorText(
    details: AndroidNetworkDetails,
    language: AppSettings.Language,
): String? = when {
    details.egressErrorCode == "network_egress_unavailable" ->
        textFor(
            language,
            "The phone is selected, but its current network cannot reach the public internet.",
            "已选择本机，但手机当前网络无法访问公网。",
        )
    details.egressErrorCode == "network_egress_changed" ->
        textFor(
            language,
            "The network route changed while it was being checked.",
            "检查期间网络出口发生了变化。",
        )
    details.egressErrorCode == "computer_unavailable" ->
        textFor(
            language,
            "The cloud computer network worker is unavailable.",
            "云端电脑网络服务当前不可用。",
        )
    details.qualityErrorCode != null && details.egressAvailable ->
        textFor(
            language,
            "The egress is connected, but the speed test is unavailable.",
            "网络出口已连接，但速度测试暂时不可用。",
        )
    else -> details.error
}
