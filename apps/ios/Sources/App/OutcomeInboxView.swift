import SwiftUI

private enum OutcomeDestination: Hashable {
  case all, outcome(String), decision(String), human(String)
}

struct OutcomeInboxView: View {
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  let initialTarget: OutcomeLinkTarget?
  var onUnsupported: () -> Void
  @State private var path: [OutcomeDestination] = []
  @State private var initialNavigationApplied = false
  @State private var items: [OutcomeInboxItem] = []
  @State private var category: String?
  @State private var cursor: String?
  @State private var loading = false
  @State private var loaded = false
  @State private var unavailable = false
  @State private var failedMore = false
  @State private var failure: String?

  var body: some View {
    NavigationStack(path: $path) {
    NativeList {
      Section {
        NavigationLink("All outcomes", value: OutcomeDestination.all)
        Picker("Category", selection: $category) {
          Text("All categories").tag(Optional<String>.none)
          ForEach(["decision_pending", "acceptance_pending", "human_action_pending", "completed"], id: \.self) { key in
            Text(outcomeCategory(key)).tag(Optional(key))
          }
        }.disabled(loading)
      }
      Section {
        ForEach(items) { item in
          NavigationLink(value: destination(item)) {
            VStack(alignment: .leading, spacing: 8) {
              Text(item.title).font(.headline)
              Text(outcomeCategory(item.category)).font(.subheadline)
              OutcomeSummaryLines(completed: item.completed, problem: item.problem, next: item.next)
              if ["acceptance_pending", "human_action_pending"].contains(item.category) { outcomeHumanDesktopNotice }
            }
          }.accessibilityIdentifier("outcome-inbox-\(item.id)")
        }
        if loading { ProgressView() }
        if unavailable { Text("Outcome Inbox is unavailable on this server.") }
        if loaded && items.isEmpty { Text("No inbox items") }
        if let failure {
          if !items.isEmpty { Text("Showing the last loaded items. They may be outdated.") }
          InlineFailure(message: failure) { Task { await load(more: failedMore) } }
        }
        if cursor != nil && failure == nil {
          Button("Load more") { Task { await load(more: true) } }.disabled(loading)
        }
      }
    }
    .navigationTitle("Outcome Inbox")
    .navigationBarTitleDisplayMode(.inline)
    .navigationDestination(for: OutcomeDestination.self) { destination in
      switch destination {
      case .all: OutcomesView(onUnsupported: onUnsupported)
      case .outcome(let id): OutcomeDetailView(id: id)
      case .decision(let id): OutcomeDecisionView(id: id)
      case .human(let id): OutcomeHumanActionView(id: id)
      }
    }
    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
    .refreshable { await load() }
    .task(id: category) {
      items = []; cursor = nil; loaded = false
      if path.isEmpty && (initialTarget == nil || initialNavigationApplied) { await load() }
    }
    .onChange(of: path) { _, value in
      if value.isEmpty { Task { await load() } }
    }
    .task(id: initialTarget) {
      if let id = initialTarget?.decisionId { path = [.decision(id)] }
      else if let id = initialTarget?.outcomeId { path = [.outcome(id)] }
      initialNavigationApplied = true
    }
    }
  }

  private func destination(_ item: OutcomeInboxItem) -> OutcomeDestination {
    if item.category == "decision_pending", let id = item.decisionId { return .decision(id) }
    if item.category == "human_action_pending", let id = item.workItemId { return .human(id) }
    return .outcome(item.outcomeId)
  }
  private func load(more: Bool = false) async {
    guard !loading else { return }
    loading = true; failure = nil; failedMore = more
    defer { loading = false }
    do {
      guard let page = try await store.outcomeInbox(category: category, cursor: more ? cursor : nil) else {
        unavailable = true; return
      }
      unavailable = false; loaded = true
      if more {
        var ids = Set(items.map(\.id))
        items += page.items.filter { ids.insert($0.id).inserted }
      } else { items = page.items }
      cursor = page.nextCursor
    } catch {
      if (error as? APIError)?.unauthorized == true { items = [] }
      if !UserFacingError.isCancelled(error) { failure = UserFacingError.message(error) }
    }
  }
}

private struct OutcomeDecisionView: View {
  @Environment(AppStore.self) private var store
  let id: String
  @State private var decision: OutcomeDecision?
  @State private var draft = OutcomeDecisionDraft()
  @State private var loading = false
  @State private var resolving = false
  @State private var conflict = false
  @State private var expired = false
  @State private var failure: String?
  @State private var retryResolve = false
  @State private var resolution: OutcomeDecisionResolution?

  var body: some View {
    NativeList {
      if loading || resolving { ProgressView() }
      if let failure { InlineFailure(message: failure) { Task { if retryResolve { await resolve() } else { await load() } } } }
      if conflict { Text("The decision changed. The current card was refreshed; your choice is kept.") }
      if expired { Text("This decision has expired. Please view the current outcome.") }
      if let result = resolution {
        Section {
          Text("Decision resolved").font(.headline)
          Text(outcomeResume(result.resume.status))
          NavigationLink("View outcome") { OutcomeDetailView(id: result.outcomeId) }
        }
      }
      if let value = decision {
        Section {
          OutcomeSummaryLines(completed: value.completedSummary, problem: value.problemSummary, next: value.nextStepSummary)
          Text(outcomeDecisionStatus(resolution == nil ? value.status : "resolved"))
          if let recommendation = value.recommendation { Text("Recommendation: \(recommendation.reason)") }
          if let expiry = value.expiresAt { Text("Expires: \(expiry)") }
        }
        if !value.canResolve {
          Section {
            Text("This decision is no longer open. View the current outcome.")
            if let option = value.resolvedOption { Text(option.label) }
            if let custom = value.customText { Text(custom) }
          }
        }
        Section("Options") {
          ForEach(value.options) { option in
            Button { draft.choose(option.id) } label: {
              VStack(alignment: .leading, spacing: 5) {
                HStack {
                  Text(option.label)
                  if draft.optionId == option.id { Image(systemName: "checkmark") }
                }
                Text(option.consequence).font(.subheadline)
                if option.recommended == true { Text("Recommended").font(.caption) }
                if let reason = option.reason { Text(reason).font(.caption) }
              }.frame(maxWidth: .infinity, alignment: .leading)
            }.disabled(!value.canResolve || resolving || expired || resolution != nil)
          }
          if value.customEntryAllowed {
            TextField("Custom choice", text: Binding(get: { draft.customText }, set: { draft.edit($0) }), axis: .vertical)
              .disabled(!value.canResolve || resolving || expired || resolution != nil)
            Text("Up to 4,000 characters").font(.caption).foregroundStyle(NativePalette.faint)
            if draft.optionId != nil { Text("The selected option will be submitted.") }
          }
          if let selected = draft.optionId, !value.options.contains(where: { $0.id == selected }) {
            Text("Your previous option is unavailable. Choose another option to continue.")
          }
          if value.canResolve && resolution == nil && !expired {
            Button("Submit decision") { Task { await resolve() } }
              .disabled(resolving || loading || !draft.valid(for: value))
          }
        }
        Section {
          DisclosureGroup("Details") {
            Text("Revision \(value.contractRevision)")
            NavigationLink("View outcome") { OutcomeDetailView(id: value.outcomeId) }
            if value.truncatedOptionCount > 0 { Text("Additional options were omitted by the server.") }
          }
        }
      }
    }
    .navigationTitle("Decision").navigationBarTitleDisplayMode(.inline)
    .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Refresh") { Task { await load() } }.disabled(loading || resolving) } }
    .task { await load() }
  }

  private func load() async {
    guard !loading else { return }
    loading = true; retryResolve = false
    defer { loading = false }
    do { decision = try await store.outcomeDecision(id); failure = nil }
    catch {
      if (error as? APIError)?.unauthorized == true { decision = nil }
      if !UserFacingError.isCancelled(error) { failure = UserFacingError.message(error) }
    }
  }
  private func resolve() async {
    guard let value = decision, !resolving, !loading, !expired, draft.valid(for: value) else { return }
    let input = draft.prepare(for: value)
    resolving = true; failure = nil; conflict = false
    defer { resolving = false }
    do {
      resolution = try await store.resolveOutcomeDecision(id, input: input)
      await load()
    }
    catch {
      if (error as? APIError)?.unauthorized == true { decision = nil }
      if (error as? APIError)?.status == 409 { conflict = true; await load() }
      else if (error as? APIError)?.status == 410 { expired = true; await load() }
      else if !UserFacingError.isCancelled(error) { failure = UserFacingError.message(error); retryResolve = true }
    }
  }
}

struct OutcomeHumanActionView: View {
  @Environment(AppStore.self) private var store
  let id: String
  @State private var detail: OutcomeHumanWorkItem?
  @State private var loading = false
  @State private var failure: String?

  var body: some View {
    NativeList {
      Section { outcomeHumanDesktopNotice }
      if loading { ProgressView() }
      if let failure { InlineFailure(message: failure) { Task { await load() } } }
      if let detail {
        Section { Text(outcomeHumanStatus(detail.status)) }
        Section("Receipt history") {
          ForEach((detail.receipts ?? []).sorted { $0.sequence > $1.sequence }) { receipt in
            DisclosureGroup {
              Text(receipt.submittedAt)
              Text(receipt.payload.comment)
              Text(receipt.payload.text).textSelection(.enabled)
              if let comment = receipt.reviewComment { Text(comment) }
              ForEach(Array(receipt.missingRequirements.enumerated()), id: \.offset) { _, gap in Text(gap.label) }
            } label: {
              VStack(alignment: .leading) {
                Text("Receipt \(receipt.sequence)")
                Text(outcomeHumanStatus(receipt.status))
              }
            }
          }
        }
        if let card = detail.card {
          Section {
            Text(card.title).font(.headline)
            Text(card.purpose)
            Text("Revision \(card.contractRevision)")
          }
          Section("Prerequisites") {
            ForEach(Array(card.prerequisites.enumerated()), id: \.offset) { _, item in
              Label(item.label, systemImage: item.completed ? "checkmark.circle" : "circle")
            }
          }
          Section("Steps") {
            ForEach(card.steps.sorted { $0.ordinal < $1.ordinal }) { step in
              VStack(alignment: .leading) {
                Text("\(step.ordinal). \(step.text)")
                if step.optional { Text("Optional").font(.caption) }
              }
            }
          }
          Section("Required inputs") {
            ForEach(card.inputFields) { field in
              Text(field.label)
              if field.required { Text("Required").font(.caption) }
            }
          }
          Section("Evidence requirements") {
            ForEach(Array(card.evidenceRequirements.enumerated()), id: \.offset) { _, requirement in
              Text(requirement.label)
              if requirement.required { Text("Required").font(.caption) }
            }
          }
          Section {
            DisclosureGroup("References") {
              ForEach(card.references) { reference in
                DisclosureGroup(reference.title) {
                  Text(reference.version)
                  Text(reference.sourceRef).textSelection(.enabled)
                  Text(reference.permissionSummary)
                  if reference.stale { Text("This reference is outdated.") }
                  if let excerpt = reference.excerpt { Text(excerpt) }
                }
              }
            }
          }
          if let draft = card.draft {
            Section("Saved Desktop progress") { Text(draft.draftSummary); Text(draft.reason) }
          }
        } else { Text("No human action card is available.") }
      }
    }
    .navigationTitle(detail?.title ?? String(localized: "Human action"))
    .navigationBarTitleDisplayMode(.inline)
    .refreshable { await load() }
    .task { await load() }
  }
  private func load() async {
    guard !loading else { return }
    loading = true; failure = nil
    defer { loading = false }
    do { detail = try await store.fetch("/api/v0/work-items/\(API.segment(id))", as: OutcomeHumanWorkItem.self) }
    catch {
      if (error as? APIError)?.unauthorized == true { detail = nil }
      if !UserFacingError.isCancelled(error) { failure = UserFacingError.message(error) }
    }
  }
}

private struct OutcomeSummaryLines: View {
  let completed: String
  let problem: String
  let next: String
  var body: some View {
    Text("Completed: \(completed)")
    if problem.isEmpty { Text("Problem: No unresolved issues") } else { Text("Problem: \(problem)") }
    Text("Next: \(next)")
  }
}
private var outcomeHumanDesktopNotice: some View {
  Text("Start, pause, receipts and review: please complete on Desktop.")
    .font(.subheadline).foregroundStyle(NativePalette.muted)
}
private func outcomeCategory(_ value: String) -> LocalizedStringKey {
  switch value {
  case "decision_pending": "Pending decision"
  case "acceptance_pending": "Pending review"
  case "human_action_pending": "Pending human action"
  case "completed": "Completed"
  default: "Outcome update"
  }
}
private func outcomeDecisionStatus(_ value: String) -> LocalizedStringKey {
  switch value {
  case "open", "presented": "Awaiting your decision"
  case "resolved": "Decision resolved"
  case "expired": "Decision expired"
  case "withdrawn": "Replaced by a newer state"
  default: "Unknown status"
  }
}
private func outcomeHumanStatus(_ value: String) -> LocalizedStringKey {
  switch value {
  case "pending": "Pending"
  case "ready": "Ready"
  case "in_progress": "In progress"
  case "paused": "Paused"
  case "submitted": "Submitted"
  case "review_pending": "Pending review"
  case "accepted": "Accepted"
  case "rejected": "Rejected"
  case "cancelled": "Cancelled"
  default: "Unknown status"
  }
}
private func outcomeResume(_ value: String) -> LocalizedStringKey {
  switch value {
  case "enqueued", "queued_for_capacity": "The task is queued to continue."
  case "pending_approval": "A new revision needs approval on Desktop."
  case "waiting_human": "A human action is required on Desktop."
  case "cancelled": "The branch was cancelled."
  default: "View the outcome for its current state."
  }
}
