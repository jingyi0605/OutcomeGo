package com.outcomego.android.ui.screens.chat

import android.view.ViewTreeObserver
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.exclude
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imeAnimationTarget
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.outcomego.android.R
import com.outcomego.android.data.ChannelActivity
import com.outcomego.android.data.ChatHistoryPage
import com.outcomego.android.data.ChatMessage
import com.outcomego.android.data.ChatRow
import com.outcomego.android.data.Conversation
import com.outcomego.android.data.toChatRows
import com.outcomego.android.ui.ChatContextSummary
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialAmbientCanvas
import com.outcomego.android.ui.designsystem.SpatialGlassBackdropProvider
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.android.ui.designsystem.rememberSpatialGlassBackdrop
import com.outcomego.android.ui.designsystem.spatialGlassBackdropSource
import com.outcomego.android.ui.screens.directory.ConversationAvatar
import com.outcomego.features.Attachment
import com.outcomego.features.FeatureOperationState
import com.outcomego.features.HapticEffect
import com.outcomego.features.LocalAppHaptics
import com.outcomego.features.MessageAction
import com.outcomego.features.localizedText
import com.outcomego.platform.AndroidLiveVoiceSnapshot
import com.outcomego.platform.AndroidLiveVoiceState
import com.outcomego.platform.VoiceRecordingState
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ChatScreen(
    conversationId: String,
    accountName: String,
    title: String,
    messages: List<ChatMessage>,
    targetMessageId: String?,
    draft: String,
    replyingTo: ChatMessage?,
    onReply: (String) -> Unit,
    onCancelReply: () -> Unit,
    onOpenRoutine: () -> Unit,
    onOpenOutcome: (String) -> Unit = {},
    loadOutcomeStatus: suspend (String) -> String? = { null },
    error: String?,
    onBack: () -> Unit,
    onBotDetails: () -> Unit,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onRetry: (String) -> Unit,
    voiceState: VoiceRecordingState,
    onStartVoice: () -> Unit,
    onStopVoice: () -> Unit,
    onRetryVoice: () -> Unit,
    onCancelVoice: () -> Unit,
    liveVoice: AndroidLiveVoiceSnapshot,
    onStartLiveVoice: (participants: List<String>, speaker: String?) -> Unit,
    groupMembers: List<Conversation>,
    onStopLiveVoice: () -> Unit,
    onMuteLiveVoiceMicrophone: (Boolean) -> Unit,
    onMuteLiveVoiceSpeaker: (Boolean) -> Unit,
    operation: FeatureOperationState,
    pendingAttachments: List<Attachment>,
    hasMoreHistory: Boolean,
    historyLoading: Boolean,
    conversations: List<Conversation>,
    onLoadOlder: () -> Unit,
    onUpload: (String) -> Unit,
    onRemoveAttachment: (String) -> Unit,
    onDownload: (String, Attachment) -> Unit,
    onSaveAttachment: (String, Attachment) -> Unit,
    onShareAttachment: (Attachment) -> Unit,
    onForwardAttachment: (Attachment, String) -> Unit,
    onAction: (String, String, Map<String, String>) -> Unit,
    onReaction: (String, String) -> Unit,
    onMessageAction: (String, MessageAction) -> Unit,
    onContext: (String) -> Unit,
    threadContext: List<ChatMessage>,
    threadContextTruncated: Boolean,
    activity: ChannelActivity? = null,
    bot: Conversation? = null,
) {
    val listState = rememberLazyListState()
    var forwardingAttachment by remember { mutableStateOf<Attachment?>(null) }
    val attachmentPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { onUpload(it.toString()) }
    }
    val contextRows = remember(threadContext) { threadContext.take(ChatHistoryPage.DEFAULT_CONTEXT_LIMIT) }
    val chatRows = remember(messages, bot?.isBot) {
        messages.toChatRows(collapseAgentExchanges = bot?.isBot == true)
    }
    var openedAgentExchange by remember(conversationId) { mutableStateOf<ChatRow.AgentExchange?>(null) }
    var focusedAgentMessageId by remember(conversationId) { mutableStateOf<String?>(null) }
    var hasPositionedInitialMessages by remember(conversationId) { mutableStateOf(false) }
    val lastItemIndex = (if (hasMoreHistory) 1 else 0) + (if (contextRows.isNotEmpty()) 1 else 0) + chatRows.size + 1
    val currentLastItemIndex by rememberUpdatedState(lastItemIndex)
    val currentTargetMessageId by rememberUpdatedState(targetMessageId)
    val bottomThresholdPx = with(LocalDensity.current) { 48.dp.toPx() }
    var followBottom by remember(conversationId) { mutableStateOf(true) }
    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress }.collect { scrolling ->
            if (!scrolling) followBottom = listState.isNearBottom(bottomThresholdPx)
        }
    }
    var lastScrolledId by remember(conversationId) { mutableStateOf<String?>(null) }
    val newest = messages.lastOrNull()
    LaunchedEffect(conversationId, historyLoading, targetMessageId, messages.size, newest, activity) {
        if (historyLoading || messages.isEmpty()) return@LaunchedEffect
        val targetIndex = targetMessageId?.let { id -> chatRows.indexOfFirst { it.contains(id) } }?.takeIf { it >= 0 }
        if (targetIndex != null) {
            val targetRow = chatRows[targetIndex]
            if (targetRow is ChatRow.AgentExchange) {
                openedAgentExchange = targetRow
                focusedAgentMessageId = targetMessageId
            }
            listState.scrollToItem(targetIndex + if (contextRows.isNotEmpty()) 1 else 0)
            hasPositionedInitialMessages = true
            return@LaunchedEffect
        }
        val isNewMessage = newest?.id != lastScrolledId
        lastScrolledId = newest?.id
        when {
            !hasPositionedInitialMessages -> {
                listState.scrollToItem(lastItemIndex)
                hasPositionedInitialMessages = true
                followBottom = true
            }
            followBottom || (isNewMessage && newest?.isMine == true) -> {
                if (isNewMessage || activity != null) listState.animateScrollToItem(lastItemIndex)
                else listState.scrollToItem(lastItemIndex)
                followBottom = true
            }
        }
    }
    LaunchedEffect(listState) {
        var previousHeight = listState.layoutInfo.viewportSize.height
        snapshotFlow { listState.layoutInfo.viewportSize.height }.drop(1).collect { height ->
            val shrunk = height < previousHeight
            previousHeight = height
            if (shrunk && followBottom && hasPositionedInitialMessages && currentTargetMessageId == null) {
                listState.requestScrollToItem(currentLastItemIndex)
            }
        }
    }
    var jumpToMessageId by remember(conversationId) { mutableStateOf<String?>(null) }
    var highlightedMessageId by remember(conversationId) { mutableStateOf<String?>(null) }
    LaunchedEffect(jumpToMessageId, chatRows) {
        val id = jumpToMessageId ?: return@LaunchedEffect
        val index = chatRows.indexOfFirst { it.contains(id) }
        if (index < 0) return@LaunchedEffect
        val targetRow = chatRows[index]
        if (targetRow is ChatRow.AgentExchange) {
            openedAgentExchange = targetRow
            focusedAgentMessageId = id
        }
        listState.animateScrollToItem(index + if (contextRows.isNotEmpty()) 1 else 0)
        jumpToMessageId = null
        highlightedMessageId = id
        delay(1500)
        if (highlightedMessageId == id) highlightedMessageId = null
    }
    val colors = SpatialTheme.colors
    forwardingAttachment?.let { attachment ->
        AlertDialog(
            onDismissRequest = { forwardingAttachment = null },
            containerColor = colors.glassOverlay,
            title = { Text(stringResource(R.string.chat_forward), color = colors.textPrimary) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        "${stringResource(R.string.chat_forward)}: ${attachment.name}",
                        color = colors.textSecondary,
                    )
                    conversations.forEach { conversation ->
                        TextButton(
                            onClick = {
                                onForwardAttachment(attachment, conversation.id)
                                forwardingAttachment = null
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(conversation.title, textAlign = TextAlign.Start, color = colors.textPrimary)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { forwardingAttachment = null }) {
                    Text(stringResource(R.string.login_cancel), color = colors.accent)
                }
            },
        )
    }
    val haptic = LocalAppHaptics.current
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val composerFocusRequester = remember { FocusRequester() }
    val composerFocusedState = remember(conversationId) { mutableStateOf(false) }
    val onForwardAttachmentMemo = remember<(Attachment) -> Unit> { { forwardingAttachment = it } }
    val onJumpToMessage = remember<(String) -> Unit> { { jumpToMessageId = it } }
    val onAttach = remember(attachmentPicker) { { attachmentPicker.launch(arrayOf("*/*")) } }
    val onDismissComposerFocus = remember<() -> Unit>(focusManager, keyboardController) {
        {
            composerFocusedState.value = false
            focusManager.clearFocus()
            keyboardController?.hide()
        }
    }
    ImeCollapseObserver(
        conversationId = conversationId,
        composerFocusedState = composerFocusedState,
        onClearFocus = { focusManager.clearFocus() },
    )
    val density = LocalDensity.current
    val imeInsets = WindowInsets.ime.exclude(WindowInsets.navigationBars)
    val imeTargetInsets = WindowInsets.imeAnimationTarget.exclude(WindowInsets.navigationBars)
    var settledImePx by remember(conversationId) { mutableIntStateOf(0) }
    val currentFollowBottom by rememberUpdatedState(followBottom)
    LaunchedEffect(conversationId, imeInsets, imeTargetInsets, density) {
        snapshotFlow {
            imeInsets.getBottom(density) to imeTargetInsets.getBottom(density)
        }.collect { (livePx, targetPx) ->
            when {
                targetPx < settledImePx -> {
                    settledImePx = targetPx
                }
                livePx == targetPx && targetPx > settledImePx -> {
                    if (currentFollowBottom && hasPositionedInitialMessages && currentTargetMessageId == null) {
                        listState.requestScrollToItem(currentLastItemIndex)
                    }
                    settledImePx = targetPx
                }
            }
        }
    }
    var pickingVoiceMembers by remember { mutableStateOf(false) }
    if (pickingVoiceMembers) {
        VoiceMemberPickerDialog(
            members = groupMembers,
            onDismiss = { pickingVoiceMembers = false },
            onStart = { participants, speaker ->
                pickingVoiceMembers = false
                onStartLiveVoice(participants, speaker)
            },
        )
    }

    val backdrop = rememberSpatialGlassBackdrop()

    Box(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .spatialGlassBackdropSource(backdrop),
        ) {
            SpatialAmbientCanvas(modifier = Modifier.fillMaxSize()) {}
        }

        SpatialGlassBackdropProvider(backdrop) {
            Column(modifier = Modifier.fillMaxSize()) {
        // Floating glass header pill bar placed above the message viewport so message list touch
        // coordinates (including top-left tap-to-dismiss-focus) stay completely unobstructed.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.xs),
        ) {
            SpatialIconOrb(
                icon = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = localizedText("Back to conversations", "返回对话列表"),
                onClick = onBack,
                testTag = "back-to-conversations",
            )
            SpatialGlassSurface(
                tier = GlassTier.Floating,
                shape = CircleShape,
                shadowElevation = 6.dp,
                onClick = onBotDetails,
                modifier = Modifier.weight(1f),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (bot != null) {
                        ConversationAvatar(
                            conversation = bot,
                            accountName = accountName,
                            members = groupMembers,
                            size = 28.dp,
                            showWorking = true,
                            ringColor = colors.canvasElevated,
                        )
                        Spacer(Modifier.width(10.dp))
                    }
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (bot?.isBot == true || (bot?.isGroup == true && groupMembers.isNotEmpty())) {
                val activeVoice = liveVoice.state != AndroidLiveVoiceState.Idle
                SpatialIconOrb(
                    icon = Icons.Default.Call,
                    contentDescription = localizedText(
                        if (!activeVoice) "Start realtime voice" else "End realtime voice",
                        if (!activeVoice) "开始实时语音" else "结束实时语音",
                    ),
                    onClick = {
                        haptic.play(HapticEffect.Medium)
                        if (activeVoice) onStopLiveVoice()
                        else if (bot?.isGroup == true) pickingVoiceMembers = true
                        else onStartLiveVoice(emptyList(), null)
                    },
                    enabled = liveVoice.state != AndroidLiveVoiceState.Connecting,
                    tint = if (activeVoice) colors.onAccent else colors.textPrimary,
                    containerColor = if (activeVoice) colors.accent else null,
                    testTag = "live-voice-header",
                )
            }
            SpatialIconOrb(
                icon = Icons.Default.Info,
                contentDescription = stringResource(R.string.chat_bot_details),
                onClick = onBotDetails,
                testTag = "bot-details",
            )
        }

        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .clipToBounds(),
        ) {
            ChatMessageList(
                modifier = Modifier
                    .fillMaxSize()
                    .windowInsetsPadding(WindowInsets.navigationBars.only(WindowInsetsSides.Horizontal))
                    .graphicsLayer {
                        val offsetPx = (imeInsets.getBottom(this) - settledImePx).coerceAtLeast(0)
                        if (offsetPx == 0 || !currentFollowBottom) {
                            translationY = 0f
                        } else {
                            val layoutInfo = listState.layoutInfo
                            val lastItemBottom = layoutInfo.visibleItemsInfo.lastOrNull()?.let { it.offset + it.size } ?: 0
                            val emptyBelow = (layoutInfo.viewportSize.height - lastItemBottom).coerceAtLeast(0)
                            translationY = -(offsetPx - emptyBelow).coerceAtLeast(0).toFloat()
                        }
                    },
                listState = listState,
                hasMoreHistory = hasMoreHistory,
                historyLoading = historyLoading,
                onLoadOlder = onLoadOlder,
                contextRows = contextRows,
                threadContextTruncated = threadContextTruncated,
                threadContextCount = threadContext.size,
                chatRows = chatRows,
                messages = messages,
                targetMessageId = targetMessageId,
                highlightedMessageId = highlightedMessageId,
                operation = operation,
                activity = activity,
                bot = bot,
                accountName = accountName,
                groupMembers = groupMembers,
                onRetry = onRetry,
                onDownload = onDownload,
                onSaveAttachment = onSaveAttachment,
                onShareAttachment = onShareAttachment,
                onForwardAttachment = onForwardAttachmentMemo,
                onAction = onAction,
                onReaction = onReaction,
                onMessageAction = onMessageAction,
                onContext = onContext,
                onReply = onReply,
                onOpenRoutine = onOpenRoutine,
                onOpenOutcome = onOpenOutcome,
                loadOutcomeStatus = loadOutcomeStatus,
                onJumpToMessage = onJumpToMessage,
                composerFocusedState = composerFocusedState,
                onDismissComposerFocus = onDismissComposerFocus,
                conversations = conversations,
                onOpenAgentExchange = { exchange ->
                    openedAgentExchange = exchange
                    focusedAgentMessageId = null
                },
            )
        }

        openedAgentExchange?.let { exchange ->
            AgentExchangeWindow(
                exchange = exchange,
                sourceBot = bot,
                peerBot = conversations.firstOrNull { it.botId == exchange.peerId },
                accountName = accountName,
                members = groupMembers,
                focusedMessageId = focusedAgentMessageId,
                onDismiss = {
                    openedAgentExchange = null
                    focusedAgentMessageId = null
                },
            )
        }

        ChatBottomBar(
            modifier = Modifier
                .zIndex(1f)
                .graphicsLayer {
                    translationY = -(imeInsets.getBottom(this) - settledImePx).coerceAtLeast(0).toFloat()
                },
            error = error,
            voiceState = voiceState,
            onStopVoice = onStopVoice,
            onCancelVoice = onCancelVoice,
            onRetryVoice = onRetryVoice,
            replyingTo = replyingTo,
            onCancelReply = onCancelReply,
            pendingAttachments = pendingAttachments,
            onRemoveAttachment = onRemoveAttachment,
            draft = draft,
            onDraftChange = onDraftChange,
            onAttach = onAttach,
            onStartVoice = onStartVoice,
            onSend = onSend,
            composerFocusedState = composerFocusedState,
            composerFocusRequester = composerFocusRequester,
            operation = operation,
        )
        if (settledImePx > 0) {
            Spacer(
                Modifier
                    .fillMaxWidth()
                    .height(with(density) { settledImePx.toDp() }),
            )
        }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ImeCollapseObserver(
    conversationId: String,
    composerFocusedState: MutableState<Boolean>,
    onClearFocus: () -> Unit,
) {
    val view = LocalView.current
    val composeImeVisible = WindowInsets.isImeVisible
    var wasImeVisible by remember(conversationId) { mutableStateOf(false) }
    val currentOnClearFocus by rememberUpdatedState(onClearFocus)

    LaunchedEffect(composeImeVisible) {
        if (composeImeVisible) {
            wasImeVisible = true
        } else if (wasImeVisible) {
            wasImeVisible = false
            if (composerFocusedState.value) {
                composerFocusedState.value = false
                currentOnClearFocus()
            }
        }
    }

    DisposableEffect(view, conversationId) {
        if (ViewCompat.getRootWindowInsets(view)?.isVisible(WindowInsetsCompat.Type.ime()) == true) {
            wasImeVisible = true
        }
        val listener = ViewTreeObserver.OnGlobalLayoutListener {
            if (!composerFocusedState.value && !wasImeVisible) return@OnGlobalLayoutListener
            val imeVisible = ViewCompat.getRootWindowInsets(view)
                ?.isVisible(WindowInsetsCompat.Type.ime()) == true
            if (imeVisible) {
                wasImeVisible = true
            } else if (wasImeVisible) {
                wasImeVisible = false
                if (composerFocusedState.value) {
                    composerFocusedState.value = false
                    view.post { currentOnClearFocus() }
                }
            }
        }
        view.viewTreeObserver.addOnGlobalLayoutListener(listener)
        onDispose {
            view.viewTreeObserver.removeOnGlobalLayoutListener(listener)
        }
    }
}

@Composable
private fun ChatMessageList(
    modifier: Modifier,
    listState: LazyListState,
    hasMoreHistory: Boolean,
    historyLoading: Boolean,
    onLoadOlder: () -> Unit,
    contextRows: List<ChatMessage>,
    threadContextTruncated: Boolean,
    threadContextCount: Int,
    chatRows: List<ChatRow>,
    messages: List<ChatMessage>,
    targetMessageId: String?,
    highlightedMessageId: String?,
    operation: FeatureOperationState,
    activity: ChannelActivity?,
    bot: Conversation?,
    accountName: String,
    groupMembers: List<Conversation>,
    onRetry: (String) -> Unit,
    onDownload: (String, Attachment) -> Unit,
    onSaveAttachment: (String, Attachment) -> Unit,
    onShareAttachment: (Attachment) -> Unit,
    onForwardAttachment: (Attachment) -> Unit,
    onAction: (String, String, Map<String, String>) -> Unit,
    onReaction: (String, String) -> Unit,
    onMessageAction: (String, MessageAction) -> Unit,
    onContext: (String) -> Unit,
    onReply: (String) -> Unit,
    onOpenRoutine: () -> Unit,
    onOpenOutcome: (String) -> Unit = {},
    loadOutcomeStatus: suspend (String) -> String? = { null },
    onJumpToMessage: (String) -> Unit,
    composerFocusedState: State<Boolean>,
    onDismissComposerFocus: () -> Unit,
    conversations: List<Conversation>,
    onOpenAgentExchange: (ChatRow.AgentExchange) -> Unit,
) {
    val messagesById = remember(messages) { messages.associateBy(ChatMessage::id) }
    val currentMessages by rememberUpdatedState(messages)
    val currentDismissFocus by rememberUpdatedState(onDismissComposerFocus)
    val onOpenOriginal = remember(onContext, onJumpToMessage) {
        { id: String ->
            if (currentMessages.none { it.id == id }) onContext(id)
            onJumpToMessage(id)
        }
    }
    LazyColumn(
        state = listState,
        modifier = modifier
            .padding(horizontal = SpatialSpacing.md)
            .testTag("chat-message-list")
            .pointerInput(composerFocusedState) {
                val touchSlop = viewConfiguration.touchSlop
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    if (!composerFocusedState.value) return@awaitEachGesture
                    val up = waitForUpOrCancellation()
                    if (up != null && !up.isConsumed && (up.position - down.position).getDistance() < touchSlop) {
                        currentDismissFocus()
                    }
                }
            },
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (hasMoreHistory) {
            item(key = "load-older") {
                TextButton(
                    onClick = onLoadOlder,
                    enabled = !historyLoading,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("load-older-messages"),
                ) {
                    if (historyLoading) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    } else {
                        Text(
                            stringResource(R.string.chat_load_older),
                            color = SpatialTheme.colors.textSecondary,
                        )
                    }
                }
            }
        }
        if (contextRows.isNotEmpty()) {
            item(key = "thread-context") {
                ChatContextSummary(contextRows, threadContextTruncated || threadContextCount > contextRows.size)
            }
        }
        items(chatRows, key = ChatRow::key) { row ->
            when (row) {
                is ChatRow.Voice -> VoiceConversationCard(row.messages, bot?.title ?: "Assistant")
                is ChatRow.AgentExchange -> {
                    AgentExchangeRow(
                        count = row.messages.size,
                        incoming = row.incoming,
                        peerName = row.peerName,
                        peerBot = conversations.firstOrNull { it.botId == row.peerId },
                        accountName = accountName,
                        members = groupMembers,
                        onClick = { onOpenAgentExchange(row) },
                    )
                }
                is ChatRow.Single -> {
                    val message = row.message
                    MessageBubble(
                        message = message,
                        onRetry = onRetry,
                        isTarget = message.id == targetMessageId || message.id == highlightedMessageId,
                        operation = operation,
                        onDownload = onDownload,
                        onSaveAttachment = onSaveAttachment,
                        onShareAttachment = onShareAttachment,
                        onForwardAttachment = onForwardAttachment,
                        onAction = onAction,
                        onReaction = onReaction,
                        onMessageAction = onMessageAction,
                        onContext = onContext,
                        onReply = onReply,
                        onOpenRoutine = onOpenRoutine,
                        onOpenOutcome = onOpenOutcome,
                        loadOutcomeStatus = loadOutcomeStatus,
                        replyOriginal = message.replyToMessageId?.let(messagesById::get),
                        onOpenOriginal = onOpenOriginal,
                    )
                }
            }
        }
        item(key = "bot-activity") {
            BotActivityRow(
                activity = activity,
                bot = bot,
                accountName = accountName,
                members = groupMembers,
            )
        }
        item { Spacer(Modifier.height(6.dp)) }
    }
}

private fun LazyListState.isNearBottom(thresholdPx: Float): Boolean {
    val info = layoutInfo
    val last = info.visibleItemsInfo.lastOrNull() ?: return true
    return last.index >= info.totalItemsCount - 1 &&
        last.offset + last.size - info.viewportEndOffset <= thresholdPx
}
