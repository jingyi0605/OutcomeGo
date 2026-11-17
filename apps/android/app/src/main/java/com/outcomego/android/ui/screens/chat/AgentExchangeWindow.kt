package com.outcomego.android.ui.screens.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.outcomego.android.data.ChatMessage
import com.outcomego.android.data.ChatRow
import com.outcomego.android.data.Conversation
import com.outcomego.android.data.agentExchange
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialAmbientCanvas
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.android.ui.screens.directory.ConversationAvatar
import com.outcomego.features.MarkdownMessage
import com.outcomego.features.localizedText

@Composable
internal fun AgentExchangeWindow(
    exchange: ChatRow.AgentExchange,
    sourceBot: Conversation?,
    peerBot: Conversation?,
    accountName: String,
    members: List<Conversation>,
    focusedMessageId: String?,
    onDismiss: () -> Unit,
) {
    val listState = rememberLazyListState()
    LaunchedEffect(exchange.key, focusedMessageId) {
        val target = focusedMessageId?.let { id ->
            exchange.messages.indexOfFirst { it.id == id }.takeIf { it >= 0 }
        }
        listState.scrollToItem(target ?: exchange.messages.lastIndex.coerceAtLeast(0))
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        SpatialAmbientCanvas(
            modifier = Modifier
                .fillMaxSize()
                .testTag("agent-exchange-window"),
        ) {
            Column(Modifier.fillMaxSize()) {
                AgentExchangeHeader(
                    sourceBot = sourceBot,
                    peerBot = peerBot,
                    accountName = accountName,
                    members = members,
                    onDismiss = onDismiss,
                )
                LazyColumn(
                    state = listState,
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .padding(horizontal = SpatialSpacing.md),
                    contentPadding = PaddingValues(top = 12.dp, bottom = 18.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    items(exchange.messages, key = ChatMessage::id) { message ->
                        ReadOnlyAgentMessage(
                            message = message,
                            sourceBot = sourceBot,
                            peerBot = peerBot,
                            accountName = accountName,
                            members = members,
                            isFocused = message.id == focusedMessageId,
                        )
                    }
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(bottom = 8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    SpatialGlassSurface(
                        tier = GlassTier.Floating,
                        shape = RoundedCornerShape(SpatialRadii.pill),
                        modifier = Modifier.testTag("agent-exchange-read-only"),
                    ) {
                        Row(
                            Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(7.dp),
                        ) {
                            Icon(
                                Icons.Default.Lock,
                                contentDescription = null,
                                tint = SpatialTheme.colors.textSecondary,
                                modifier = Modifier.size(17.dp),
                            )
                            Text(
                                localizedText("Read-only", "只读"),
                                style = MaterialTheme.typography.labelLarge,
                                color = SpatialTheme.colors.textSecondary,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AgentExchangeHeader(
    sourceBot: Conversation?,
    peerBot: Conversation?,
    accountName: String,
    members: List<Conversation>,
    onDismiss: () -> Unit,
) {
    val colors = SpatialTheme.colors
    val title = when {
        sourceBot != null && peerBot != null -> "${sourceBot.title} ↔ ${peerBot.title}"
        peerBot != null -> peerBot.title
        sourceBot != null -> sourceBot.title
        else -> localizedText("Bot exchange", "机器人对话")
    }
    Row(
        Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
    ) {
        SpatialIconOrb(
            icon = Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = localizedText("Back to conversation", "返回对话"),
            onClick = onDismiss,
            testTag = "agent-exchange-back",
        )
        SpatialGlassSurface(
            tier = GlassTier.Floating,
            shape = RoundedCornerShape(SpatialRadii.pill),
            shadowElevation = 6.dp,
            modifier = Modifier.weight(1f),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AgentExchangeAvatarPair(
                    sourceBot = sourceBot,
                    peerBot = peerBot,
                    accountName = accountName,
                    members = members,
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        SpatialIconOrb(
            icon = Icons.Default.Close,
            contentDescription = localizedText("Close exchange", "关闭对话"),
            onClick = onDismiss,
            testTag = "agent-exchange-close",
        )
    }
}

@Composable
private fun AgentExchangeAvatarPair(
    sourceBot: Conversation?,
    peerBot: Conversation?,
    accountName: String,
    members: List<Conversation>,
) {
    Box(Modifier.size(width = 48.dp, height = 32.dp)) {
        peerBot?.let {
            Box(Modifier.align(Alignment.CenterEnd)) {
                ConversationAvatar(
                    conversation = it,
                    accountName = accountName,
                    members = members,
                    size = 30.dp,
                    ringColor = SpatialTheme.colors.canvasBase,
                )
            }
        }
        sourceBot?.let {
            Box(Modifier.align(Alignment.CenterStart)) {
                ConversationAvatar(
                    conversation = it,
                    accountName = accountName,
                    members = members,
                    size = 30.dp,
                    ringColor = SpatialTheme.colors.canvasBase,
                )
            }
        }
    }
}

@Composable
private fun ReadOnlyAgentMessage(
    message: ChatMessage,
    sourceBot: Conversation?,
    peerBot: Conversation?,
    accountName: String,
    members: List<Conversation>,
    isFocused: Boolean,
) {
    val colors = SpatialTheme.colors
    val speaker = when (message.agentExchange?.incoming) {
        true -> peerBot
        false -> sourceBot
        null -> null
    }
    Row(
        Modifier
            .fillMaxWidth()
            .testTag("agent-exchange-message-${message.id}"),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (speaker != null) {
            ConversationAvatar(
                conversation = speaker,
                accountName = accountName,
                members = members,
                size = 30.dp,
                ringColor = colors.canvasBase,
            )
        } else {
            Spacer(Modifier.size(30.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(
                message.author,
                Modifier.padding(start = 6.dp, bottom = 4.dp),
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                color = colors.textSecondary,
            )
            SpatialGlassSurface(
                tier = GlassTier.Card,
                shape = RoundedCornerShape(20.dp),
                borderWidth = if (isFocused) 1.2.dp else 0.65.dp,
                containerColor = if (isFocused) {
                    colors.accent.copy(alpha = 0.10f)
                } else {
                    colors.assistantSurface
                },
            ) {
                MarkdownMessage(
                    markdown = message.displayBody ?: localizedText("No message text", "没有消息内容"),
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    contentColor = colors.textPrimary,
                    containerColor = if (isFocused) {
                        colors.accent.copy(alpha = 0.10f)
                    } else {
                        colors.assistantSurface
                    },
                )
            }
        }
    }
}
