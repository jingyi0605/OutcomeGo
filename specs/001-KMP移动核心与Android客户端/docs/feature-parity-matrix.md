# Android Feature Parity Matrix

Status: Draft

This matrix is the source inventory for full Android parity. Each row must map
to at least one task in `tasks.md`, one design section, and one verification
artifact before parity is complete.

| Area | Current iOS evidence | Android outcome | Required verification |
| --- | --- | --- | --- |
| Server setup and authentication | `SignInView.swift`, `ServerSetup.swift`, `SecureSession.swift` | Server URL setup, sign-in, sign-out, session expiry, secure storage | Auth UI, restart, revoked-session tests |
| Onboarding | `OnboardingView.swift`, `WizardViews.swift`, `OnboardingWizard.swift` | Equivalent first-run setup and bot onboarding | Onboarding acceptance flow |
| Home and directory | `HomeView.swift`, `SavedBotDirectory.swift`, `GroupChannelAvatar.swift` | Bots, groups, channels, avatars, hidden items, unread state | Directory and account-isolation tests |
| Messaging | `ChatView.swift`, `NativeMessageList.swift`, `MessageTimeline.swift`, `AppStore.swift` | History, live events, pagination, threads, optimistic sends | Sync, pagination, delivery, process-death tests |
| Composer | `ComposerView.swift`, `WidgetComposer.swift`, `MessageGestures.swift` | Text, replies, drafts, widgets, send/retry behavior | Composer and draft preservation tests |
| Rich messages | `RichMessageCard.swift`, `BotExchangeView.swift`, `MessagePresentation.swift` | Markdown, code, tables, math, Mermaid, cards, forms, approvals | Renderer fixtures and UI tests |
| Attachments | `AttachmentMedia.swift`, `NativeFilePreview.swift`, `SystemAssets.swift` | Upload, download, images, files, gallery, save, share, forward | Asset authorization and transfer tests |
| Reactions and actions | `MessageModalPresenter.swift`, message action code, server mutations | Reactions, fork, stop, dismiss, approval, template actions | Mutation and optimistic-state tests |
| Search and navigation | `SystemDiscovery.swift`, `SearchResult` models, deep-link handling | Server search, local index or Android search equivalent, context opening | Search and account-scope tests |
| Routines | `RoutinesView.swift`, `RoutineScheduleFields.swift`, `RoutineSchedule.swift` | List, create, edit, enable, disable, test, execution history | Routine acceptance and schedule tests |
| Account and memory | `AccountAndMemoryViews.swift`, `Persistence.swift` | Account profile, memory list/edit/clear, reset, sign-out | Account and reset tests |
| Settings and appearance | `SettingsView.swift`, `SidebarSettingsView.swift`, `NativeDesign.swift` | Appearance, accent, time zone, notification preferences | Settings persistence and accessibility tests |
| Provider/model setup | `ProvidersSettingsView.swift`, `ModelSetup.swift`, `InferenceSettings.swift` | Provider connections, OAuth/API-key flows, model and reasoning selection | Provider success/failure/persistence tests |
| Web providers | `WebProviderSettings.swift`, web provider assets | Provider selection, configuration, checks, warnings | Provider validation tests |
| Plugins | `PluginsView.swift`, `PluginConnectionView.swift`, `PluginManagementViews.swift` | Marketplace, install, update, rollback, OAuth, configuration, tool test | Plugin lifecycle and OAuth tests |
| Voice notes | `VoiceMemo.swift`, `VoiceNotesSettingsView.swift`, `VoiceMemoGesture.swift` | Record, cancel, interruption recovery, transcribe, draft preservation | Voice lifecycle and permission tests |
| Bot voice launch | `BotVoiceLaunch.swift`, `BotVoiceLaunchTests.swift` | Android shortcut or intent opens target bot and starts recording | Cold-launch and account-scope tests |
| Computer/VNC | `ComputerView.swift`, `ComputerVNC.swift`, `ComputerSurface.swift`, `ComputerKeyboard.swift`, `ComputerPointerGesture.swift`, `ComputerVNCSession.swift` | Screen status, VNC, keyboard, pointer, takeover, clipboard, pause | VNC and screen-action tests |
| Notifications | `NativeNotifications.swift`, `NotificationPresence.swift`, `NotificationReads.swift`, notification extension | FCM, notification channels, foreground suppression, read state, deep links | Provider delivery and notification tests |
| Share extension | `ShareExtension/ShareViewController.swift`, `ShareDirectory.swift` | Android Sharesheet target with bot/channel selection | Share text/file/message acceptance tests |
| Siri/Shortcuts/Spotlight | `SystemIntentClient.swift`, `TeamIntents.swift`, `SystemDiscovery.swift`, `SiriMessaging.swift` | Android App Actions, shortcuts, search/indexing equivalents | Intent, search, account-switch, attachment tests |
| Deep links | `OpenTeamApp.swift`, URL handling, `app-deep-links` contract | Android App Links and notification links | Valid, expired, and cross-account link tests |
| Widgets and shortcuts | `WidgetComposer.swift`, launch shortcut code | Android widgets or shortcuts where product-equivalent | Widget/shortcut smoke tests |
| Motion and haptics | `RobotMotion.swift`, `NativeHaptics.swift`, motion schemes | Android animation and haptic equivalent | Motion, reduced-motion, haptic tests |
| Accessibility | iOS UI test identifiers and native accessibility behavior | TalkBack labels, focus order, contrast, font scaling | Accessibility audit on representative screens |
| Performance | `HistoryPerformanceTests.swift`, motion/performance schemes, probes | Scroll, composer, history, startup, memory, battery checks | Release-profiled Android tests |
| Release and operations | iOS release docs, signing, TestFlight workflow | Gradle signing, Play artifacts, staged rollout, crash diagnostics | Reproducible release and rollback rehearsal |
