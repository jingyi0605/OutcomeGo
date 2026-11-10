# Design: Kotlin Multiplatform Mobile Core and Android Client

Status: Draft

## 1. Overview

### 1.1 Goals

- Add an Android client without a second independent mobile synchronization
  implementation.
- Move mobile protocol, state, and domain behavior into a Kotlin Multiplatform
  core.
- Preserve the existing SwiftUI iOS presentation and native integrations.
- Reproduce the complete user-visible iOS feature surface with native Android
  workflows.
- Make Android push delivery an explicit server and client contract.
- Establish fixtures and tests that detect drift between mobile clients and the
  TypeScript server.

### 1.2 Covered requirements

- `requirements.md` Requirements 1-5

### 1.3 Technical constraints

- Server: existing TypeScript OpenTeam server and `/api/auth` plus `/api/v0`.
- Existing iOS: Swift 6, SwiftUI, Swift Package Manager, iOS 18 target.
- Android: Kotlin, Gradle, Jetpack Compose, Android Keystore, and WorkManager
  as needed.
- Shared core: Kotlin Multiplatform common code compiled for Android and iOS.
- Existing TypeScript clients remain in place.
- Persistence uses shared repositories with platform storage adapters.
- Authentication remains the existing OpenTeam bearer-token flow.
- External push systems are APNs for iOS and FCM for Android.
- Android feature parity is measured against the current iOS source, tests,
  schemes, extensions, and product documentation.

## 2. Architecture

### 2.1 System structure

```text
OpenTeam server
  ├── /api/auth/*
  ├── /api/v0/client-bootstrap
  ├── /api/v0/events
  ├── /api/v0/events/poll
  ├── /api/v0/channels/*
  ├── /api/v0/conversations/*
  ├── /api/v0/assets/*
  └── /api/v0/notification-devices

Kotlin Multiplatform mobile core
  ├── transport and auth
  ├── typed models
  ├── repositories and persistence interfaces
  ├── event synchronization
  ├── delivery journal
  ├── local projections
  └── platform interfaces

Native iOS
  ├── existing SwiftUI views
  ├── App Intents and Siri
  ├── share extension
  ├── APNs and notification extension
  ├── Keychain adapter
  └── Swift observation adapter

Native Android
  ├── Jetpack Compose screens
  ├── FCM and notification channels
  ├── share target and App Links
  ├── Keystore adapter
  ├── WorkManager adapter
  └── Android lifecycle adapter
```

The Shared Core owns server-facing state and behavior. Platform clients render
that state and provide operating-system services through interfaces.

### 2.2 Module responsibilities

| Module | Responsibility | Input | Output |
| --- | --- | --- | --- |
| `mobile-core:transport` | HTTP requests, auth headers, response/error decoding | URL, token, request | typed response or error |
| `mobile-core:models` | Serializable request, response, and event models | JSON payloads | Kotlin data classes |
| `mobile-core:auth` | Session lifecycle and server validation | credentials, secure storage | session state |
| `mobile-core:sync` | Bootstrap, event cursor, reconnect, projections | responses, cursor | state flows and cursor |
| `mobile-core:delivery` | Optimistic sends and reconciliation | message input, delivery status | stable message state |
| `mobile-core:repository` | Account, directory, message, and draft access | state mutations | cached projections |
| `mobile-core:platform` | Interfaces for storage, clock, persistence, lifecycle | platform implementation | common service behavior |
| `apps/ios` | SwiftUI presentation and iOS integrations | shared state and commands | iOS UI and actions |
| `apps/android` | Compose presentation and Android integrations | shared state and commands | Android UI and actions |

A likely repository layout is:

```text
mobile/
  shared/
    build.gradle.kts
    src/commonMain/
    src/androidMain/
    src/iosMain/
  androidApp/
```

The shared module may instead live under `packages/mobile-kmp`. It must remain
clearly separate from the existing TypeScript `packages/client-core`.

### 2.3 Key flows

#### 2.3.1 Authentication and bootstrap

1. Platform UI collects server address and credentials.
2. Shared Core normalizes the address and calls the existing auth endpoint.
3. Secure-storage adapter persists the session token.
4. Shared Core requests `/api/v0/client-bootstrap`.
5. Repository stores the bootstrap projection and event cursor.
6. Platform UI observes the directory and opens the authenticated shell.

#### 2.3.2 Event synchronization

1. Shared Core reads the durable cursor.
2. It requests `/api/v0/events?after=<cursor>` through SSE when supported.
3. It uses `/api/v0/events/poll` when long polling is selected or required.
4. Each event is validated, deduplicated, applied, and then advances the cursor.
5. Cursor is persisted before the event is considered completed locally.
6. Disconnect triggers bounded retry from the last durable cursor.
7. Invalid or expired cursors trigger bounded bootstrap recovery.

#### 2.3.3 Message delivery

1. Platform UI creates a Delivery Nonce.
2. Shared Core inserts an optimistic user message.
3. API sends the message with the nonce.
4. Shared Core merges the authoritative response by nonce and server ID.
5. Ambiguous responses trigger delivery-status lookup before retry.
6. UI displays accepted, pending, rejected, or unknown durability state.

#### 2.3.4 Android push registration

1. Android obtains an FCM token through a platform adapter.
2. Adapter creates an installation ID and reports token changes.
3. Shared Core sends a provider-aware registration request.
4. Server validates the Android provider and persists the device.
5. Android notification handler maps the payload to an account-scoped deep link.

The current server accepts APNs/iOS registration only. FCM requires a separate
contract and delivery implementation.

### 2.4 Feature parity rule

The Android implementation is complete only when every feature in the parity
inventory has one of the following outcomes:

1. implemented with the same server behavior and equivalent Android UX;
2. implemented through an Android-native system integration with the same
   user-visible result; or
3. explicitly accepted as unavailable on Android with a documented product
   decision and a corresponding server or platform limitation.

The inventory is maintained in
`docs/feature-parity-matrix.md`. A feature is not complete merely because its
main screen exists; its data flow, empty state, error state, lifecycle behavior,
accessibility behavior, and relevant tests must also be covered.

## 3. Components and interfaces

### 3.1 Core components

- `OpenTeamTransport`: authenticated HTTP requests and error mapping.
- `OpenTeamAuth`: sign-in, sign-out, server validation, and expiry.
- `OpenTeamApi`: supported mobile endpoint surface.
- `MobileRepository`: cached account, directory, message, and draft state.
- `EventSynchronizer`: event cursor and reconnection.
- `DeliveryJournal`: optimistic sends indexed by Delivery Nonce.
- `PlatformServices`: secure storage, clock, persistence, and lifecycle.
- `MobileState`: immutable snapshots and observable state for each UI.

### 3.2 Data structures

#### 3.2.1 `Session`

| Field | Type | Required | Description | Constraint |
| --- | --- | --- | --- | --- |
| `server` | `String` | Yes | normalized server URL | HTTP or HTTPS |
| `token` | `String` | Yes | bearer token | never log or display |
| `userId` | `String` | Yes | authenticated user | non-empty |
| `createdAt` | `Instant` | Yes | creation time | UTC |
| `expiresAt` | `Instant?` | No | known expiry | optional |

#### 3.2.2 `ClientCursor`

| Field | Type | Required | Description | Constraint |
| --- | --- | --- | --- | --- |
| `accountKey` | `String` | Yes | server and account identity | account-scoped |
| `sequence` | `String` | Yes | last accepted event sequence | decimal string |
| `updatedAt` | `Instant` | Yes | durable update time | UTC |

#### 3.2.3 `DeliveryRecord`

| Field | Type | Required | Description | Constraint |
| --- | --- | --- | --- | --- |
| `clientId` | `String` | Yes | Delivery Nonce | stable per send |
| `channelId` | `String` | Yes | target channel | non-empty |
| `status` | `DeliveryStatus` | Yes | current state | known enum |
| `messageId` | `String?` | No | authoritative message ID | set after acceptance |
| `createdAt` | `Instant` | Yes | local creation time | UTC |
| `updatedAt` | `Instant` | Yes | last state change | UTC |

### 3.3 Interface contracts

#### 3.3.1 `OpenTeamApi.bootstrap`

- Type: HTTP
- Path: `GET /api/v0/client-bootstrap`
- Input: authenticated session
- Output: typed bootstrap view and initial cursor
- Validation: bearer token required
- Errors: unauthorized, incompatible response, transport failure

#### 3.3.2 `OpenTeamApi.events`

- Type: SSE or long poll
- Paths: `GET /api/v0/events?after=<cursor>` and
  `GET /api/v0/events/poll?after=<cursor>&waitMs=<value>`
- Input: authenticated session and decimal event cursor
- Output: ordered product events
- Validation: cursor is decimal or reset to `0`
- Errors: unauthorized, invalid cursor, timeout, network failure

#### 3.3.3 `OpenTeamApi.sendMessage`

- Type: HTTP
- Paths: `POST /api/v0/channels/{channelId}/messages` and
  `POST /api/v0/conversations/{conversationId}/messages`
- Input: content, client ID, attachments, reply target, time zone
- Output: authoritative message or delivery result
- Validation: server-side message and attachment limits
- Errors: unauthorized, validation failure, rejection, unknown durability

#### 3.3.4 `OpenTeamApi.registerPushDevice`

- Type: HTTP
- Path: `POST /api/v0/notification-devices`
- Input: installation ID, platform, provider, token, provider settings
- Output: registered device view
- Validation: provider must match platform
- Errors: unauthorized, unsupported provider, invalid token, auth mode changed

The Android FCM request shape must be finalized before implementation. Existing
APNs fields must remain backward-compatible.

## 4. Data and state model

### 4.1 Data relationships

```text
Account
  ├── Session
  ├── ClientCursor
  ├── Bot[]
  ├── Channel[]
  ├── Message[]
  ├── DeliveryRecord[]
  └── DeviceRegistration[]
```

All cached data is scoped by normalized server and authenticated account. A
session change must not expose the previous account's state.

### 4.2 State transitions

| State | Meaning | Entry condition | Exit condition |
| --- | --- | --- | --- |
| `SIGNED_OUT` | no usable session | first launch or sign-out | sign-in succeeds |
| `AUTHENTICATING` | credentials are checked | user submits credentials | success or error |
| `BOOTSTRAPPING` | initial projection loads | session is valid | bootstrap success or error |
| `SYNCING` | event cursor is connected | bootstrap completes | disconnect or sign-out |
| `RECONNECTING` | event connection retries | stream/network failure | restored or exhausted |
| `SESSION_EXPIRED` | server rejected credentials | 401 response | reauthentication |
| `SEND_PENDING` | optimistic send awaits authority | user submits message | accepted or rejected |
| `SEND_ACCEPTED` | server accepted message | response or event | stable message state |
| `SEND_REJECTED` | server rejected message | error response | retry or dismissal |

## 5. Error handling

### 5.1 Error types

- `InvalidServerUrl`
- `Unauthorized`
- `TransportUnavailable`
- `ContractDecodeFailure`
- `ValidationFailure`
- `DeliveryUnknown`
- `LocalStateCorrupt`
- `UnsupportedPlatformFeature`

### 5.2 Error response format

```json
{
  "code": "delivery_unknown",
  "message": "The server did not confirm whether this message was accepted.",
  "status": 0,
  "retryable": true,
  "requestId": null
}
```

Existing server error fields remain authoritative. Local classification fields
may be added while preserving the original status, code, and message.

### 5.3 Handling strategy

1. Reject input validation errors before the request.
2. Stop authenticated work on unauthorized responses and require sign-in.
3. Record endpoint and model context for contract errors.
4. Retain cached state and retry only operations marked retryable.
5. Query delivery status before retrying unknown sends.
6. Quarantine corrupt account cache and rebuild from bootstrap.

## 6. Correctness properties

### 6.1 Cursor durability

For every accepted event, the durable cursor must be at least the event's
sequence before the synchronizer considers the event complete. Replay must not
create duplicate logical state.

**Validation requirement:** Requirement 3.

### 6.2 Delivery idempotency

For any responses or events referring to the same Delivery Nonce, the local
projection contains at most one logical user message and converges to the
server state.

**Validation requirement:** Requirement 3.

### 6.3 Account isolation

After an account switch or sign-out, the active repository cannot return state
loaded under the previous server and account identity.

**Validation requirement:** Requirements 3 and 4.

### 6.4 Platform boundary

Common code accesses operating-system APIs only through declared interfaces and
builds without UIKit, SwiftUI, Android UI, or Android application classes.

**Validation requirement:** Requirements 1 and 5.

## 7. Test strategy

### 7.1 Unit tests

- URL normalization and authentication transitions
- JSON decoding and error mapping
- Event ordering, duplicates, and cursor updates
- Reconnection decisions
- Message merge and delivery reconciliation
- Pagination and thread projection
- Account isolation
- Fake secure storage and clock behavior

### 7.2 Integration tests

- Shared core against the existing parity server
- Bootstrap followed by event replay
- Network interruption and cursor recovery
- Optimistic send followed by delayed confirmation
- iOS framework consumption from a Swift test target
- Android repository consumption from a Compose screen

### 7.3 End-to-end tests

- Android sign-in, bootstrap, history, event sync, and send
- iOS regression path using the shared core
- Android process death and restart
- Android notification deep link after FCM support
- Existing iOS APNs, share extension, Siri, and sign-out flows

### 7.4 Verification mapping

| Requirement | Design sections | Verification |
| --- | --- | --- |
| Requirement 1 | §2.1, §2.2, §6.4 | target builds and dependency checks |
| Requirement 2 | §3.2, §3.3, §5.2 | fixtures, decoding, server integration |
| Requirement 3 | §2.3, §4.2, §6.1, §6.2 | sync, replay, reconnect, delivery tests |
| Requirement 4 | §2.1, §2.3, §7.3 | Android emulator acceptance flow |
| Requirement 5 | §2.2, §3.1, §6.4 | platform adapter and push contract tests |

## 8. Risks and open questions

### 8.1 Risks

- KMP adds Gradle alongside Bun and Xcode.
- Complex Kotlin APIs may be awkward for Swift callers.
- Porting existing TypeScript and Swift contracts may reveal hidden differences.
- Replacing iOS persistence too early could create migration risk.
- Android push requires server credentials, payload design, and delivery tests.

### 8.2 Open questions

- Should mobile contracts use OpenAPI/JSON Schema or fixture-based parity?
- Which shared database technology fits iOS framework integration?
- Should iOS migration start behind a repository facade or replace API/models
  incrementally?
- What Android minimum SDK and device range are required?
- Which Android features are required for the first public release?
- Should FCM use direct credentials or an existing server provider abstraction?
- What Android-native equivalent should be used for each Siri, Spotlight, and
  Shortcuts capability?
- Which iOS visual and motion details must be matched exactly, and which may use
  Android platform conventions?
