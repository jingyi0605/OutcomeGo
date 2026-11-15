package com.outcomego.android.ui.screens.directory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.outcomego.android.data.Conversation
import com.outcomego.android.data.SearchResult
import com.outcomego.android.data.SidebarPreferences
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialFloatingTopBar
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialGlassTextField
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialPrimaryButton
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.features.localizedText

@Composable
internal fun SidebarManagementScreen(
    sidebar: SidebarPreferences,
    hidden: List<Conversation>,
    onRename: (String, String) -> Unit,
    onDeleteSection: (String) -> Unit,
    onUnhide: (Conversation) -> Unit,
    onDeleteConversation: (Conversation) -> Unit,
    onBack: () -> Unit,
) {
    val colors = SpatialTheme.colors
    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = PaddingValues(
                top = 86.dp,
                bottom = 32.dp,
                start = SpatialSpacing.md,
                end = SpatialSpacing.md,
            ),
        ) {
            item {
                Text(
                    localizedText("Sections", "分区"),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.textPrimary,
                )
            }
            if (sidebar.sections.isEmpty()) {
                item {
                    Text(
                        localizedText("No custom sections yet.", "还没有自定义分区。"),
                        color = colors.textSecondary,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            items(sidebar.sections, key = { "section:${it.id}" }) { section ->
                var name by remember(section.id, section.name) { mutableStateOf(section.name) }
                SpatialGlassSurface(
                    tier = GlassTier.Card,
                    shape = RoundedCornerShape(SpatialRadii.lg),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        SpatialGlassTextField(
                            value = name,
                            onValueChange = { name = it },
                            label = localizedText("Section name", "分区名称"),
                            singleLine = true,
                        )
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            SpatialPrimaryButton(
                                label = localizedText("Save", "保存"),
                                onClick = { onRename(section.id, name) },
                                enabled = name.trim().isNotEmpty(),
                                modifier = Modifier.weight(1f),
                            )
                            TextButton(onClick = { onDeleteSection(section.id) }) {
                                Text(localizedText("Delete", "删除"), color = colors.danger)
                            }
                        }
                    }
                }
            }
            item {
                Spacer(Modifier.height(6.dp))
                Text(
                    localizedText("Hidden conversations", "隐藏的对话"),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.textPrimary,
                )
            }
            if (hidden.isEmpty()) {
                item {
                    Text(
                        localizedText("No hidden conversations.", "没有隐藏的对话。"),
                        color = colors.textSecondary,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            items(hidden, key = { "hidden:${it.id}" }) { conversation ->
                SpatialGlassSurface(
                    tier = GlassTier.Subtle,
                    shape = RoundedCornerShape(SpatialRadii.lg),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(conversation.title, fontWeight = FontWeight.Medium, color = colors.textPrimary)
                            Text(conversation.subtitle, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
                        }
                        TextButton(onClick = { onUnhide(conversation) }) {
                            Text(localizedText("Unhide", "取消隐藏"), color = colors.accent)
                        }
                        TextButton(onClick = { onDeleteConversation(conversation) }) {
                            Text(localizedText("Delete", "删除"), color = colors.danger)
                        }
                    }
                }
            }
        }
        SpatialFloatingTopBar(
            title = localizedText("Organize conversations", "整理对话"),
            navigationIcon = {
                SpatialIconOrb(
                    icon = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = localizedText("Back", "返回"),
                    onClick = onBack,
                )
            },
        )
    }
}

@Composable
internal fun MessageSearchScreen(
    results: List<SearchResult>,
    loading: Boolean,
    error: String?,
    conversations: List<Conversation>,
    accountName: String,
    onSearch: (String) -> Unit,
    onOpen: (SearchResult) -> Unit,
    onBack: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val colors = SpatialTheme.colors
    LaunchedEffect(query) { onSearch(query) }
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .padding(top = 74.dp, start = SpatialSpacing.md, end = SpatialSpacing.md),
        ) {
            SpatialGlassTextField(
                value = query,
                onValueChange = { query = it },
                label = localizedText("Search messages", "搜索消息"),
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                singleLine = true,
            )
            Spacer(Modifier.height(12.dp))
            if (loading) {
                Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = colors.accent)
                }
            } else if (error != null) {
                Text(error, color = colors.danger)
            } else if (query.isBlank()) {
                Text(
                    localizedText("Enter a phrase to search messages.", "输入要搜索的内容。"),
                    color = colors.textSecondary,
                )
            } else {
                SearchResultsList(
                    results = results,
                    loading = loading,
                    error = error,
                    conversations = conversations,
                    accountName = accountName,
                    onSelect = onOpen,
                )
            }
        }
        SpatialFloatingTopBar(
            title = localizedText("Find messages", "查找消息"),
            navigationIcon = {
                SpatialIconOrb(
                    icon = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = localizedText("Back", "返回"),
                    onClick = onBack,
                )
            },
        )
    }
}
