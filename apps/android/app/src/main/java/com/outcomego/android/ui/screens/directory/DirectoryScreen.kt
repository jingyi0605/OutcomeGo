package com.outcomego.android.ui.screens.directory

import android.os.Build
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.outcomego.android.data.Conversation
import com.outcomego.android.data.SearchResult
import com.outcomego.android.data.SidebarPreferences
import com.outcomego.android.ui.designsystem.GlassTier
import com.outcomego.android.ui.designsystem.SpatialAmbientCanvas
import com.outcomego.android.ui.designsystem.SpatialGlassBackdropProvider
import com.outcomego.android.ui.designsystem.SpatialGlassSurface
import com.outcomego.android.ui.designsystem.SpatialIconOrb
import com.outcomego.android.ui.designsystem.SpatialSpacing
import com.outcomego.android.ui.designsystem.SpatialTheme
import com.outcomego.android.ui.designsystem.rememberSpatialGlassBackdrop
import com.outcomego.android.ui.designsystem.spatialGlassBackdropSource
import com.outcomego.android.ui.groupConversations
import androidx.compose.material3.TextButton
import com.outcomego.features.HapticEffect
import com.outcomego.features.LocalAppHaptics
import com.outcomego.features.localizedText

@Composable
internal fun DirectoryScreen(
    accountName: String,
    rows: List<Conversation>,
    searchResults: List<SearchResult>,
    searchLoading: Boolean,
    searchError: String?,
    sidebar: SidebarPreferences,
    onOpen: (Conversation) -> Unit,
    onRoutines: () -> Unit,
    onOutbox: () -> Unit,
    onSettings: () -> Unit,
    onSearch: (String, String) -> Unit,
    onClearSearch: () -> Unit,
    onOpenSearchResult: (SearchResult) -> Unit,
    onBotDetails: (Conversation) -> Unit,
    onTogglePin: (String) -> Unit,
    onMoveToSection: (String, String?) -> Unit,
    onToggleSection: (String?) -> Unit,
    onOutcomes: (() -> Unit)? = null,
) {
    var searchVisible by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var searchFilter by remember { mutableStateOf(SearchFilter.All) }
    var rowMenuId by remember { mutableStateOf<String?>(null) }
    val searchFocusRequester = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    val activity = LocalContext.current as? ComponentActivity
    val colors = SpatialTheme.colors
    val haptic = LocalAppHaptics.current

    // Only manually pinned chats appear in the top row, and they are removed from the
    // grouped list below so each chat is shown in exactly one place.
    val grouped = remember(rows, sidebar) { groupConversations(rows, sidebar) }
    val pinnedRows = grouped.pinned
    val unassignedRows = grouped.unassigned
    val showSectionHeadings = grouped.showUnassignedHeading
    val settingsLabel = localizedText("Settings", "设置")
    val closeSearch = {
        keyboardController?.hide()
        searchVisible = false
        query = ""
        searchFilter = SearchFilter.All
        onClearSearch()
    }
    BackHandler(enabled = searchVisible) {
        closeSearch()
    }
    DisposableEffect(activity, searchVisible) {
        if (activity == null || !searchVisible || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            onDispose { }
        } else {
            val callback = OnBackInvokedCallback { closeSearch() }
            activity.onBackInvokedDispatcher.registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_OVERLAY,
                callback,
            )
            onDispose {
                activity.onBackInvokedDispatcher.unregisterOnBackInvokedCallback(callback)
            }
        }
    }
    LaunchedEffect(searchVisible, query, searchFilter) {
        if (searchVisible) onSearch(query, searchFilter.apiValue) else onClearSearch()
    }
    LaunchedEffect(searchVisible) {
        if (searchVisible) searchFocusRequester.requestFocus()
    }

    val backdrop = rememberSpatialGlassBackdrop()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(searchVisible, haptic) {
                if (searchVisible) return@pointerInput
                // Settings lives off the left edge (drag right); Outcomes lives off the right edge (drag left).
                val trigger = 72.dp.toPx()
                var total = 0f
                var fired = false
                detectHorizontalDragGestures(onDragStart = { total = 0f; fired = false }) { _, delta ->
                    total += delta
                    if (!fired && total >= trigger) {
                        fired = true
                        haptic.play(HapticEffect.Medium)
                        onSettings()
                    } else if (!fired && total <= -trigger && onOutcomes != null) {
                        fired = true
                        haptic.play(HapticEffect.Medium)
                        onOutcomes()
                    }
                }
            },
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .spatialGlassBackdropSource(backdrop),
        ) {
            SpatialAmbientCanvas(modifier = Modifier.fillMaxSize()) {
                if (searchVisible) {
            Column(
                Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .padding(top = 68.dp, start = SpatialSpacing.md, end = SpatialSpacing.md),
            ) {
                SearchFilterRow(selected = searchFilter, onSelected = { searchFilter = it })
                Box(Modifier.fillMaxWidth().weight(1f)) {
                    if (query.isNotBlank()) {
                        SearchResultsList(
                            results = searchResults,
                            loading = searchLoading,
                            error = searchError,
                            conversations = rows,
                            accountName = accountName,
                            onSelect = onOpenSearchResult,
                        )
                    }
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .testTag("directory-title"),
                contentPadding = PaddingValues(
                    top = 82.dp,
                    bottom = 108.dp,
                    start = SpatialSpacing.md,
                    end = SpatialSpacing.md,
                ),
            ) {
                if (pinnedRows.isNotEmpty()) {
                    item(key = "pinned-strip") {
                        LazyRow(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally),
                            contentPadding = PaddingValues(top = 6.dp, bottom = 14.dp),
                        ) {
                            items(pinnedRows, key = { "pinned-${it.id}" }) { row ->
                                PinnedBotCard(
                                    conversation = row,
                                    accountName = accountName,
                                    members = groupMembers(row, rows),
                                    unread = row.unread > 0 || sidebar.isUnread(row.id),
                                    onClick = { onOpen(row) },
                                    onLongClick = { onTogglePin(row.id) },
                                )
                            }
                        }
                    }
                }
                grouped.sections.forEach { group ->
                    val section = group.section
                    val members = group.conversations
                    item(key = "section-${section.id}") {
                        DirectorySectionHeader(
                            name = section.name,
                            collapsed = section.collapsed,
                            count = members.size,
                            onClick = { onToggleSection(section.id) },
                        )
                    }
                    if (!section.collapsed) {
                        items(members, key = Conversation::id) { row ->
                            DirectoryConversationRow(
                                row = row,
                                accountName = accountName,
                                members = groupMembers(row, rows),
                                unread = row.unread > 0 || sidebar.isUnread(row.id),
                                pinned = false,
                                sections = sidebar.sections,
                                menuExpanded = rowMenuId == row.id,
                                onOpen = { onOpen(row) },
                                onBotDetails = { onBotDetails(row) },
                                onTogglePin = { onTogglePin(row.id) },
                                onMoveToSection = { sectionId -> onMoveToSection(row.id, sectionId) },
                                onOpenMenu = { rowMenuId = row.id },
                                onDismissMenu = { rowMenuId = null },
                            )
                        }
                    }
                }
                if (showSectionHeadings) {
                    item(key = "section-unassigned") {
                        DirectorySectionHeader(
                            name = localizedText("Unassigned", "未分组"),
                            collapsed = sidebar.unassignedCollapsed,
                            count = unassignedRows.size,
                            onClick = { onToggleSection(null) },
                        )
                    }
                }
                if (!showSectionHeadings || !sidebar.unassignedCollapsed) {
                    items(unassignedRows, key = Conversation::id) { row ->
                        DirectoryConversationRow(
                            row = row,
                            accountName = accountName,
                            members = groupMembers(row, rows),
                            unread = row.unread > 0 || sidebar.isUnread(row.id),
                            pinned = false,
                            sections = sidebar.sections,
                            menuExpanded = rowMenuId == row.id,
                            onOpen = { onOpen(row) },
                            onBotDetails = { onBotDetails(row) },
                            onTogglePin = { onTogglePin(row.id) },
                            onMoveToSection = { sectionId -> onMoveToSection(row.id, sectionId) },
                            onOpenMenu = { rowMenuId = row.id },
                            onDismissMenu = { rowMenuId = null },
                        )
                    }
                }
                item { Spacer(Modifier.height(8.dp)) }
            }
        }
            }
        }

        // Top & bottom floating Liquid Glass chrome over the live-blurred scroll backdrop
        SpatialGlassBackdropProvider(backdrop) {
            Box(Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .padding(horizontal = SpatialSpacing.md, vertical = SpatialSpacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(SpatialSpacing.sm),
                ) {
                    if (searchVisible) {
                        SpatialGlassSurface(
                            tier = GlassTier.Floating,
                            shape = CircleShape,
                            shadowElevation = 6.dp,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(
                                localizedText("Search Content", "搜索内容"),
                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                                color = colors.textPrimary,
                                modifier = Modifier.padding(horizontal = 18.dp, vertical = 12.dp),
                            )
                        }
                    } else {
                        SpatialGlassSurface(
                            tier = GlassTier.Floating,
                            shape = CircleShape,
                            shadowElevation = 6.dp,
                            onClick = onSettings,
                            hapticEffect = HapticEffect.Selection,
                            modifier = Modifier
                                .size(44.dp)
                                .semantics { contentDescription = settingsLabel },
                        ) {
                            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                Text(
                                    accountName.take(1).uppercase().ifBlank { "O" },
                                    color = colors.textPrimary,
                                    fontWeight = FontWeight.SemiBold,
                                    style = MaterialTheme.typography.titleMedium,
                                )
                            }
                        }
                        Spacer(Modifier.weight(1f))
                        onOutcomes?.let { open ->
                            TextButton(onClick = open) {
                                Text(localizedText("Outcomes", "成果"))
                            }
                        }
                        SpatialIconOrb(
                            icon = Icons.Default.Refresh,
                            contentDescription = localizedText("Outbox", "发件箱"),
                            onClick = onOutbox,
                        )
                        SpatialIconOrb(
                            icon = Icons.Default.Add,
                            contentDescription = localizedText("Create conversation", "创建对话"),
                            onClick = onRoutines,
                        )
                    }
                }

                AnimatedContent(
                    targetState = searchVisible,
                    transitionSpec = { fadeIn() togetherWith fadeOut() },
                    modifier = Modifier.align(Alignment.BottomCenter),
                    label = "directorySearchBar",
                ) { expanded ->
                    if (expanded) {
                        ExpandedSearchBar(
                            query = query,
                            onQueryChange = { query = it },
                            focusRequester = searchFocusRequester,
                            onClear = { query = "" },
                            onClose = closeSearch,
                        )
                    } else {
                        FloatingSearchBar(onClick = { searchVisible = true })
                    }
                }
            }
        }
    }
}
