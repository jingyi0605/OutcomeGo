# Spec: Kotlin Multiplatform Mobile Core and Android Client

Status: Draft

This Spec defines the first implementation path for an Android client and a
shared Kotlin Multiplatform mobile core.

The current iOS client remains a native SwiftUI application. The Android client
uses native Kotlin and Jetpack Compose. Kotlin Multiplatform is introduced for
mobile data, networking, synchronization, persistence abstractions, and domain
rules. Shared UI is outside this Spec.

The three main documents are:

- `requirements.md`: user needs and acceptance criteria
- `design.md`: architecture, contracts, state, errors, and validation
- `tasks.md`: executable implementation tasks and checkpoints

The Spec is intentionally Draft until the API contract, iOS integration
boundary, and Android push delivery design are confirmed.
