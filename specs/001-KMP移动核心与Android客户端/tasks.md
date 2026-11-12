# Task List: Complete Android Client Parity

Status: Draft

## Purpose

This is the complete implementation plan for an Android client that provides
equivalent functionality to the current iOS client. It includes the shared
Kotlin Multiplatform core, Android-native UI and integrations, server changes,
iOS integration, verification, and release work.

The authoritative feature inventory is
`docs/feature-parity-matrix.md`. Every matrix row must be covered by a task and
verified before the parity goal is complete.

## Status values

- `TODO`: not started
- `IN_PROGRESS`: currently being worked on
- `BLOCKED`: blocked by an external decision or dependency
- `IN_REVIEW`: result exists and needs review
- `DONE`: completed and recorded here
- `CANCELLED`: intentionally removed with a reason

Only tasks with status `DONE` may be checked as complete.

## Completion rule

A task is complete only when its implementation, error state, lifecycle behavior,
accessibility behavior where applicable, and verification evidence are present.
A screen without its data flow and failure handling does not satisfy parity.

---

## Phase 0: Baseline and parity inventory

- [ ] 0.1 Build the iOS capability inventory
  - Status: TODO
  - What this does: Turn the current iOS source files, tests, schemes, and
    README product boundaries into a feature-by-feature baseline.
  - What you will see when complete: `docs/feature-parity-matrix.md` contains
    every current user-facing area and its evidence.
  - Dependencies: None
  - Read first: `requirements.md` Requirements 6-7; `design.md` §2.4
  - Main areas: `apps/ios/Sources`, `apps/ios/Tests`, `apps/ios/README.md`
  - This does not do: Implement Android code.
  - Completion criteria:
    1. Every iOS source area maps to a matrix row.
    2. Every iOS UI/system test maps to a verification row.
    3. Android-native equivalents are named where direct parity is impossible.
  - Verification: Manual inventory review and `rg` cross-check.
  - Requirements: Requirements 6 and 7
  - Design: §2.4, §7.4

- [ ] 0.2 Freeze the supported Android product baseline
  - Status: TODO
  - What this does: Decide minimum SDK, supported Android versions, form factors,
    account modes, server compatibility range, and first release criteria.
  - What you will see when complete: A release baseline that controls all later
    compatibility and QA tasks.
  - Dependencies: 0.1
  - Read first: `requirements.md` §8.2; `design.md` §1.3 and §8.2
  - Main areas: Spec docs and release configuration
  - This does not do: Change server compatibility behavior.
  - Completion criteria:
    1. Minimum SDK and device range are recorded.
    2. Android-native substitutes are approved.
    3. Server compatibility policy is recorded.
  - Verification: Product and engineering review.
  - Requirements: Requirements 6 and 7
  - Design: §1.3, §2.4, §8.2

- [ ] 0.3 Inventory server gaps for Android parity
  - Status: TODO
  - What this does: Compare the iOS client calls and Android parity needs with
    server routes, contracts, notification services, and tests.
  - What you will see when complete: A list of required server changes,
    including FCM, Android presence, and any missing mobile endpoint behavior.
  - Dependencies: 0.1
  - Read first: `requirements.md` Requirements 2, 5, and 6; `design.md` §3.3
  - Main areas: `apps/server/src/routes`, `apps/server/src/services`,
    `packages/contracts`, `packages/db/prisma/schema.prisma`
  - This does not do: Implement server changes.
  - Completion criteria:
    1. Every required endpoint is identified.
    2. APNs compatibility constraints are recorded.
    3. FCM and Android presence changes have explicit owners and tests.
  - Verification: Route and contract review.
  - Requirements: Requirements 2, 5, and 6
  - Design: §3.3, §5, §8.2

- [ ] 0.4 Checkpoint: approve the parity baseline
  - Status: TODO
  - What this does: Approve the feature matrix, Android baseline, and server gap
    list before implementation starts.
  - What you will see when complete: A frozen parity target and no ambiguous
    “full functionality” claims.
  - Dependencies: 0.1, 0.2, 0.3
  - Read first: `requirements.md`, `design.md`, `docs/feature-parity-matrix.md`
  - Main areas: All Phase 0 materials
  - This does not do: Add implementation scope after approval.
  - Completion criteria:
    1. Matrix rows have acceptance owners.
    2. Server work is linked to client work.
    3. Platform limitations have explicit decisions.
  - Verification: Spec review.
  - Requirements: Requirements 6 and 7
  - Design: §2.4, §8.2

---

## Phase 1: KMP build, contracts, and shared foundation

- [ ] 1.1 Create the Gradle KMP module and CI build
  - Status: TODO
  - What this does: Add Android and iOS targets, common source sets, dependency
    locking, local build commands, and CI caching.
  - What you will see when complete: Shared code builds for both mobile targets.
  - Dependencies: 0.4
  - Read first: `requirements.md` Requirement 1; `design.md` §2.2 and §6.4
  - Main areas: New `mobile/shared/`, Gradle settings, CI workflows
  - This does not do: Add app screens.
  - Completion criteria:
    1. Android compilation succeeds.
    2. iOS framework compilation succeeds.
    3. Common tests run in CI.
    4. Platform dependencies stay isolated.
  - Verification: Gradle build, iOS framework build, CI dry run.
  - Requirements: Requirements 1 and 7
  - Design: §2.2, §6.4, §7

- [ ] 1.2 Define mobile contract source of truth
  - Status: TODO
  - What this does: Decide generated schema versus fixture-based models and
    define versioning, unknown fields, enum evolution, and error compatibility.
  - What you will see when complete: A contract workflow used by TypeScript,
    Kotlin, and Swift integration tests.
  - Dependencies: 0.4
  - Read first: `requirements.md` Requirement 2; `design.md` §3.2, §3.3, §8.2
  - Main areas: `packages/contracts`, new mobile fixtures, server route docs
  - This does not do: Migrate every model yet.
  - Completion criteria:
    1. Source of truth is documented.
    2. Backward-compatibility rules are tested.
    3. Contract fixtures cover all MVP and parity-critical payloads.
  - Verification: Contract review and fixture test.
  - Requirements: Requirement 2
  - Design: §3.2, §3.3, §7.4

- [ ] 1.3 Implement shared transport and authentication
  - Status: TODO
  - What this does: Port URL normalization, bearer auth, login, logout, server
    validation, timeout, redirect, and error handling.
  - What you will see when complete: One mobile transport for both platforms.
  - Dependencies: 1.1, 1.2
  - Read first: `apps/ios/Sources/Core/API.swift`,
    `packages/client-core/src/http.ts`, `design.md` §3.1 and §5
  - Main areas: `mobile/shared/src/commonMain/`
  - This does not do: Implement UI or persistence migration.
  - Completion criteria:
    1. Tokens never appear in logs.
    2. Auth and server errors preserve status and code.
    3. Invalid URLs and redirects are handled safely.
  - Verification: Shared unit and transport fixture tests.
  - Requirements: Requirements 1 and 2
  - Design: §3.1, §5.1, §5.2

- [ ] 1.4 Implement shared models and event contracts
  - Status: TODO
  - What this does: Port accounts, bots, channels, messages, assets, runs,
    routines, settings, events, errors, and delivery models needed for parity.
  - What you will see when complete: Kotlin models decode the same fixtures as
    the current server and iOS behavior.
  - Dependencies: 1.2, 1.3
  - Read first: `apps/ios/Sources/Core/Models.swift`, `packages/contracts`,
    `design.md` §3.2
  - Main areas: `mobile/shared/src/commonMain/`
  - This does not do: Replace every existing Swift model immediately.
  - Completion criteria:
    1. Required and optional fields are explicit.
    2. Large decimal sequence IDs remain strings.
    3. Unknown optional fields decode safely.
  - Verification: Fixture decode and encode tests.
  - Requirements: Requirement 2
  - Design: §3.2, §6.4

- [ ] 1.5 Implement shared persistence and account isolation
  - Status: TODO
  - What this does: Define account-scoped storage for sessions, cursors, bots,
    channels, messages, drafts, delivery records, and settings.
  - What you will see when complete: Both clients can restore state without
    leaking data across servers or accounts.
  - Dependencies: 1.3, 1.4
  - Read first: `apps/ios/Sources/Core/Persistence.swift`,
    `SessionRecord.swift`, `StateWriter.swift`, `design.md` §4.1
  - Main areas: Shared repositories and iOS/Android storage adapters
  - This does not do: Delete the existing iOS store.
  - Completion criteria:
    1. Storage keys include server and account identity.
    2. Sign-out removes protected account state.
    3. Corrupt caches can be rebuilt.
  - Verification: Migration, reset, corruption, and account-isolation tests.
  - Requirements: Requirements 3, 4, and 6
  - Design: §4.1, §4.2, §6.3

- [ ] 1.6 Implement bootstrap, projections, and event synchronization
  - Status: TODO
  - What this does: Port bootstrap, SSE, long polling, cursor persistence,
    duplicate handling, reconnect, and projection updates.
  - What you will see when complete: Shared state stays consistent through
    reconnects and process restarts.
  - Dependencies: 1.4, 1.5
  - Read first: `packages/client-core/src/client.ts`,
    `apps/server/src/routes/event.ts`, `design.md` §2.3.2
  - Main areas: Shared sync and repository modules
  - This does not do: Implement screens.
  - Completion criteria:
    1. SSE and long polling converge to the same state.
    2. Cursor is durable before event completion.
    3. Duplicate and out-of-order events are safe.
  - Verification: Stream, replay, reconnect, and restart tests.
  - Requirements: Requirement 3
  - Design: §2.3.2, §6.1

- [ ] 1.7 Implement shared delivery journal and mutation receipts
  - Status: TODO
  - What this does: Port optimistic sends, client IDs, delivery lookup,
    authoritative merge, retry safety, reactions, stop, and action receipts.
  - What you will see when complete: All message mutations converge safely.
  - Dependencies: 1.6
  - Read first: `apps/ios/Sources/App/AppStore.swift`, `MessageFeatures.swift`,
    `WidgetComposer.swift`, `design.md` §2.3.3
  - Main areas: Shared delivery and mutation modules
  - This does not do: Implement platform-specific controls.
  - Completion criteria:
    1. One Delivery Nonce produces one logical message.
    2. Unknown outcomes query status before retry.
    3. Mutation receipts expose accepted and rejected states.
  - Verification: Delivery, duplicate, rejection, and ambiguous-response tests.
  - Requirements: Requirements 3 and 6
  - Design: §2.3.3, §6.2

- [ ] 1.8 Port shared validation, formatting, and domain algorithms
  - Status: TODO
  - What this does: Port URL, form, attachment, sequence, thread, routine,
    notification, and message-preview rules that should be identical.
  - What you will see when complete: Common rules no longer diverge between
    Swift and Kotlin implementations.
  - Dependencies: 1.4
  - Read first: `apps/ios/Sources/Core/FormValidation.swift`,
    `RoutineSchedule.swift`, `MessagePreview.swift`, `ThreadProjection.swift`,
    `packages/contracts/src`
  - Main areas: `mobile/shared/src/commonMain/`
  - This does not do: Port UI layout or platform haptics.
  - Completion criteria:
    1. Shared algorithms have cross-platform fixture tests.
    2. Time zones and decimal sequences are handled consistently.
    3. User-facing error classifications are stable.
  - Verification: Shared unit and property-style tests.
  - Requirements: Requirements 2, 3, and 6
  - Design: §6.1-§6.4, §7.1

- [ ] 1.9 Checkpoint: approve the shared mobile core
  - Status: TODO
  - What this does: Verify the shared foundation is stable before Android UI
    feature work begins.
  - What you will see when complete: A buildable, tested mobile core with a
    documented migration seam for iOS.
  - Dependencies: 1.1-1.8
  - Read first: `requirements.md`, `design.md`, and the parity matrix
  - Main areas: All Phase 1 files
  - This does not do: Add new product features.
  - Completion criteria:
    1. Android and iOS targets build.
    2. Shared contract and sync tests pass.
    3. Known gaps are linked to later tasks.
  - Verification: Full shared-core validation.
  - Requirements: Requirements 1-3
  - Design: §2, §3, §6, §7

---

## Phase 2: Android application foundation

- [ ] 2.1 Create Android app shell and navigation
  - Status: TODO
  - What this does: Add Compose app, navigation, lifecycle, theme, dependency
    injection boundary, and app state host.
  - What you will see when complete: Android launches into a stable shell on
    supported phones and tablets.
  - Dependencies: 1.9
  - Read first: `requirements.md` Requirements 4 and 7; `design.md` §2.1
  - Main areas: New `mobile/androidApp/`
  - This does not do: Add feature screens.
  - Completion criteria:
    1. Cold and warm launches work.
    2. Navigation survives configuration changes.
    3. Shared state is lifecycle-aware.
  - Verification: Android build and navigation smoke tests.
  - Requirements: Requirements 4 and 7
  - Design: §2.1, §2.2, §4.2

- [ ] 2.2 Implement secure session and server setup
  - Status: TODO
  - What this does: Add server URL setup, credential form, Keystore storage,
    sign-in, sign-out, expired-session handling, and server validation.
  - What you will see when complete: A user can establish and revoke a secure
    Android session.
  - Dependencies: 2.1
  - Read first: `SignInView.swift`, `ServerSetup.swift`, `SecureSession.swift`
  - Main areas: Android auth screens and platform storage adapter
  - This does not do: Add onboarding or messaging.
  - Completion criteria:
    1. Tokens are never stored in plain preferences.
    2. Invalid server and auth errors are actionable.
    3. Sign-out clears protected account data.
  - Verification: Auth UI, restart, and revoked-session tests.
  - Requirements: Requirements 4 and 6
  - Design: §2.3.1, §5.3

- [ ] 2.3 Implement onboarding and first-run wizard
  - Status: TODO
  - What this does: Port onboarding steps, bot setup, empty states, and first-run
    transitions.
  - What you will see when complete: New users can complete the same setup path.
  - Dependencies: 2.2
  - Read first: `OnboardingView.swift`, `WizardViews.swift`,
    `OnboardingWizard.swift`
  - Main areas: Android onboarding screens and shared onboarding state
  - This does not do: Add provider or plugin setup.
  - Completion criteria:
    1. First-run state is resumable.
    2. Invalid inputs preserve user data.
    3. Completion returns to the correct directory state.
  - Verification: Onboarding acceptance and state-reset tests.
  - Requirements: Requirements 4 and 6
  - Design: §4.2, §5.3

- [ ] 2.4 Implement design tokens, appearance, accessibility foundation
  - Status: TODO
  - What this does: Port color, typography, spacing, robot avatars, dark/light
    appearance, dynamic font sizing, TalkBack semantics, and reduced motion.
  - What you will see when complete: Android has a stable visual and accessibility
    foundation for all feature screens.
  - Dependencies: 2.1
  - Read first: `NativeDesign.swift`, `BotGlyph.swift`, `packages/design-tokens`
  - Main areas: Android theme and component library
  - This does not do: Tune every feature screen.
  - Completion criteria:
    1. Dark/light/system appearance works.
    2. Large fonts do not destroy primary flows.
    3. Interactive elements expose labels and state.
  - Verification: Theme, font-scale, TalkBack, and reduced-motion checks.
  - Requirements: Requirements 5-7
  - Design: §2.2, §7.3

- [ ] 2.5 Implement local account reset and migration tools
  - Status: TODO
  - What this does: Port local reset, cache rebuild, migration diagnostics, and
    safe recovery paths.
  - What you will see when complete: Users can recover from stale or corrupt
    mobile state without affecting the server.
  - Dependencies: 1.5, 2.2
  - Read first: `LocalDataReset.swift`, `StateWriter.swift`, `Persistence.swift`
  - Main areas: Shared persistence and Android settings
  - This does not do: Add server database reset.
  - Completion criteria:
    1. Reset is account-scoped and user-confirmed.
    2. Corrupt state produces a recoverable error.
    3. Rebootstrap restores a usable client.
  - Verification: Corruption, reset, and relaunch tests.
  - Requirements: Requirements 3, 4, and 7
  - Design: §4.1, §5.3, §6.3

- [ ] 2.6 Checkpoint: validate the Android foundation
  - Status: TODO
  - What this does: Confirm app shell, authentication, onboarding, theme, and
    recovery are ready for feature implementation.
  - What you will see when complete: A signed-in Android shell with stable state.
  - Dependencies: 2.1-2.5
  - Read first: `requirements.md`, `design.md`, parity matrix
  - Main areas: Phase 2 files
  - This does not do: Add messaging features.
  - Completion criteria:
    1. Cold launch, sign-in, sign-out, and reset pass.
    2. Accessibility foundation passes review.
    3. No credentials appear in diagnostics.
  - Verification: Emulator smoke suite and manual review.
  - Requirements: Requirements 4 and 7
  - Design: §2, §5, §7

---

## Phase 3: Directory, navigation, and core messaging

- [ ] 3.1 Implement home, bot, group, and channel directory
  - Status: TODO
  - What this does: Port home navigation, bot list, group channels, avatars,
    hidden items, unread badges, activity indicators, and empty states.
  - What you will see when complete: Users can find and switch between all
    supported conversation targets.
  - Dependencies: 2.6, 1.6
  - Read first: `HomeView.swift`, `SavedBotDirectory.swift`,
    `GroupChannelAvatar.swift`, `ChannelView` contracts
  - Main areas: Android directory screens and shared directory projection
  - This does not do: Add chat rendering.
  - Completion criteria:
    1. Directory reflects bootstrap and live updates.
    2. Hidden and unread states match server state.
    3. Account switch cannot show prior account rows.
  - Verification: Directory UI and account-isolation tests.
  - Requirements: Requirements 3, 4, and 6
  - Design: §4.1, §6.3

- [ ] 3.2 Implement chat navigation and deep-link routing
  - Status: TODO
  - What this does: Port bot/channel navigation, message context links, thread
    targets, notification links, and cold-launch routing.
  - What you will see when complete: Links open the intended account-scoped
    conversation and context.
  - Dependencies: 3.1
  - Read first: `OpenTeamApp.swift`, `MessageModalPresenter.swift`,
    `packages/contracts/src/app-deep-links.ts`
  - Main areas: Android navigation and link adapters
  - This does not do: Add notification delivery.
  - Completion criteria:
    1. Valid links route after cold launch.
    2. Expired or cross-account links fail safely.
    3. Thread anchors open the correct message context.
  - Verification: Deep-link and cold-launch tests.
  - Requirements: Requirements 5, 6, and 7
  - Design: §2.3, §5.3, §6.3

- [ ] 3.3 Implement message history and virtualized list
  - Status: TODO
  - What this does: Port message list, history pagination, thread context,
    chronological merging, loading states, empty states, and scroll anchoring.
  - What you will see when complete: Long conversations remain usable and load
    older/newer context correctly.
  - Dependencies: 3.1, 1.6
  - Read first: `NativeMessageList.swift`, `ChatView.swift`, `HistoryWindow.swift`,
    `MessageTimeline.swift`, `ThreadProjection.swift`
  - Main areas: Android chat list and shared history projection
  - This does not do: Add rich content renderers.
  - Completion criteria:
    1. Pagination preserves sequence order.
    2. Thread context is bounded and correct.
    3. Scroll position survives updates where appropriate.
  - Verification: History, thread, large-list, and scroll tests.
  - Requirements: Requirements 3, 4, and 6
  - Design: §2.3.2, §4.2, §6.1

- [ ] 3.4 Implement composer, drafts, replies, and send states
  - Status: TODO
  - What this does: Port text composer, drafts, reply targets, fork behavior,
    time zone submission, send progress, retry, and failure presentation.
  - What you will see when complete: Users can compose and recover messages with
    the same delivery semantics as iOS.
  - Dependencies: 3.3, 1.7
  - Read first: `ComposerView.swift`, `OutboxView.swift`, `AppStore.swift`
  - Main areas: Android composer and shared delivery journal
  - This does not do: Add voice input or attachment picker.
  - Completion criteria:
    1. Draft survives navigation and process recreation as specified.
    2. Optimistic and authoritative rows converge.
    3. Retry never silently duplicates a send.
  - Verification: Composer, draft, delivery, and process-death tests.
  - Requirements: Requirements 3, 4, and 6
  - Design: §2.3.3, §3.2.3, §6.2

- [ ] 3.5 Implement message gestures, context menus, and navigation behavior
  - Status: TODO
  - What this does: Port swipe/back behavior, long-press actions, selection,
    modal presentation, keyboard dismissal, and Android back handling.
  - What you will see when complete: Primary message interactions feel native and
    preserve the same actions.
  - Dependencies: 3.3, 3.4
  - Read first: `MessageGestures.swift`, `MessageModalPresenter.swift`,
    `BarRegions.swift`
  - Main areas: Android gesture and modal components
  - This does not do: Add every mutation action.
  - Completion criteria:
    1. Back navigation does not lose drafts.
    2. Context actions are accessible without gestures.
    3. Modal actions return to the same conversation state.
  - Verification: Gesture, back, keyboard, and accessibility tests.
  - Requirements: Requirements 4-7
  - Design: §2.2, §4.2, §7.3

- [ ] 3.6 Implement search and message-context navigation
  - Status: TODO
  - What this does: Port server search, result categories, context loading, and
    navigation to bots, routines, channels, and messages.
  - What you will see when complete: Users can find older content and open the
    correct context.
  - Dependencies: 3.2, 3.3
  - Read first: `SystemDiscovery.swift`, search contracts, `SearchResult` models
  - Main areas: Android search UI and shared search client
  - This does not do: Add OS indexing yet.
  - Completion criteria:
    1. Search handles loading, empty, error, and result states.
    2. Message results open bounded context.
    3. Account scope is preserved.
  - Verification: Search and context tests.
  - Requirements: Requirements 4 and 6
  - Design: §3.3, §4.1, §6.3

- [ ] 3.7 Checkpoint: complete the core conversation workflow
  - Status: TODO
  - What this does: Verify directory, navigation, history, composer, search,
    drafts, and live delivery as one workflow.
  - What you will see when complete: Android supports the complete primary chat
    workflow before advanced feature work.
  - Dependencies: 3.1-3.6
  - Read first: `requirements.md`, `design.md`, parity matrix
  - Main areas: Phase 3 files
  - This does not do: Add settings, plugins, voice, or VNC.
  - Completion criteria:
    1. Main chat workflow passes on a clean install.
    2. Relaunch and network interruption are covered.
    3. All matrix rows in directory and messaging are linked to evidence.
  - Verification: End-to-end emulator flow and parity review.
  - Requirements: Requirements 3, 4, and 6
  - Design: §2.3, §6, §7

---

## Phase 4: Rich messages, attachments, and message actions

- [ ] 4.1 Implement Markdown, code, links, tables, math, and Mermaid rendering
  - Status: TODO
  - What this does: Port the offline renderer behavior and safe link/content
    handling used by the iOS client.
  - What you will see when complete: Common message formats render correctly on
    Android with streaming and large-content behavior.
  - Dependencies: 3.3
  - Read first: `RichMarkdownView.swift`, renderer export scripts, renderer tests
  - Main areas: Android renderer and generated resources
  - This does not do: Change server message format.
  - Completion criteria:
    1. Fixtures render consistently.
    2. Large documents do not block the UI.
    3. Unsafe content handling matches the existing contract.
  - Verification: Renderer fixture, snapshot, and large-message tests.
  - Requirements: Requirements 2, 6, and 7
  - Design: §3.2, §5, §7

- [ ] 4.2 Implement rich cards, widgets, forms, and approval flows
  - Status: TODO
  - What this does: Port `RichMessageCard`, custom widgets, user forms,
    secret submissions, external draft approvals, and action receipts.
  - What you will see when complete: Interactive server-generated message cards
    behave equivalently to iOS.
  - Dependencies: 4.1, 1.7
  - Read first: `RichMessageCard.swift`, `WidgetComposer.swift`, contracts for
    widgets, forms, and external drafts
  - Main areas: Android rich-message components and shared mutation APIs
  - This does not do: Add platform-specific system dialogs unrelated to cards.
  - Completion criteria:
    1. Every supported card type has view, loading, error, and completed states.
    2. Responses are idempotent and account-scoped.
    3. Dismissed and already-completed cards remain stable after refresh.
  - Verification: Rich-message fixture and mutation integration tests.
  - Requirements: Requirements 2, 3, and 6
  - Design: §3.3, §4.2, §6.2

- [ ] 4.3 Implement attachments and asset authorization
  - Status: TODO
  - What this does: Port asset upload, download, parent-message verification,
    limits, cancellation, and current-session authorization.
  - What you will see when complete: Text and file attachments work safely.
  - Dependencies: 3.4, 1.3, 1.4
  - Read first: `AttachmentMedia.swift`, `SystemAssets.swift`, asset contracts
  - Main areas: Shared asset client and Android picker/upload layer
  - This does not do: Add photo gallery UI.
  - Completion criteria:
    1. Limits match server behavior.
    2. Assets cannot be fetched across accounts or messages.
    3. Upload retry does not duplicate message attachments.
  - Verification: Asset-session, upload, limit, and authorization tests.
  - Requirements: Requirements 2, 3, and 6
  - Design: §3.3, §5.3, §6.3

- [ ] 4.4 Implement image, video, document, and gallery previews
  - Status: TODO
  - What this does: Port thumbnails, full-screen gallery, file preview, save,
    share, and download behavior using Android media/document APIs.
  - What you will see when complete: Users can inspect and export supported
    attachments from message history.
  - Dependencies: 4.3
  - Read first: `AttachmentMedia.swift`, `NativeFilePreview.swift`
  - Main areas: Android media viewer, document provider, and sharing adapter
  - This does not do: Implement unsupported file-format renderers.
  - Completion criteria:
    1. Supported media types have loading and failure states.
    2. Large media is bounded and cancellable.
    3. Save/share actions report permission and provider errors.
  - Verification: Media fixture and Android provider tests.
  - Requirements: Requirements 5-7
  - Design: §2.2, §5.3, §7.3

- [ ] 4.5 Implement reactions and message mutations
  - Status: TODO
  - What this does: Port reactions, fork, stop, delete/dismiss actions, bot
    template actions, and other supported message mutations.
  - What you will see when complete: All supported message actions have the same
    server result and clear pending/error states.
  - Dependencies: 4.2, 1.7
  - Read first: `MessageFeatures.swift`, `AppStore.swift`, mutation contracts
  - Main areas: Shared mutation layer and Android action menus
  - This does not do: Add new server mutations.
  - Completion criteria:
    1. Mutations are idempotent where the server contract requires it.
    2. Optimistic UI rolls back on rejection.
    3. Action results survive refresh.
  - Verification: Mutation and retry tests.
  - Requirements: Requirements 3 and 6
  - Design: §3.3, §6.2

- [ ] 4.6 Checkpoint: complete content and action parity
  - Status: TODO
  - What this does: Verify all rich-message, attachment, and mutation matrix rows.
  - What you will see when complete: Message content is functionally complete,
    not only plain-text capable.
  - Dependencies: 4.1-4.5
  - Read first: parity matrix and `design.md` §7
  - Main areas: Phase 4 files
  - This does not do: Add routines, plugins, voice, or VNC.
  - Completion criteria:
    1. Renderer fixtures pass.
    2. Attachment authorization passes.
    3. Interactive cards and mutations have evidence.
  - Verification: Android UI suite and parity checklist.
  - Requirements: Requirements 2, 3, 6, and 7
  - Design: §3.2, §3.3, §7

---

## Phase 5: Account, settings, providers, and routines

- [ ] 5.1 Implement account, memory, profile, and reset workflows
  - Status: TODO
  - What this does: Port account information, bot memory list/edit/clear,
    profile actions, local reset, and sign-out behavior.
  - What you will see when complete: Account and memory workflows match iOS.
  - Dependencies: 2.6, 1.5
  - Read first: `AccountAndMemoryViews.swift`, `LocalDataReset.swift`, memory APIs
  - Main areas: Android settings and shared account repositories
  - This does not do: Add provider credentials.
  - Completion criteria:
    1. Account operations are scoped and confirm destructive actions.
    2. Memory state updates after mutations.
    3. Sign-out removes protected state.
  - Verification: Account, memory, reset, and sign-out tests.
  - Requirements: Requirements 4, 6, and 7
  - Design: §4.1, §5.3, §6.3

- [ ] 5.2 Implement appearance, time zone, notification preferences, and settings
  - Status: TODO
  - What this does: Port appearance, accent, time zone, sidebar, notification
    preference, and server connection settings.
  - What you will see when complete: Settings persist and affect client behavior.
  - Dependencies: 2.4, 5.1
  - Read first: `SettingsView.swift`, `SidebarSettingsView.swift`,
    `TimeZoneSettingsView.swift`, `VoiceNotesSettingsView.swift`
  - Main areas: Android settings screens and preference storage
  - This does not do: Implement FCM registration itself.
  - Completion criteria:
    1. Settings survive restart and account changes safely.
    2. Time zone affects outgoing message and routine behavior.
    3. Accessibility settings remain usable.
  - Verification: Settings persistence and font-scale tests.
  - Requirements: Requirements 4-7
  - Design: §4.2, §5.3, §7.3

- [ ] 5.3 Implement provider catalog and model selection
  - Status: TODO
  - What this does: Port provider list, connected state, model search, model
    selection, reasoning settings, and failure recovery.
  - What you will see when complete: Users can inspect and change inference
    settings from Android.
  - Dependencies: 5.2, 1.4
  - Read first: `ProvidersSettingsView.swift`, `ModelSetup.swift`,
    `ModelSetupViews.swift`, `InferenceSettings.swift`
  - Main areas: Android provider and model screens
  - This does not do: Implement external provider OAuth yet.
  - Completion criteria:
    1. Saved selection reloads correctly.
    2. Failed test or save preserves the previous valid selection.
    3. Provider disconnect removes local sensitive state.
  - Verification: Provider settings integration tests.
  - Requirements: Requirements 2, 4, and 6
  - Design: §3.3, §5.3

- [ ] 5.4 Implement provider authentication and OAuth handoffs
  - Status: TODO
  - What this does: Port API-key, OAuth, prompt-response, cancellation, callback,
    and browser handoff flows.
  - What you will see when complete: Supported provider authorization workflows
    work through Android browser and intent APIs.
  - Dependencies: 5.3
  - Read first: `ModelSetup.swift`, `PluginConnectionView.swift`, OAuth routes
  - Main areas: Android auth screens, browser callbacks, shared auth state
  - This does not do: Store provider secrets on the device unless server API
    requires it.
  - Completion criteria:
    1. Success, cancel, timeout, and failure states are handled.
    2. Callback is account-scoped.
    3. Browser return works after process recreation.
  - Verification: OAuth fixture and callback tests.
  - Requirements: Requirements 5, 6, and 7
  - Design: §3.3, §5.3, §6.3

- [ ] 5.5 Implement web-provider settings
  - Status: TODO
  - What this does: Port web provider catalog, selection, configuration checks,
    warnings, and saved-state behavior.
  - What you will see when complete: Web search provider settings have equivalent
    controls and errors.
  - Dependencies: 5.2
  - Read first: `WebProviderSettings.swift`, web-search contracts
  - Main areas: Android web-provider screens and shared model layer
  - This does not do: Add a new search provider.
  - Completion criteria:
    1. Provider selection and checks converge to server state.
    2. Missing-key and unavailable-provider warnings are clear.
    3. Sensitive values are never displayed or logged.
  - Verification: Provider settings tests.
  - Requirements: Requirements 2, 4, and 6
  - Design: §3.2, §5.3

- [ ] 5.6 Implement routines and schedule management
  - Status: TODO
  - What this does: Port routine list, create, edit, enable, disable, test,
    execution history, schedule fields, time zones, and event-trigger limits.
  - What you will see when complete: Users can manage routines on Android.
  - Dependencies: 5.2, 1.8
  - Read first: `RoutinesView.swift`, `RoutineScheduleFields.swift`,
    `RoutineSchedule.swift`, routine contracts
  - Main areas: Android routine screens and shared schedule logic
  - This does not do: Change server scheduling semantics.
  - Completion criteria:
    1. Editable and non-editable schedules are distinguished correctly.
    2. Time-zone changes preserve server rules.
    3. Revision conflicts are reported and recoverable.
  - Verification: Routine validation, schedule, and acceptance tests.
  - Requirements: Requirements 2, 4, and 6
  - Design: §3.2, §4.2, §6.1

- [ ] 5.7 Implement server activity and topology views
  - Status: TODO
  - What this does: Port server activity, runtime health, version, update state,
    and topology presentation where exposed by iOS.
  - What you will see when complete: Android exposes the same server status and
    maintenance information.
  - Dependencies: 5.2, 1.4
  - Read first: `ServerActivityView.swift`, `ServerTopologyArt.swift`, server
    activity and update contracts
  - Main areas: Android server status screens
  - This does not do: Add server administration beyond existing endpoints.
  - Completion criteria:
    1. Loading, unavailable, and update-busy states are handled.
    2. Version and health data are clearly distinguished.
  - Verification: Server status fixture tests.
  - Requirements: Requirements 2, 4, and 6
  - Design: §3.3, §5.1

- [ ] 5.8 Checkpoint: complete account and configuration parity
  - Status: TODO
  - What this does: Verify account, settings, providers, routines, and server
    status against the parity matrix.
  - What you will see when complete: Android supports the configuration workflows
    required to operate OpenTeam beyond chat.
  - Dependencies: 5.1-5.7
  - Read first: parity matrix and `design.md` §7
  - Main areas: Phase 5 files
  - This does not do: Add plugins, voice, VNC, or system integrations.
  - Completion criteria:
    1. Every Phase 5 matrix row has evidence.
    2. Account isolation and sensitive-data handling pass.
    3. Server revision and failure paths are covered.
  - Verification: Android acceptance suite and parity review.
  - Requirements: Requirements 4, 6, and 7
  - Design: §4, §5, §7

---

## Phase 6: Plugins and external workflows

- [ ] 6.1 Implement plugin catalog and installation workflows
  - Status: TODO
  - What this does: Port plugin marketplace, source browsing, install,
    update, rollback, remove, and synchronization workflows.
  - What you will see when complete: Android can manage supported plugins.
  - Dependencies: 5.8, 1.4
  - Read first: `PluginsView.swift`, `PluginManagementViews.swift`, plugin contracts
  - Main areas: Android plugin management screens
  - This does not do: Execute plugin tools locally.
  - Completion criteria:
    1. Install/update/rollback states are explicit.
    2. Draft and installed plugin states cannot be confused.
    3. Failures preserve the last valid state.
  - Verification: Plugin lifecycle integration tests.
  - Requirements: Requirements 2, 4, and 6
  - Design: §3.3, §5.3

- [ ] 6.2 Implement plugin connection configuration
  - Status: TODO
  - What this does: Port connection status, setup phases, field validation,
    secrets-preserving edits, account management, and instructions.
  - What you will see when complete: Users can configure installed integrations.
  - Dependencies: 6.1
  - Read first: `PluginConnectionView.swift`, `PluginConnectionActions.swift`,
    `PluginAuthorization.swift`
  - Main areas: Android plugin connection screens and shared validation
  - This does not do: Expose stored secrets in the UI.
  - Completion criteria:
    1. Saved secrets survive unrelated edits.
    2. Setup phases and missing configuration are clear.
    3. Disconnect and remove operations are recoverable.
  - Verification: Configuration and validation tests.
  - Requirements: Requirements 2, 4, and 6
  - Design: §3.2, §5.3, §6.3

- [ ] 6.3 Implement plugin OAuth and browser callbacks
  - Status: TODO
  - What this does: Port provider setup guides, browser handoff, callback,
    cancellation, restart, and account selection.
  - What you will see when complete: Supported plugin OAuth workflows complete on
    Android without losing navigation state.
  - Dependencies: 6.2, 5.4
  - Read first: `PluginConnectionView.swift`, OAuth server routes, plugin tests
  - Main areas: Android browser and deep-link adapters
  - This does not do: Implement provider-specific credentials in the client.
  - Completion criteria:
    1. Callback cannot cross accounts.
    2. Cancel, timeout, and provider errors are visible.
    3. Process recreation can resume or safely abandon the flow.
  - Verification: OAuth integration tests and Android intent tests.
  - Requirements: Requirements 5-7
  - Design: §3.3, §5.3, §6.3

- [ ] 6.4 Implement plugin tool test and management parity
  - Status: TODO
  - What this does: Port test-tool forms, connection restart, account rename,
    environment/configuration operations, and result presentation.
  - What you will see when complete: Android can perform the supported plugin
    maintenance actions available on iOS.
  - Dependencies: 6.2
  - Read first: `PluginConnectionView.swift`, `PluginManagementViews.swift`
  - Main areas: Android plugin action screens
  - This does not do: Add desktop-only plugin runtime controls.
  - Completion criteria:
    1. Tool-test results handle success, structured failure, and timeout.
    2. Destructive actions require explicit confirmation.
  - Verification: Plugin action tests.
  - Requirements: Requirements 4, 6, and 7
  - Design: §5.1, §5.3, §7.3

- [ ] 6.5 Checkpoint: complete plugin parity
  - Status: TODO
  - What this does: Verify catalog, installation, connection, OAuth, and tool
    management against the iOS feature matrix.
  - What you will see when complete: Plugin workflows are complete or have
    explicit server/platform blockers.
  - Dependencies: 6.1-6.4
  - Read first: parity matrix and plugin test inventory
  - Main areas: Phase 6 files
  - This does not do: Add new connectors.
  - Completion criteria:
    1. Each plugin matrix row has test evidence.
    2. Server blockers are linked to server tasks.
    3. Sensitive-data review passes.
  - Verification: Plugin integration suite and manual review.
  - Requirements: Requirements 2, 6, and 7
  - Design: §3.3, §5, §7

---

## Phase 7: Voice, transcription, computer, and VNC

- [ ] 7.1 Implement voice recording and interruption lifecycle
  - Status: TODO
  - What this does: Port recording limits, permission flow, pause/cancel,
    interruption, route changes, background behavior, and draft preservation.
  - What you will see when complete: Android voice notes behave safely through
    permission and lifecycle changes.
  - Dependencies: 3.4, 5.2
  - Read first: `VoiceMemo.swift`, `VoiceNotesSettingsView.swift`,
    `VoiceMemoGesture.swift`, `VoiceLifecycleTests.swift`
  - Main areas: Android audio adapter and voice composer UI
  - This does not do: Implement continuous voice calls.
  - Completion criteria:
    1. Recording stops safely on denied permission and background transitions.
    2. Interruption does not corrupt the draft.
    3. Cancel and send have distinct outcomes.
  - Verification: Android audio lifecycle tests and device checks.
  - Requirements: Requirements 5-7
  - Design: §2.2, §4.2, §5.3

- [ ] 7.2 Implement transcription upload and draft integration
  - Status: TODO
  - What this does: Port audio upload, transcription settings, progress,
    timeout, result insertion, and failure recovery.
  - What you will see when complete: Recorded notes transcribe into the existing
    composer without losing user text.
  - Dependencies: 7.1, 5.2
  - Read first: `VoiceMemo.swift`, `ServerSetup.swift`, transcription contracts
  - Main areas: Shared transcription API and Android draft state
  - This does not do: Add a new transcription provider.
  - Completion criteria:
    1. Server timeout and failure preserve the recording or draft as specified.
    2. Successful transcription inserts text safely.
    3. Settings changes are reflected after reload.
  - Verification: Transcription fixture and draft-preservation tests.
  - Requirements: Requirements 2, 3, and 6
  - Design: §3.3, §5.3, §6.2

- [ ] 7.3 Implement bot voice launch and Android shortcut equivalent
  - Status: TODO
  - What this does: Port fixed-bot launch and record-to-bot behavior through
    Android shortcuts or App Actions.
  - What you will see when complete: A user can launch a bot or recording flow
    without manually navigating first.
  - Dependencies: 7.1, 3.2
  - Read first: `BotVoiceLaunch.swift`, `BotVoiceLaunchTests.swift`,
    `TeamIntents.swift`
  - Main areas: Android intent/shortcut adapter and cold-launch routing
  - This does not do: Implement Siri-specific language understanding.
  - Completion criteria:
    1. Target bot is account-scoped.
    2. Queued voice request expires safely.
    3. Existing draft is preserved according to product rules.
  - Verification: Cold-launch and account-switch tests.
  - Requirements: Requirements 5 and 6
  - Design: §2.3.1, §2.3.4, §6.3

- [ ] 7.4 Implement computer screen and VNC session foundation
  - Status: TODO
  - What this does: Port screen status, VNC session creation, auth, frame
    loading, lifecycle, and disconnect behavior.
  - What you will see when complete: Users can open a bot computer surface on
    Android.
  - Dependencies: 3.2, 1.3
  - Read first: `ComputerView.swift`, `ComputerVNC.swift`,
    `ComputerVNCSession.swift`, `ComputerSurface.swift`
  - Main areas: Android VNC/WebView/native surface and shared session API
  - This does not do: Add keyboard, pointer, or takeover actions.
  - Completion criteria:
    1. Session is tied to the authenticated account and bot.
    2. Disconnect and background behavior are safe.
    3. Invalid sessions show recoverable errors.
  - Verification: VNC validation fixtures and lifecycle tests.
  - Requirements: Requirements 2, 4, and 6
  - Design: §2.2, §3.3, §5.3

- [ ] 7.5 Implement computer keyboard, pointer, clipboard, and takeover
  - Status: TODO
  - What this does: Port keyboard input, pointer gestures, clipboard, screen
    takeover, pause, and action error handling.
  - What you will see when complete: Android can interact with the bot computer
    surface equivalently to the supported iOS controls.
  - Dependencies: 7.4
  - Read first: `ComputerKeyboard.swift`, `ComputerPointerGesture.swift`,
    `ComputerSurface.swift`, screen contracts
  - Main areas: Android input overlay and screen action adapters
  - This does not do: Add unsupported hardware-specific gestures.
  - Completion criteria:
    1. Input actions preserve ordering and cancellation.
    2. Takeover and pause state is visible.
    3. Clipboard permissions and failures are explicit.
  - Verification: Screen action, clipboard, takeover, and VNC tests.
  - Requirements: Requirements 3, 4, and 6
  - Design: §2.3, §5.3, §6.2

- [ ] 7.6 Checkpoint: complete voice and computer parity
  - Status: TODO
  - What this does: Verify voice, transcription, bot voice launch, VNC, and
    computer interaction against the matrix.
  - What you will see when complete: Advanced device workflows have evidence on
    emulator and physical Android hardware where required.
  - Dependencies: 7.1-7.5
  - Read first: parity matrix and iOS system tests
  - Main areas: Phase 7 files
  - This does not do: Add new hardware features.
  - Completion criteria:
    1. Permission and lifecycle paths pass.
    2. VNC and input actions pass with synthetic fixtures.
    3. Physical-device limitations are documented.
  - Verification: Android device tests and simulator parity review.
  - Requirements: Requirements 5-7
  - Design: §2.2, §7.2, §7.3

---

## Phase 8: Notifications, share, search, and Android system integration

- [ ] 8.1 Extend server contracts and delivery for FCM
  - Status: TODO
  - What this does: Add Android push registration, FCM provider validation,
    provider-specific storage, delivery routing, and compatibility tests.
  - What you will see when complete: The server can register and deliver to both
    APNs and FCM devices without regressing iOS.
  - Dependencies: 0.3, 1.2
  - Read first: `packages/contracts/src/index.ts`,
    `packages/contracts/src/notification-presence.ts`,
    `apps/server/src/services/notification-service.ts`,
    `packages/db/prisma/schema.prisma`
  - Main areas: Server contracts, notification service, database, tests
  - This does not do: Change APNs payload semantics unnecessarily.
  - Completion criteria:
    1. FCM registration has a validated shape.
    2. Provider routing is platform-aware.
    3. APNs tests remain green.
    4. Android provider and presence tests exist.
  - Verification: Server unit and integration tests.
  - Requirements: Requirements 2, 5, and 6
  - Design: §2.3.4, §3.3.4, §5

- [ ] 8.2 Implement Android notification presentation and read state
  - Status: TODO
  - What this does: Port notification content, channels, badges, foreground
    suppression, read state, action buttons, and notification deep links.
  - What you will see when complete: Android notifications have the same product
    meaning and routing behavior as iOS.
  - Dependencies: 8.1, 3.2
  - Read first: `NativeNotifications.swift`, `NotificationPresence.swift`,
    `NotificationReads.swift`, notification contracts
  - Main areas: Android FCM service, notification channels, shared routing
  - This does not do: Add arbitrary marketing notifications.
  - Completion criteria:
    1. Message and reaction notifications use correct presentation.
    2. Foreground presence suppresses notifications according to server state.
    3. Tapping a notification opens the correct context.
  - Verification: Notification fixture, foreground, background, and tap tests.
  - Requirements: Requirements 5-7
  - Design: §2.3.4, §4.2, §6.3

- [ ] 8.3 Implement Android Sharesheet target
  - Status: TODO
  - What this does: Port the iOS share extension's bot/channel selection and
    direct send behavior to Android share intents.
  - What you will see when complete: Users can share text and supported files
    into OpenTeam from other Android apps.
  - Dependencies: 3.1, 4.3, 8.2
  - Read first: `ShareExtension/ShareViewController.swift`, `ShareDirectory.swift`
  - Main areas: Android share target and shared send API
  - This does not do: Add account selection outside supported saved sessions.
  - Completion criteria:
    1. Text and supported files are accepted.
    2. Account and bot selection are scoped correctly.
    3. Cancel, unsupported type, and send failure are clear.
  - Verification: Android Sharesheet acceptance tests.
  - Requirements: Requirements 3, 5, and 6
  - Design: §2.1, §2.3.3, §6.3

- [ ] 8.4 Implement Android App Links and shortcut actions
  - Status: TODO
  - What this does: Port deep links, open-bot, open-conversation, record-note,
    send-task, and routine actions to Android-native entry points.
  - What you will see when complete: Users can invoke the main system actions
    without manually opening the app first.
  - Dependencies: 3.2, 7.3
  - Read first: `SystemIntentClient.swift`, `TeamIntents.swift`, `SiriMessaging.swift`,
    `app-deep-links.ts`
  - Main areas: Android intents, shortcuts, and App Links
  - This does not do: Claim Siri-equivalent language understanding.
  - Completion criteria:
    1. Fixed targets resolve to the current account only.
    2. Cold-launch requests are queued and consumed once.
    3. Unsupported parameters fail explicitly.
  - Verification: Intent and cold-launch tests.
  - Requirements: Requirements 5 and 6
  - Design: §2.3.1, §2.3.4, §6.3

- [ ] 8.5 Implement Android search/indexing equivalent
  - Status: TODO
  - What this does: Port opt-in indexing of visible conversations/messages and
    server search beyond the local index using supported Android APIs.
  - What you will see when complete: Users can find visible OpenTeam content
    through the Android search experience or an equivalent in-app path.
  - Dependencies: 3.6, 8.4
  - Read first: `SystemDiscovery.swift`, `SystemDiscoveryModels.swift`,
    `SystemIntentClient.swift`
  - Main areas: Android indexing/search adapter and privacy settings
  - This does not do: Index hidden conversations, drafts, or private metadata.
  - Completion criteria:
    1. Opt-in and opt-out remove indexed content correctly.
    2. Account changes clear prior indexed content.
    3. Search results open valid scoped context.
  - Verification: Indexing, opt-out, account-switch, and search tests.
  - Requirements: Requirements 5-7
  - Design: §2.4, §6.3, §7.3

- [ ] 8.6 Implement Android widgets or shortcut surface where applicable
  - Status: TODO
  - What this does: Provide an Android-native equivalent for any user-facing
    iOS widget or shortcut behavior identified in the parity matrix.
  - What you will see when complete: Approved quick-entry capabilities are
    available on Android.
  - Dependencies: 8.4
  - Read first: `WidgetComposer.swift`, `BotVoiceLaunch.swift`, parity decisions
  - Main areas: Android widget/shortcut modules
  - This does not do: Add an Android widget without a defined user workflow.
  - Completion criteria:
    1. Each shipped surface has account-scoped behavior.
    2. Stale targets fail safely after sign-out.
  - Verification: Android launcher and widget smoke tests.
  - Requirements: Requirements 5 and 6
  - Design: §2.4, §6.3

- [ ] 8.7 Checkpoint: complete system integration parity
  - Status: TODO
  - What this does: Verify FCM, notifications, share, links, shortcuts, and
    search/indexing across foreground, background, and cold-launch states.
  - What you will see when complete: Android system entry points are reliable
    and privacy-scoped.
  - Dependencies: 8.1-8.6
  - Read first: parity matrix and system integration tests
  - Main areas: Phase 8 files and server notification work
  - This does not do: Add new system integrations.
  - Completion criteria:
    1. Android system flows have evidence.
    2. iOS APNs and intent regressions are absent.
    3. Privacy and account isolation checks pass.
  - Verification: Device tests, server tests, and manual system review.
  - Requirements: Requirements 5-7
  - Design: §2.3.4, §6.3, §7

---

## Phase 9: iOS shared-core integration and cross-platform convergence

- [ ] 9.1 Add the iOS KMP framework integration seam
  - Status: TODO
  - What this does: Link the shared framework into the Xcode project through a
    narrow Swift adapter.
  - What you will see when complete: iOS can consume shared transport and models
    while retaining SwiftUI and native extensions.
  - Dependencies: 1.9
  - Read first: `apps/ios/OutcomeGoNative.xcodeproj`, `API.swift`, `Models.swift`,
    `AppStore.swift`, `design.md` §2.1
  - Main areas: Xcode project, Swift adapter, build scripts
  - This does not do: Delete all Swift core code.
  - Completion criteria:
    1. Debug and release builds link the correct framework.
    2. Swift-facing APIs are stable and documented.
    3. Existing extensions continue to build.
  - Verification: Xcode build and Swift integration tests.
  - Requirements: Requirements 1, 5, and 7
  - Design: §2.2, §6.4, §7.2

- [ ] 9.2 Migrate iOS transport, models, and synchronization incrementally
  - Status: TODO
  - What this does: Replace duplicated Swift behavior behind adapters in small
    slices, starting with transport/models, then sync and delivery.
  - What you will see when complete: iOS and Android use one shared mobile
    behavior for the parity-critical data path.
  - Dependencies: 9.1, 1.6, 1.7
  - Read first: iOS Core and AppStore sources, shared-core tests
  - Main areas: `apps/ios/Sources/Core`, `apps/ios/Sources/App/AppStore.swift`
  - This does not do: Migrate SwiftUI view layout or platform features.
  - Completion criteria:
    1. Each migration slice has a rollback boundary.
    2. Existing iOS tests remain green after each slice.
    3. State and delivery behavior match Android fixtures.
  - Verification: iOS core, UI, and parity tests.
  - Requirements: Requirements 1, 3, 6, and 7
  - Design: §2.4, §6.1-§6.4

- [ ] 9.3 Preserve and verify native iOS integrations
  - Status: TODO
  - What this does: Ensure Keychain, APNs, share extension, App Intents,
    Spotlight, Siri messaging, voice, and VNC remain native and functional.
  - What you will see when complete: KMP integration does not regress iOS.
  - Dependencies: 9.2
  - Read first: `apps/ios/NotificationService`, `apps/ios/ShareExtension`,
    `SystemDiscovery.swift`, `SiriMessaging.swift`, system tests
  - Main areas: Existing iOS targets and adapter boundaries
  - This does not do: Add Android behavior.
  - Completion criteria:
    1. Existing schemes and system tests pass.
    2. Keychain/account isolation remains intact.
    3. Notification and extension targets still archive.
  - Verification: iOS native test and archive checks.
  - Requirements: Requirements 5-7
  - Design: §2.1, §6.4, §7.3

- [ ] 9.4 Checkpoint: cross-platform convergence review
  - Status: TODO
  - What this does: Compare shared data behavior and feature state transitions
    across Android and iOS.
  - What you will see when complete: Remaining differences are platform UI or
    explicitly documented product decisions.
  - Dependencies: 9.1-9.3
  - Read first: parity matrix, requirements, design, test reports
  - Main areas: Shared Core, Android, and iOS
  - This does not do: Add unplanned features.
  - Completion criteria:
    1. Shared protocol behavior has one source implementation.
    2. All matrix rows have Android and iOS evidence.
    3. Remaining gaps have owners and follow-up tasks.
  - Verification: Cross-platform parity review.
  - Requirements: Requirements 1, 6, and 7
  - Design: §2.4, §7.4

---

## Phase 10: Quality, performance, security, and release

- [ ] 10.1 Build the Android unit and integration test suite
  - Status: TODO
  - What this does: Port relevant iOS CoreTests and SystemTests to shared and
    Android tests, including auth, persistence, message, routine, voice, and
    notification behavior.
  - What you will see when complete: Every shared and Android feature has tests
    proportionate to its risk.
  - Dependencies: 3.7, 4.6, 5.8, 6.5, 7.6, 8.7
  - Read first: `apps/ios/Tests/CoreTests`, `SystemTests`, parity matrix
  - Main areas: Shared tests and `mobile/androidApp/src/test`
  - This does not do: Replace UI acceptance tests.
  - Completion criteria:
    1. Shared tests cover all common state transitions.
    2. Android tests cover platform adapters.
    3. Failure and recovery cases are included.
  - Verification: Gradle unit and integration test commands.
  - Requirements: Requirements 3, 6, and 7
  - Design: §6, §7.1, §7.2

- [ ] 10.2 Build Android UI and acceptance coverage
  - Status: TODO
  - What this does: Create Compose UI tests for auth, onboarding, directory,
    chat, settings, rich messages, routines, plugins, voice, and system flows.
  - What you will see when complete: Android has repeatable acceptance coverage
    comparable to the iOS UI test inventory.
  - Dependencies: 10.1
  - Read first: `apps/ios/Tests/UITests`, iOS shared schemes, parity matrix
  - Main areas: `mobile/androidApp/src/androidTest`
  - This does not do: Test unsupported external services without fixtures.
  - Completion criteria:
    1. Primary happy paths and key failure paths are automated.
    2. Tests use isolated accounts and deterministic fixtures.
    3. UI identifiers and screenshots are stable where used.
  - Verification: Emulator acceptance suite.
  - Requirements: Requirements 4, 6, and 7
  - Design: §7.3, §7.4

- [ ] 10.3 Verify accessibility and localization behavior
  - Status: TODO
  - What this does: Audit TalkBack, focus order, semantics, dynamic font sizes,
    contrast, reduced motion, touch targets, and supported locales.
  - What you will see when complete: Core Android workflows remain usable with
    accessibility services and large text.
  - Dependencies: 10.2
  - Read first: `NativeDesign.swift`, UI test identifiers, Android design system
  - Main areas: Android UI components and acceptance tests
  - This does not do: Add broad localization beyond the supported product set.
  - Completion criteria:
    1. Critical flows pass TalkBack review.
    2. Large fonts preserve actions and content access.
    3. Reduced motion disables nonessential animation.
  - Verification: Manual accessibility audit and automated semantics checks.
  - Requirements: Requirements 6 and 7
  - Design: §2.2, §7.3

- [ ] 10.4 Verify startup, scroll, composer, memory, and battery performance
  - Status: TODO
  - What this does: Port the meaningful iOS performance checks to Android
    release builds and establish budgets for startup, history, scroll, composer,
    memory, and background work.
  - What you will see when complete: Performance budgets are measured on
    representative Android devices.
  - Dependencies: 3.7, 10.2
  - Read first: `HistoryPerformanceTests.swift`, performance schemes,
    `scripts/performance/README.md`
  - Main areas: Android benchmark and profiling configuration
  - This does not do: Treat emulator measurements as physical-device proof.
  - Completion criteria:
    1. Large-history and mixed-content cases are measured.
    2. Memory and battery regressions have thresholds.
    3. Release builds are used for final measurements.
  - Verification: Android benchmark and physical-device profiling.
  - Requirements: Requirements 6 and 7
  - Design: §7.3, §8.1

- [ ] 10.5 Perform security and privacy review
  - Status: TODO
  - What this does: Review token storage, logs, screenshots, notifications,
    account isolation, asset authorization, deep links, backups, and analytics.
  - What you will see when complete: Sensitive data handling is documented and
    tested on Android.
  - Dependencies: 8.7, 9.4
  - Read first: `SecureSession.swift`, `NotificationReads.swift`, asset tests,
    server auth tests
  - Main areas: Android and shared diagnostics/storage code
  - This does not do: Add analytics not required by the product.
  - Completion criteria:
    1. Tokens and secrets are absent from logs.
    2. Notifications respect privacy settings.
    3. Cross-account access tests fail closed.
  - Verification: Security checklist and focused tests.
  - Requirements: Requirements 2, 5, 6, and 7
  - Design: §5.3, §6.3

- [ ] 10.6 Add crash diagnostics and safe operational logging
  - Status: TODO
  - What this does: Add redacted diagnostics for sync, delivery, rendering,
    background work, notification handling, and platform failures.
  - What you will see when complete: Production failures can be investigated
    without exposing credentials or private content.
  - Dependencies: 10.5
  - Read first: `UserFacingError.swift`, server error conventions, release docs
  - Main areas: Shared error layer and Android diagnostics
  - This does not do: Log message bodies or file contents by default.
  - Completion criteria:
    1. Errors include endpoint/operation context without secrets.
    2. User-facing errors remain readable.
    3. Diagnostics can be disabled or bounded.
  - Verification: Redaction tests and failure injection.
  - Requirements: Requirements 2 and 7
  - Design: §5.1-§5.3

- [ ] 10.7 Configure signing, packaging, and release automation
  - Status: TODO
  - What this does: Add debug/release variants, signing, artifact generation,
    versioning, Play bundle packaging, and CI release checks.
  - What you will see when complete: A reproducible signed Android artifact.
  - Dependencies: 10.2, 10.5
  - Read first: `apps/ios/README.md` release section, repository CI, release files
  - Main areas: Gradle build, CI workflows, Android manifest/resources
  - This does not do: Publish to production without release approval.
  - Completion criteria:
    1. Debug and release identifiers are distinct.
    2. Signing secrets are externalized.
    3. Artifact metadata matches the project version.
    4. Release build can be reproduced from CI.
  - Verification: Clean checkout build and signing validation.
  - Requirements: Requirement 7
  - Design: §1.3, §7.3

- [ ] 10.8 Prepare staged rollout, compatibility, and rollback procedure
  - Status: TODO
  - What this does: Document server compatibility, minimum client versions,
    staged release, crash thresholds, rollback, and user communication.
  - What you will see when complete: The Android release can be operated safely.
  - Dependencies: 10.7
  - Read first: `requirements.md` Requirement 7; existing release documentation
  - Main areas: `docs/`, CI, release configuration
  - This does not do: Perform the production release.
  - Completion criteria:
    1. Rollback path is tested.
    2. Older servers and clients have documented behavior.
    3. Release health signals have owners.
  - Verification: Release rehearsal and checklist review.
  - Requirements: Requirement 7
  - Design: §8.1, §8.2

- [ ] 10.9 Run final full parity acceptance
  - Status: TODO
  - What this does: Run every feature matrix row against Android and compare
    with iOS behavior using synthetic and approved live-server fixtures.
  - What you will see when complete: A signed parity report with no untracked
    missing features.
  - Dependencies: 10.1-10.8
  - Read first: `docs/feature-parity-matrix.md`, `requirements.md`, `design.md`
  - Main areas: All mobile and server feature areas
  - This does not do: Add new scope during acceptance.
  - Completion criteria:
    1. Every matrix row is `PASS`, `ACCEPTED DIFFERENCE`, or `BLOCKED` with a
       recorded reason.
    2. Every blocked item has an owner and follow-up task.
    3. No critical workflow lacks evidence.
  - Verification: Full Android and iOS acceptance runs.
  - Requirements: Requirements 6 and 7
  - Design: §2.4, §7.4

- [ ] 10.10 Final Spec checkpoint
  - Status: TODO
  - What this does: Update requirements, design, tasks, parity matrix, test
    results, risks, and follow-up work to reflect the delivered state.
  - What you will see when complete: A complete, reviewable parity record that a
    new engineer can continue without reconstructing project history.
  - Dependencies: 10.9
  - Read first: Entire Spec and all validation reports
  - Main areas: Entire Spec, Android app, shared core, server changes
  - This does not do: Add new requirements after sign-off.
  - Completion criteria:
    1. Completed tasks are marked `DONE`.
    2. Blocked and cancelled tasks include reasons.
    3. Requirement-to-design-to-test traceability is complete.
    4. Remaining work is explicitly separated from parity completion.
  - Verification: Final Spec review and release sign-off checklist.
  - Requirements: All requirements
  - Design: Entire design document
