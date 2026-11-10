# Requirements: Kotlin Multiplatform Mobile Core and Android Client

Status: Draft

## Introduction

OpenTeam currently has a native SwiftUI iOS client and TypeScript desktop/web
clients. The repository has no Android client. The iOS client and the
TypeScript clients maintain separate implementations of transport, models,
session state, synchronization, and local client behavior.

The goal is to add an Android client while reducing future drift between the
mobile platforms. A Kotlin Multiplatform shared core should own behavior that
is independent of the user interface and operating system. SwiftUI remains the
iOS presentation layer, and Jetpack Compose provides the Android presentation
layer.

The implementation must establish a reliable mobile foundation and then deliver
equivalent Android capabilities for the current iOS product. Equivalent means
the same user-visible outcome and server behavior; platform-specific entry
points may use the native Android equivalent.

## Terminology

- **System**: OpenTeam server, iOS client, Android client, and their shared
  mobile core.
- **Shared Core**: Kotlin Multiplatform code compiled for Android and iOS.
- **Mobile API**: The typed client boundary for OpenTeam authentication, REST
  resources, events, assets, and message delivery.
- **Projection**: Client-readable state derived from bootstrap data, events, and
  local mutations.
- **Platform Adapter**: An iOS or Android implementation of an operating-system
  service.
- **Delivery Nonce**: The stable client ID used to reconcile an optimistic send
  with server acceptance or rejection.

## Scope

### In Scope

- Establish a Kotlin Multiplatform shared mobile module.
- Define shared mobile models, transport, authentication, and error handling.
- Implement bootstrap, event synchronization, history pagination, and message
  delivery reconciliation.
- Provide Android integration with Kotlin and Jetpack Compose.
- Provide an incremental iOS integration boundary that preserves the existing
  SwiftUI UI.
- Define adapters for secure storage, persistence, push notifications,
  lifecycle, and share/deep-link actions.
- Implement Android equivalents for all user-facing iOS capabilities, including
  messaging, attachments, rich messages, routines, settings, provider setup,
  plugin workflows, voice, computer/VNC controls, notifications, system
  actions, and account discovery.
- Reproduce the iOS acceptance, reliability, accessibility, and performance
  coverage on Android where the platform provides an equivalent.
- Add shared fixtures and tests for mobile protocol behavior.

### Out of Scope

- Replacing the existing SwiftUI interface with Compose Multiplatform.
- Rewriting the TypeScript server or desktop client in Kotlin.
- A complete visual redesign of either mobile client.
- Changing server product semantics solely to make the Android UI different.

## Requirements

### Requirement 1: Shared mobile core boundary

**User story:** As a mobile maintainer, I want platform-independent mobile
behavior in one Kotlin module so that Android and iOS do not independently
reimplement the same protocol and state logic.

#### Acceptance criteria

1. WHEN the shared module is built for Android and iOS THEN System SHALL compile
   the common source set for both targets.
2. WHEN a mobile feature does not require an operating-system API THEN System
   SHALL implement its behavior in the Shared Core.
3. WHEN a feature requires Keychain, Keystore, APNs, FCM, lifecycle, audio, or
   share APIs THEN System SHALL access it through an explicit Platform Adapter.
4. WHEN a shared API is exposed to Swift THEN System SHALL provide a stable,
   documented Swift-facing boundary.

### Requirement 2: Mobile API and contract consistency

**User story:** As a client developer, I want typed request and response models
for the OpenTeam server so that Android and iOS handle the same payloads and
errors.

#### Acceptance criteria

1. WHEN a mobile client calls a supported endpoint THEN System SHALL use a typed
   request or response model.
2. WHEN the server returns a structured error THEN System SHALL preserve its
   status, error code, and user-facing message.
3. WHEN a response contains an unknown optional field THEN System SHALL decode
   the response without failing the whole request.
4. WHEN a required field or known enum value is incompatible THEN System SHALL
   report a contract error with diagnostic context.
5. WHEN a server contract changes THEN System SHALL update mobile fixtures and
   compatibility checks before the change is complete.

### Requirement 3: Synchronization and delivery

**User story:** As a mobile user, I want conversations and sends to remain
consistent across devices even when the network is interrupted.

#### Acceptance criteria

1. WHEN a mobile session starts THEN System SHALL restore local state and
   bootstrap the authoritative server projection.
2. WHEN events are available THEN System SHALL consume them from the stored
   cursor and advance the cursor only after accepting each event.
3. WHEN SSE is unavailable or unsuitable THEN System SHALL support long polling.
4. WHEN the connection is interrupted THEN System SHALL reconnect with bounded
   backoff from the last durable cursor.
5. WHEN a message is sent optimistically THEN System SHALL reconcile its Delivery
   Nonce with accepted, rejected, pending, or unknown durability state.
6. WHEN an event or response is received more than once THEN System SHALL keep
   one logical message and one logical state transition.
7. WHEN history is paginated THEN System SHALL preserve sequence order, thread
   context, and server pagination boundaries.

### Requirement 4: Native Android client foundation

**User story:** As an Android user, I want a native Android application that
can sign in, browse conversations, receive updates, and send messages.

#### Acceptance criteria

1. WHEN the Android app is launched for the first time THEN System SHALL allow
   server configuration and sign-in.
2. WHEN authentication succeeds THEN System SHALL display the bot and channel
   directory from shared bootstrap state.
3. WHEN a channel is opened THEN System SHALL display paginated history and
   thread context.
4. WHEN the user sends a message THEN System SHALL show optimistic state,
   final delivery state, and actionable errors.
5. WHEN the app is relaunched THEN System SHALL restore the last valid session
   without exposing tokens in logs or UI.
6. WHEN the server is unreachable THEN System SHALL show cached state where
   available and explain whether retry or reauthentication is required.

### Requirement 5: Platform feature boundaries

**User story:** As a product maintainer, I want platform-specific behavior to
remain explicit so that shared code does not become coupled to one operating
system.

#### Acceptance criteria

1. WHEN a platform feature is introduced THEN System SHALL identify shared state
   and platform implementation separately.
2. WHEN push registration is implemented THEN System SHALL support distinct APNs
   and FCM provider contracts.
3. WHEN a notification is received in the foreground THEN System SHALL apply
   shared notification semantics through platform-specific presentation.
4. WHEN Android share intents, App Links, or background work are added THEN
   System SHALL keep Android entry points outside the shared UI layer.
5. WHEN an iOS App Intent, share extension, or Keychain operation changes THEN
   System SHALL preserve existing iOS behavior unless its requirement changes.

### Requirement 6: Complete Android capability parity

**User story:** As an OpenTeam user, I want the Android client to provide the
same product capabilities as the iOS client so that changing mobile platforms
does not remove workflows I rely on.

#### Acceptance criteria

1. WHEN a capability is available in the iOS product THEN System SHALL provide
   an Android workflow with the same supported server behavior or a documented
   Android-native equivalent.
2. WHEN the capability is a mobile data or synchronization behavior THEN System
   SHALL use the Shared Core rather than an Android-only implementation.
3. WHEN the capability is an operating-system integration THEN System SHALL
   provide the closest supported Android equivalent and document any platform
   limitation.
4. WHEN a feature has existing iOS acceptance coverage THEN System SHALL add an
   Android acceptance case before parity is marked complete.
5. WHEN a feature cannot be implemented because the server lacks a required
   contract THEN System SHALL record the server change as an explicit task and
   keep the Android feature incomplete until that task is verified.

### Requirement 7: Production parity and release readiness

**User story:** As a release owner, I want the Android client to be testable,
observable, and releasable at the same quality level as the iOS client.

#### Acceptance criteria

1. WHEN Android is built for release THEN System SHALL produce a signed,
   reproducible artifact through documented CI or release commands.
2. WHEN a primary Android workflow fails THEN System SHALL provide actionable
   diagnostics without logging credentials, message secrets, or private files.
3. WHEN the Android app is tested across supported screen sizes and lifecycle
   states THEN System SHALL preserve drafts, sessions, delivery state, and
   account isolation.
4. WHEN a parity feature is marked complete THEN System SHALL have unit,
   integration, UI, or manual evidence appropriate to its risk.
5. WHEN an Android release is deployed THEN System SHALL support staged rollout,
   rollback, and compatibility communication for older OpenTeam servers.

## Non-functional requirements

### Performance

1. Initial directory state SHALL not wait for the full history of every channel.
2. Large histories SHALL be bounded in memory and loaded on demand.
3. Event bursts SHALL be batched where possible without changing event order.

### Reliability

1. Network failure SHALL retain the last durable cursor and avoid duplicate sends.
2. Session expiry SHALL stop authenticated retries and require reauthentication.
3. Corrupt local state SHALL be isolated and rebuilt without deleting unrelated
   account data.

### Maintainability

1. Shared behavior SHALL have one implementation and shared tests for both mobile
   targets.
2. Platform services SHALL be injectable and testable through fakes.
3. Contract changes SHALL update fixtures, models, and compatibility tests
   together.

## Success definition

- A Kotlin Multiplatform shared module builds for Android and iOS.
- Android implements every user-facing capability currently provided by the iOS
  client, with documented Android-native substitutions where necessary.
- Existing iOS can consume the shared core behind a controlled adapter without a
  SwiftUI rewrite.
- Shared tests cover authentication, decoding, event cursors, reconnection,
  message merging, delivery reconciliation, persistence, and account isolation.
- Android has equivalent acceptance, reliability, accessibility, performance,
  and release evidence for the supported feature surface.
- Existing APNs behavior remains compatible and FCM support is implemented.
