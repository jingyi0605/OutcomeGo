@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package com.outcomego.android.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NamedNavArgument
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.outcomego.android.AppViewModel
import com.outcomego.android.R
import com.outcomego.android.data.ChatMessage
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialAmbientCanvas
import com.outcomego.android.ui.designsystem.SpatialGlassBackdropProvider
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.rememberSpatialGlassBackdrop
import com.outcomego.android.ui.designsystem.spatialGlassBackdropSource
import com.outcomego.android.ui.designsystem.SpatialMotion.spatialDrawerBackdropExit
import com.outcomego.android.ui.designsystem.SpatialMotion.spatialDrawerBackdropPopEnter
import com.outcomego.android.ui.designsystem.SpatialMotion.spatialDrawerEnter
import com.outcomego.android.ui.designsystem.SpatialMotion.spatialDrawerExit
import com.outcomego.android.ui.designsystem.SpatialMotion.spatialPopEnter
import com.outcomego.android.ui.designsystem.SpatialMotion.spatialPopExit
import com.outcomego.android.ui.designsystem.SpatialMotion.spatialPushEnter
import com.outcomego.android.ui.designsystem.SpatialMotion.spatialPushExit
import com.outcomego.android.ui.designsystem.SpatialRadii
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.android.ui.screens.auth.SignInScreen
import com.outcomego.android.ui.screens.chat.ChatScreen
import com.outcomego.android.ui.screens.details.BotDetailsScreen
import com.outcomego.android.ui.screens.details.BotLibraryScreen
import com.outcomego.android.ui.screens.details.ComputerViewerScreen
import com.outcomego.android.ui.screens.details.ConversationProfileScreen
import com.outcomego.android.ui.screens.details.CreateConversationScreen
import com.outcomego.android.ui.screens.details.MarketplaceScreen
import com.outcomego.android.ui.screens.directory.DirectoryScreen
import com.outcomego.android.ui.screens.directory.MessageSearchScreen
import com.outcomego.android.ui.screens.directory.SidebarManagementScreen
import com.outcomego.android.ui.screens.system.OutboxScreen
import com.outcomego.android.ui.screens.system.ShareTargetScreen
import com.outcomego.features.AccountMemoryScreen
import com.outcomego.features.AndroidHaptics
import com.outcomego.features.AppSettings
import com.outcomego.features.FeatureLoadState
import com.outcomego.features.FeatureOperationState
import com.outcomego.features.HapticEffect
import com.outcomego.features.HapticPolicy
import com.outcomego.features.LiveVoiceView
import com.outcomego.features.LocalAppHaptics
import com.outcomego.features.LocalAppLanguage
import com.outcomego.features.NetworkSharingDetailsScreen
import com.outcomego.features.PluginsScreen
import com.outcomego.features.ProviderSettingsScreen
import com.outcomego.features.Routine
import com.outcomego.features.RoutineEditorScreen
import com.outcomego.features.RoutinesScreen
import com.outcomego.features.SettingsScreen
import com.outcomego.features.VoiceSettingsScreen
import com.outcomego.features.WebProviderSettingsScreen
import com.outcomego.features.localizedText
import com.outcomego.platform.AndroidLiveVoiceState
import com.outcomego.platform.AndroidNetworkProvider
import com.outcomego.platform.AndroidUpdateState
import com.outcomego.platform.NativeAttachmentPreview
import com.outcomego.platform.SharePayload

private const val LOGIN = "login"
private const val DIRECTORY = "directory"
private const val CHAT = "chat/{conversationId}"
private const val BOT_DETAILS = "bot/{conversationId}/details"
private const val BOT_LIBRARY = "bot/{conversationId}/library"
private const val PROFILE = "conversation/{conversationId}/profile"
private const val CREATE = "conversation/create"
private const val COMPUTER = "bot/{conversationId}/computer"
private const val MARKETPLACE = "marketplace"
private const val ROUTINES = "routines"
private const val ROUTINE_EDITOR = "routines/editor"
private const val SETTINGS = "settings"
private const val NETWORK_SHARING_DETAILS = "network-sharing-details"
private const val PROVIDERS = "providers"
private const val WEB_PROVIDERS = "web-providers"
private const val REALTIME_VOICE = "realtime-voice"
private const val PLUGINS = "plugins"
private const val OUTBOX = "outbox"
private const val SHARE = "share"
private const val ACCOUNT = "account"
private const val SIDEBAR = "sidebar"
private const val MESSAGE_SEARCH = "message-search"

private fun liveVoicePermissionRequest(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
        arrayOf(Manifest.permission.RECORD_AUDIO)
    }

private fun AnimatedContentTransitionScope<NavBackStackEntry>.isSettingsOpening() =
    initialState.destination.route == DIRECTORY && targetState.destination.route == SETTINGS

private fun AnimatedContentTransitionScope<NavBackStackEntry>.isSettingsClosing() =
    initialState.destination.route == SETTINGS && targetState.destination.route == DIRECTORY

private fun NavGraphBuilder.spatialComposable(
    route: String,
    arguments: List<NamedNavArgument> = emptyList(),
    content: @Composable (NavBackStackEntry) -> Unit,
) {
    composable(route = route, arguments = arguments) { entry ->
        SpatialAmbientCanvas(modifier = Modifier.fillMaxSize()) {
            content(entry)
        }
    }
}

@Composable
fun OutcomeGoApp(
    appViewModel: AppViewModel = viewModel(),
    androidUpdateState: AndroidUpdateState = AndroidUpdateState.Idle,
    onCheckForAndroidUpdate: () -> Unit = {},
    onDownloadAndroidUpdate: () -> Unit = {},
    onInstallAndroidUpdate: () -> Unit = {},
    androidUpdateChannel: String = "stable",
    onSetAndroidUpdateChannel: (String) -> Unit = {},
) {
    val state by appViewModel.state.collectAsStateWithLifecycle()
    val networkSharing by AndroidNetworkProvider.snapshot.collectAsStateWithLifecycle()
    val voiceState by appViewModel.voiceState.collectAsStateWithLifecycle()
    val navController = rememberNavController()
    val context = LocalContext.current
    val microphonePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) appViewModel.startVoice()
    }
    var pendingLiveVoiceConversationId by remember { mutableStateOf<String?>(null) }
    var pendingLiveVoiceMembers by remember { mutableStateOf<Pair<List<String>, String?>>(emptyList<String>() to null) }
    val liveVoicePermissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
        val conversationId = pendingLiveVoiceConversationId
        val (members, speaker) = pendingLiveVoiceMembers
        pendingLiveVoiceConversationId = null
        pendingLiveVoiceMembers = emptyList<String>() to null
        if (results[Manifest.permission.RECORD_AUDIO] == true && conversationId != null) {
            appViewModel.startLiveVoice(conversationId, members, speaker)
        }
    }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    val view = LocalView.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val haptics = remember(view, context, lifecycleOwner) {
        AndroidHaptics(
            view = view,
            enabled = { HapticPolicy.isEnabled(context) },
            active = { lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) },
        )
    }
    val failedMessages = state.messages.count { it.delivery == com.outcomego.android.data.Delivery.FAILED }
    var seenFailedMessages by remember { mutableStateOf(failedMessages) }
    LaunchedEffect(failedMessages) {
        if (failedMessages > seenFailedMessages) haptics.play(HapticEffect.Error)
        seenFailedMessages = failedMessages
    }
    var wasLoading by remember { mutableStateOf(false) }
    LaunchedEffect(state.loading) {
        if (wasLoading && !state.loading) {
            haptics.play(if (state.session != null) HapticEffect.Success else HapticEffect.Error)
        }
        wasLoading = state.loading
    }
    val operation = state.features.operation
    LaunchedEffect(operation) {
        if (operation is FeatureOperationState.Failed) haptics.play(HapticEffect.Error)
    }

    LaunchedEffect(state.session) {
        if (
            state.session != null &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    LaunchedEffect(state.pendingExternalUrl) {
        state.pendingExternalUrl?.let { url ->
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            appViewModel.consumeExternalUrl()
        }
    }

    val shareActionLabel = if (state.features.settings.language == AppSettings.Language.Chinese) "分享" else "Share"
    LaunchedEffect(state.pendingOutgoingShare) {
        state.pendingOutgoingShare?.let { share ->
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = share.mimeType.ifBlank { "application/octet-stream" }
                putExtra(Intent.EXTRA_STREAM, NativeAttachmentPreview.contentUri(context, share.uri))
                putExtra(Intent.EXTRA_TEXT, share.fileName)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(Intent.createChooser(intent, "$shareActionLabel ${share.fileName}"))
            appViewModel.consumeOutgoingShare()
        }
    }

    LaunchedEffect(state.pendingLink, state.pendingVoiceShortcut, state.session) {
        if (state.session == null) return@LaunchedEffect
        val target = state.pendingLink
        if (target != null) {
            navController.navigate("chat/${target.conversationId}") { launchSingleTop = true }
            appViewModel.openConversation(target.conversationId, target.messageId)
            appViewModel.consumeDeepLink()
            if (state.pendingVoiceShortcut) {
                appViewModel.consumeVoiceShortcut()
                microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
            }
        } else if (navController.currentDestination?.route == LOGIN) {
            navController.navigate(DIRECTORY) { popUpTo(LOGIN) { inclusive = true } }
        }
    }
    LaunchedEffect(state.pendingShare != null, state.session, state.restoringSession) {
        if (state.session == null || state.restoringSession || state.pendingShare == null) return@LaunchedEffect
        if (navController.currentDestination?.route != SHARE) {
            navController.navigate(SHARE) { launchSingleTop = true }
        }
    }
    LaunchedEffect(state.pendingSystemAction, state.pendingSystemIdentifier, state.session) {
        val action = state.pendingSystemAction ?: return@LaunchedEffect
        if (state.session == null) return@LaunchedEffect
        when {
            action == "run-routine" -> {
                state.pendingSystemIdentifier?.let(appViewModel::runRoutineById)
                navController.navigate(ROUTINES)
            }
            action == "send-bot-task" -> {
                val conversation = state.conversations.firstOrNull { it.botId == state.pendingSystemIdentifier }
                if (conversation != null) {
                    appViewModel.openConversation(conversation.id)
                    state.pendingSystemPayload?.takeIf(String::isNotBlank)?.let(appViewModel::updateDraft)
                    navController.navigate("chat/${conversation.id}")
                } else {
                    navController.navigate(DIRECTORY)
                }
            }
            action == "find-messages" -> navController.navigate(MESSAGE_SEARCH)
            action == "open-bot" -> {
                val conversation = state.conversations.firstOrNull { it.botId == state.pendingSystemIdentifier }
                if (conversation != null) navController.navigate("bot/${conversation.id}/details")
                else navController.navigate(DIRECTORY)
            }
            action.contains("routine", ignoreCase = true) -> navController.navigate(ROUTINES)
            action.contains("plugin", ignoreCase = true) -> navController.navigate(PLUGINS)
            action.contains("settings", ignoreCase = true) -> navController.navigate(SETTINGS)
            else -> state.pendingSystemIdentifier?.let { identifier ->
                appViewModel.openConversation(identifier)
                navController.navigate("chat/$identifier")
            }
                ?: appViewModel.acceptShare(SharePayload(action, null, "text/plain"))
        }
        appViewModel.consumeSystemAction()
    }

    if (state.restoringSession) {
        Box(Modifier.fillMaxSize())
        return
    }

    val liveVoiceActive = state.liveVoice.state != AndroidLiveVoiceState.Idle &&
        state.liveVoiceConversationId != null
    val liveVoiceBackdrop = rememberSpatialGlassBackdrop()

    CompositionLocalProvider(LocalAppLanguage provides state.features.settings.language, LocalAppHaptics provides haptics) {
        Box(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.systemBars)
                .consumeWindowInsets(WindowInsets.systemBars),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .then(if (liveVoiceActive) Modifier.spatialGlassBackdropSource(liveVoiceBackdrop) else Modifier),
            ) {
                NavHost(
                navController = navController,
                startDestination = if (state.session != null) DIRECTORY else LOGIN,
                enterTransition = { if (isSettingsOpening()) spatialDrawerEnter() else spatialPushEnter() },
                exitTransition = { if (isSettingsOpening()) spatialDrawerBackdropExit() else spatialPushExit() },
                popEnterTransition = { if (isSettingsClosing()) spatialDrawerBackdropPopEnter() else spatialPopEnter() },
                popExitTransition = { if (isSettingsClosing()) spatialDrawerExit() else spatialPopExit() },
            ) {
                spatialComposable(LOGIN) {
                    SignInScreen(
                        loading = state.loading,
                        checkingServer = state.authChecking,
                        validatedServer = state.validatedServer,
                        error = state.error,
                        onCheckServer = appViewModel::checkServer,
                        onClearValidation = appViewModel::clearServerValidation,
                        onContinue = appViewModel::signIn,
                        onPreview = appViewModel::signInPreview,
                    )
                }
                spatialComposable(DIRECTORY) {
                    DirectoryScreen(
                        accountName = state.session?.accountName.orEmpty(),
                        rows = state.conversations,
                        searchResults = state.searchResults,
                        searchLoading = state.searchLoading,
                        searchError = state.searchError,
                        sidebar = state.sidebar,
                        onOpen = { conversation ->
                            appViewModel.openConversation(conversation.id)
                            navController.navigate("chat/${conversation.id}")
                        },
                        onRoutines = { navController.navigate(CREATE) },
                        onOutbox = { navController.navigate(OUTBOX) },
                        onSettings = { navController.navigate(SETTINGS) { launchSingleTop = true } },
                        onSearch = appViewModel::search,
                        onClearSearch = appViewModel::clearSearch,
                        onOpenSearchResult = { result ->
                            result.channelId?.let { conversationId ->
                                appViewModel.openConversation(conversationId, result.messageId)
                                navController.navigate("chat/$conversationId")
                            }
                        },
                        onBotDetails = { conversation ->
                            if (conversation.isGroup) {
                                navController.navigate("conversation/${conversation.id}/profile")
                            } else {
                                navController.navigate("bot/${conversation.id}/details")
                            }
                        },
                        onTogglePin = appViewModel::togglePinned,
                        onMoveToSection = { conversationId, sectionId ->
                            appViewModel.moveToSection(conversationId, sectionId)
                        },
                        onToggleSection = appViewModel::toggleSection,
                    )
                }
                spatialComposable(BOT_DETAILS, arguments = listOf(navArgument("conversationId") { type = NavType.StringType })) { entry ->
                    val id = entry.arguments?.getString("conversationId").orEmpty()
                    val conversation = state.conversations.firstOrNull { it.id == id }
                        ?: state.hiddenConversations.firstOrNull { it.id == id }
                    val botId = conversation?.botId
                    LaunchedEffect(id, botId) {
                        appViewModel.refreshDirectory()
                        appViewModel.loadChannelLibrary(id, refresh = false)
                        if (!botId.isNullOrBlank()) {
                            appViewModel.loadRoutinesForBot(botId)
                        }
                    }
                    val routinesState = botId?.let { state.features.routinesByBotId[it] ?: FeatureLoadState.Loading }
                    val libraryState = state.features.libraryByChannelId[id]
                    val shareLabel = localizedText("Share bot", "分享机器人")
                    BotDetailsScreen(
                        conversation = conversation,
                        routinesState = routinesState,
                        libraryState = libraryState,
                        onBack = { navController.popBackStack() },
                        onOpenChat = {
                            appViewModel.openConversation(id)
                            navController.navigate("chat/$id")
                        },
                        onComputer = { navController.navigate("bot/$id/computer") },
                        onRoutines = {
                            botId?.let(appViewModel::loadRoutinesForBot)
                            navController.navigate(ROUTINES)
                        },
                        onLibrary = { navController.navigate("bot/$id/library") },
                        onEdit = { navController.navigate("conversation/$id/profile") },
                        onHide = { appViewModel.setConversationHidden(it, true); navController.popBackStack() },
                        onDelete = {
                            appViewModel.deleteConversation(it)
                            navController.navigate(DIRECTORY) { popUpTo(DIRECTORY) { inclusive = true } }
                        },
                        onDuplicate = { appViewModel.duplicateBot(it) },
                        onNotifications = { row, enabled -> appViewModel.setBotNotifications(row, enabled) },
                        onShare = {
                            conversation?.let {
                                context.startActivity(
                                    Intent.createChooser(
                                        Intent(Intent.ACTION_SEND).apply {
                                            type = "text/plain"
                                            putExtra(Intent.EXTRA_TEXT, it.title)
                                        },
                                        shareLabel,
                                    ),
                                )
                            }
                        },
                    )
                }
                spatialComposable(CREATE) {
                    CreateConversationScreen(
                        bots = state.conversations.filter { it.isBot },
                        onCreateBot = { name, description, instructions, icon, color ->
                            appViewModel.createBot(name, description, instructions, icon, color)
                            navController.popBackStack()
                        },
                        onCreateGroup = { name, botIds ->
                            appViewModel.createGroup(name, botIds)
                            navController.popBackStack()
                        },
                        onBack = { navController.popBackStack() },
                    )
                }
                spatialComposable(PROFILE, arguments = listOf(navArgument("conversationId") { type = NavType.StringType })) { entry ->
                    val id = entry.arguments?.getString("conversationId").orEmpty()
                    LaunchedEffect(id) { appViewModel.refreshDirectory() }
                    val conversation = state.conversations.firstOrNull { it.id == id }
                        ?: state.hiddenConversations.firstOrNull { it.id == id }
                    val voiceProvider = (state.features.voiceSettings as? FeatureLoadState.Ready)?.value?.defaultProvider ?: "volcengine"
                    ConversationProfileScreen(
                        conversation = conversation,
                        bots = state.conversations.filter { it.isBot },
                        accountName = state.session?.accountName.orEmpty(),
                        voiceProvider = voiceProvider,
                        onSaveBot = { current, name, botTitle, description, instructions, voice, icon, color, resetAvatar ->
                            appViewModel.updateBot(current, name, botTitle, description, instructions, voice, icon, color, resetAvatar)
                            navController.popBackStack()
                        },
                        onSaveGroup = { current, name, description, botIds ->
                            appViewModel.updateGroup(current, name, description, botIds)
                            navController.popBackStack()
                        },
                        onBack = { navController.popBackStack() },
                    )
                }
                spatialComposable(BOT_LIBRARY, arguments = listOf(navArgument("conversationId") { type = NavType.StringType })) { entry ->
                    val id = entry.arguments?.getString("conversationId").orEmpty()
                    val conversation = state.conversations.firstOrNull { it.id == id }
                        ?: state.hiddenConversations.firstOrNull { it.id == id }
                    LaunchedEffect(id) {
                        appViewModel.loadChannelLibrary(id, refresh = true)
                    }
                    BotLibraryScreen(
                        conversation = conversation,
                        conversations = state.conversations,
                        state = state.features.libraryByChannelId[id] ?: com.outcomego.features.ChannelLibraryState(),
                        onBack = { navController.popBackStack() },
                        onRefresh = { appViewModel.loadChannelLibrary(id, refresh = true) },
                        onLoadMore = { appViewModel.loadMoreChannelLibrary(id) },
                        onTogglePin = { item -> appViewModel.toggleLibraryPin(id, item) },
                        onDownloadAttachment = { attachment -> appViewModel.downloadLibraryAttachment(id, attachment) },
                        onSaveAttachmentToUri = appViewModel::saveLibraryAttachmentToUri,
                        onShareAttachment = appViewModel::shareChatAttachment,
                        onForwardAttachment = { attachment, targetConversationId ->
                            appViewModel.forwardChatAttachment(attachment, targetConversationId)
                        },
                    )
                }
                spatialComposable(COMPUTER, arguments = listOf(navArgument("conversationId") { type = NavType.StringType })) { entry ->
                    val id = entry.arguments?.getString("conversationId").orEmpty()
                    val conversation = state.conversations.firstOrNull { it.id == id }
                    ComputerViewerScreen(
                        title = conversation?.title ?: localizedText("Cloud computer", "云电脑"),
                        botId = conversation?.botId.orEmpty(),
                        server = state.session?.server,
                        requestGrant = appViewModel::requestComputerGrant,
                        requestStatus = appViewModel::computerStatus,
                        setTakeover = appViewModel::setComputerTakeover,
                        setPaused = appViewModel::setComputerPaused,
                        sendAction = appViewModel::sendComputerAction,
                        sendClipboard = appViewModel::sendComputerClipboard,
                        onBack = { navController.popBackStack() },
                    )
                }
                spatialComposable(CHAT, arguments = listOf(navArgument("conversationId") { type = NavType.StringType })) { entry ->
                    val id = entry.arguments?.getString("conversationId").orEmpty()
                    val conversation = state.conversations.firstOrNull { it.id == id }
                    LaunchedEffect(id, conversation?.botId) {
                        if (state.activeConversationId != id) {
                            appViewModel.openConversation(id)
                        } else {
                            conversation?.botId?.let(appViewModel::loadRoutinesForBot)
                        }
                    }
                    ChatScreen(
                        conversationId = id,
                        accountName = state.session?.accountName.orEmpty(),
                        title = conversation?.title ?: localizedText("Conversation", "对话"),
                        messages = state.messages,
                        targetMessageId = state.activeMessageId,
                        draft = state.draft,
                        replyingTo = state.replyingTo,
                        onReply = appViewModel::startReply,
                        onCancelReply = appViewModel::cancelReply,
                        onOpenRoutine = {
                            conversation?.botId?.let(appViewModel::loadRoutinesForBot)
                            navController.navigate(ROUTINES)
                        },
                        error = state.error,
                        onBack = { navController.popBackStack() },
                        onBotDetails = {
                            if (conversation?.isGroup == true) {
                                navController.navigate("conversation/$id/profile")
                            } else {
                                navController.navigate("bot/$id/details")
                            }
                        },
                        onDraftChange = appViewModel::updateDraft,
                        onSend = appViewModel::sendDraft,
                        onRetry = appViewModel::retryMessage,
                        voiceState = voiceState,
                        onStartVoice = { microphonePermission.launch(Manifest.permission.RECORD_AUDIO) },
                        onStopVoice = appViewModel::stopVoice,
                        onRetryVoice = appViewModel::retryVoice,
                        onCancelVoice = appViewModel::cancelVoice,
                        liveVoice = state.liveVoice,
                        onStartLiveVoice = { members, speaker ->
                            val recordGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                            val bluetoothMissing = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                                ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
                            if (recordGranted && !bluetoothMissing) {
                                appViewModel.startLiveVoice(id, members, speaker)
                            } else {
                                pendingLiveVoiceConversationId = id
                                pendingLiveVoiceMembers = members to speaker
                                liveVoicePermissions.launch(liveVoicePermissionRequest())
                            }
                        },
                        groupMembers = if (conversation?.isGroup == true) {
                            val memberIds = conversation.memberBotIds.toSet()
                            state.conversations.filter { it.isBot && it.botId in memberIds }
                        } else {
                            emptyList()
                        },
                        onStopLiveVoice = appViewModel::stopLiveVoice,
                        onMuteLiveVoiceMicrophone = appViewModel::setLiveVoiceMicrophoneMuted,
                        onMuteLiveVoiceSpeaker = appViewModel::setLiveVoiceSpeakerMuted,
                        operation = state.features.operation,
                        pendingAttachments = state.pendingAttachments,
                        hasMoreHistory = state.hasMoreHistory,
                        historyLoading = state.historyLoading,
                        conversations = state.conversations,
                        onLoadOlder = appViewModel::loadOlderHistory,
                        onUpload = appViewModel::uploadChatAttachment,
                        onRemoveAttachment = appViewModel::removePendingAttachment,
                        onDownload = appViewModel::downloadChatAttachment,
                        onSaveAttachment = appViewModel::saveChatAttachment,
                        onShareAttachment = appViewModel::shareChatAttachment,
                        onForwardAttachment = appViewModel::forwardChatAttachment,
                        onAction = appViewModel::submitChatAction,
                        onReaction = appViewModel::reactToChatMessage,
                        onMessageAction = appViewModel::mutateChatMessage,
                        onContext = appViewModel::loadMessageContext,
                        threadContext = state.threadContext,
                        threadContextTruncated = state.threadContextTruncated,
                        activity = state.activity,
                        bot = conversation,
                    )
                }
                spatialComposable(ROUTINES) {
                    RoutinesScreen(
                        state = state.features.routines,
                        onRetry = appViewModel::loadFeatureData,
                        onAdd = { appViewModel.startRoutineEditor(); navController.navigate(ROUTINE_EDITOR) },
                        onEdit = { appViewModel.startRoutineEditor(it); navController.navigate(ROUTINE_EDITOR) },
                        onToggle = appViewModel::toggleRoutine,
                        onRun = appViewModel::runRoutine,
                        onBack = { navController.popBackStack() },
                    )
                }
                spatialComposable(ROUTINE_EDITOR) {
                    val draft = state.features.routineDraft
                    var shown by remember { mutableStateOf(draft) }
                    if (draft != null) shown = draft
                    LaunchedEffect(draft == null) {
                        if (draft == null && navController.currentDestination?.route == ROUTINE_EDITOR) {
                            navController.popBackStack()
                        }
                    }
                    shown?.let { routine ->
                        RoutineEditorScreen(
                            routine = routine,
                            onChange = appViewModel::updateRoutineDraft,
                            onSave = appViewModel::saveRoutine,
                            onBack = { navController.popBackStack() },
                            onDelete = routine.id.takeIf(String::isNotBlank)?.let { { appViewModel.deleteRoutine() } },
                            operation = state.features.operation,
                        )
                    }
                }
                spatialComposable(SETTINGS) {
                    SettingsScreen(
                        settings = state.features.settings,
                        accountName = state.session?.accountName.orEmpty(),
                        server = state.session?.server.orEmpty(),
                        networkSharing = networkSharing,
                        onToggleNetworkSharing = { enabled ->
                            if (enabled) AndroidNetworkProvider.start(context, allowSharing = true)
                            else AndroidNetworkProvider.stop(context)
                        },
                        onNetworkSharingDetails = { navController.navigate(NETWORK_SHARING_DETAILS) },
                        androidUpdateState = androidUpdateState,
                        onCheckForAndroidUpdate = onCheckForAndroidUpdate,
                        onDownloadAndroidUpdate = onDownloadAndroidUpdate,
                        onInstallAndroidUpdate = onInstallAndroidUpdate,
                        androidUpdateChannel = androidUpdateChannel,
                        onSetAndroidUpdateChannel = onSetAndroidUpdateChannel,
                        onChange = appViewModel::saveSettings,
                        onSignOut = {
                            appViewModel.signOut()
                            navController.navigate(LOGIN) { popUpTo(navController.graph.id) { inclusive = true } }
                        },
                        onBack = { navController.popBackStack() },
                        onProviders = { navController.navigate(PROVIDERS) },
                        onRealtimeVoice = { navController.navigate(REALTIME_VOICE) },
                        onWebProviders = { navController.navigate(WEB_PROVIDERS) },
                        onOutbox = { navController.navigate(OUTBOX) },
                        onAccount = { navController.navigate(ACCOUNT) },
                        onPlugins = { navController.navigate(PLUGINS) },
                        onSidebar = { navController.navigate(SIDEBAR) },
                    )
                }
                spatialComposable(NETWORK_SHARING_DETAILS) {
                    NetworkSharingDetailsScreen(
                        provider = networkSharing,
                        language = state.features.settings.language,
                        onBack = { navController.popBackStack() },
                    )
                }
                spatialComposable(OUTBOX) {
                    OutboxScreen(
                        items = state.outbox,
                        onRetry = appViewModel::retryQueuedMessage,
                        onDiscard = appViewModel::discardQueuedMessage,
                        onBack = { navController.popBackStack() },
                    )
                }
                spatialComposable(ACCOUNT) {
                    AccountMemoryScreen(
                        state = state.features.account,
                        onRetry = appViewModel::loadFeatureData,
                        onEditMemory = {},
                        onClearMemory = appViewModel::clearMemory,
                        onReset = appViewModel::resetLocalData,
                        onSignOut = {
                            appViewModel.signOut()
                            navController.navigate(LOGIN) { popUpTo(navController.graph.id) { inclusive = true } }
                        },
                        onBack = { navController.popBackStack() },
                    )
                }
                spatialComposable(SIDEBAR) {
                    SidebarManagementScreen(
                        sidebar = state.sidebar,
                        hidden = state.hiddenConversations,
                        onRename = appViewModel::renameSection,
                        onDeleteSection = appViewModel::deleteSection,
                        onUnhide = { appViewModel.setConversationHidden(it, false) },
                        onDeleteConversation = appViewModel::deleteConversation,
                        onBack = { navController.popBackStack() },
                    )
                }
                spatialComposable(MESSAGE_SEARCH) {
                    MessageSearchScreen(
                        results = state.searchResults,
                        loading = state.searchLoading,
                        error = state.searchError,
                        conversations = state.conversations,
                        accountName = state.session?.accountName.orEmpty(),
                        onSearch = { query -> appViewModel.search(query, "messages") },
                        onOpen = { result ->
                            result.channelId?.let { channelId ->
                                appViewModel.openConversation(channelId, result.messageId)
                                navController.navigate("chat/$channelId")
                            }
                        },
                        onBack = { navController.popBackStack() },
                    )
                }
                spatialComposable(PROVIDERS) {
                    ProviderSettingsScreen(
                        state = state.features.providers,
                        onRetry = appViewModel::loadFeatureData,
                        onBack = { navController.popBackStack() },
                        language = state.features.settings.language,
                        onConnect = appViewModel::connectProvider,
                        onDisconnect = appViewModel::disconnectProvider,
                        onRemove = appViewModel::removeProvider,
                        loadPresets = appViewModel::loadProviderPresets,
                        onAdd = appViewModel::addProvider,
                        onModelChange = { provider, model -> appViewModel.connectProvider(provider.copy(selectedModel = model)) },
                        onReasoningChange = { provider, reasoning -> appViewModel.connectProvider(provider.copy(selectedReasoning = reasoning)) },
                    )
                }
                spatialComposable(WEB_PROVIDERS) {
                    WebProviderSettingsScreen(
                        state = state.features.webProviders,
                        onRetry = appViewModel::loadFeatureData,
                        onBack = { navController.popBackStack() },
                        language = state.features.settings.language,
                        onSelect = appViewModel::selectWebProvider,
                        onSaveKey = { tool, provider, key -> appViewModel.saveWebProvider(tool, provider, key) },
                        onRemoveKey = { tool, provider -> appViewModel.saveWebProvider(tool, provider, "") },
                        onCheck = appViewModel::checkWebProvider,
                    )
                }
                spatialComposable(REALTIME_VOICE) {
                    VoiceSettingsScreen(
                        state = state.features.voiceSettings,
                        language = state.features.settings.language,
                        onRetry = appViewModel::loadFeatureData,
                        onSave = appViewModel::saveVoiceSettings,
                        onBack = { navController.popBackStack() },
                    )
                }
                spatialComposable(PLUGINS) {
                    PluginsScreen(
                        state = state.features.plugins,
                        onRetry = appViewModel::loadFeatureData,
                        onInstall = appViewModel::installPlugin,
                        onUpdate = appViewModel::updatePlugin,
                        onRollback = appViewModel::rollbackPlugin,
                        onAuthorize = appViewModel::authorizePlugin,
                        onCancelAuthorization = appViewModel::cancelPluginAuthorization,
                        onConfigure = appViewModel::configurePlugin,
                        onTestTool = appViewModel::testPluginTool,
                        onBack = { navController.popBackStack() },
                    )
                }
                spatialComposable(SHARE) {
                    val hostActivity = LocalContext.current as? androidx.activity.ComponentActivity
                    ShareTargetScreen(
                        share = state.pendingShare,
                        rows = state.conversations,
                        sidebar = state.sidebar,
                        error = state.error,
                        onSelect = appViewModel::selectShareTarget,
                        onStay = { conversation ->
                            navController.navigate("chat/${conversation.id}") { popUpTo(SHARE) { inclusive = true } }
                        },
                        onReturn = { conversation ->
                            navController.navigate("chat/${conversation.id}") { popUpTo(SHARE) { inclusive = true } }
                            hostActivity?.moveTaskToBack(true)
                        },
                        onCancel = {
                            appViewModel.cancelShare()
                            navController.popBackStack()
                        },
                    )
                }
                spatialComposable(MARKETPLACE) {
                    MarketplaceScreen(
                        state = state.features.plugins,
                        onBack = { navController.popBackStack() },
                        onOpenExtensions = { navController.navigate(PLUGINS) },
                    )
                }
            }
            }
            if (liveVoiceActive) {
                val callConversation = state.conversations.firstOrNull { it.id == state.liveVoiceConversationId }
                SpatialGlassBackdropProvider(liveVoiceBackdrop) {
                    LiveVoiceView(
                        snapshot = state.liveVoice,
                        bot = callConversation,
                        participants = if (callConversation?.isGroup == true) {
                            val memberIds = callConversation.memberBotIds.toSet()
                            state.conversations.filter { it.isBot && it.botId in memberIds }
                        } else {
                            emptyList()
                        },
                        defaultSpeakerId = state.liveVoiceDefaultSpeakerId,
                        onStop = appViewModel::stopLiveVoice,
                        onMuteMicrophone = appViewModel::setLiveVoiceMicrophoneMuted,
                        onMuteSpeaker = appViewModel::setLiveVoiceSpeakerMuted,
                        modifier = Modifier
                            .fillMaxSize()
                            .zIndex(20f),
                    )
                }
            }
        }
    }
}


internal fun formatRoutineStatus(
    state: FeatureLoadState<List<Routine>>?,
    isChinese: Boolean,
): String? = when (state) {
    is FeatureLoadState.Ready -> {
        val total = state.value.size
        val enabled = state.value.count { it.enabled }
        if (isChinese) "共 $total 个，已开启 $enabled 个" else "$total total, $enabled enabled"
    }
    is FeatureLoadState.Empty -> if (isChinese) "共 0 个，已开启 0 个" else "0 total, 0 enabled"
    is FeatureLoadState.Loading -> if (isChinese) "加载中…" else "Loading…"
    is FeatureLoadState.Failure, null -> null
}

@Composable
fun ChatContextSummary(messages: List<ChatMessage>, truncated: Boolean) {
    val colors = SpatialTheme.colors
    SpatialGlassSurface(
        tier = GlassTier.Subtle,
        shape = RoundedCornerShape(SpatialRadii.md),
        modifier = Modifier
            .fillMaxWidth()
            .testTag("thread-context"),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.chat_thread_context),
                    Modifier
                        .weight(1f)
                        .testTag("thread-context-title"),
                    fontWeight = FontWeight.SemiBold,
                    color = colors.textPrimary,
                )
                if (truncated) {
                    Text(
                        stringResource(R.string.chat_older_context),
                        modifier = Modifier.testTag("thread-context-truncated"),
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.textTertiary,
                    )
                }
            }
            messages.forEach { message ->
                Column(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                    Text(message.author, style = MaterialTheme.typography.labelSmall, color = colors.accent)
                    Text(
                        message.displayBody ?: "Rich content",
                        maxLines = 3,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textSecondary,
                    )
                }
            }
        }
    }
}
