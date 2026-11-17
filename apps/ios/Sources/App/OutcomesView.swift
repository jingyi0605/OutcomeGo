import SwiftUI

struct OutcomesView: View {
  var onUnsupported: () -> Void
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var items: [OutcomeSummary] = []
  @State private var cursor: String?
  @State private var loading = false
  @State private var loaded = false
  @State private var failedMore = false
  @State private var failure: String?

  var body: some View {
    NativeList {
      Section { outcomeDesktopNotice }
      Section {
        ForEach(items) { outcome in
          NavigationLink {
            OutcomeDetailView(id: outcome.id)
          } label: {
            VStack(alignment: .leading, spacing: 5) {
              Text(outcome.title).font(.headline)
              Text(outcomeStatus(outcome.status)).foregroundStyle(NativePalette.muted)
              Text("Updated: \(outcome.updatedAt)").font(.caption).foregroundStyle(NativePalette.faint)
            }
          }.accessibilityIdentifier("outcome-\(outcome.id)")
        }
        if loading { ProgressView() }
        if loaded && items.isEmpty { Text("No outcomes yet") }
        if let failure { InlineFailure(message: failure) { Task { await load(more: failedMore) } } }
        if cursor != nil && failure == nil {
          Button("Load more") { Task { await load(more: true) } }.disabled(loading)
        }
      }
    }
    .navigationTitle("Outcomes")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
    .refreshable { await load() }
    .task(id: store.api?.resourceGeneration) {
      items = []; cursor = nil; loaded = false
      await load()
    }
  }

  private func load(more: Bool = false) async {
    guard !loading else { return }
    loading = true
    failure = nil
    failedMore = more
    defer { loading = false }
    do {
      guard let page = try await store.listOutcomes(cursor: more ? cursor : nil) else {
        onUnsupported()
        return
      }
      if more {
        var ids = Set(items.map(\.id))
        items += page.items.filter { ids.insert($0.id).inserted }
      } else { items = page.items }
      cursor = page.nextCursor
      loaded = true
    } catch {
      if !UserFacingError.isCancelled(error) { failure = UserFacingError.message(error) }
    }
  }
}

private struct OutcomeDetailView: View {
  @Environment(AppStore.self) private var store
  let id: String
  @State private var detail: OutcomeDetail?
  @State private var loading = false
  @State private var failure: String?

  var body: some View {
    NativeList {
      Section { outcomeDesktopNotice }
      if loading { ProgressView() }
      if let failure { InlineFailure(message: failure) { Task { await load() } } }
      if let value = detail {
        Section {
          Text(outcomeStatus(value.status))
          Text(value.description)
          Text("Current revision: \(value.currentRevision.map(String.init) ?? "—")")
          Text("Updated: \(value.updatedAt)")
          ForEach(value.currentRevisionView?.goal ?? [], id: \.self) { Text($0) }
        }
        Section("Work items") {
          ForEach(value.workItems.sorted { $0.ordinal < $1.ordinal }) { item in
            VStack(alignment: .leading, spacing: 5) {
              Text(item.title).font(.headline)
              Text(outcomeStatus(item.status))
              Text("Revision \(item.contractRevision)").font(.caption)
              if let reason = item.statusReason { Text(reason) }
            }
          }
        }
        Section("Outputs") {
          ForEach(value.outputs) { output in
            VStack(alignment: .leading, spacing: 5) {
              Text(output.title).font(.headline)
              if let content = output.content { Text(content).textSelection(.enabled) }
              if let reference = output.contentRef { Text(reference).textSelection(.enabled) }
            }
          }
        }
        Section("Acceptance results") {
          ForEach((value.currentRevisionView?.criteria ?? []).sorted { $0.ordinal < $1.ordinal }) { criterion in
            VStack(alignment: .leading, spacing: 5) {
              Text(criterion.statement).font(.headline)
              Text(criterion.required ? LocalizedStringKey("Required") : LocalizedStringKey("Optional"))
              Text(outcomeStatus(criterion.latestResult))
              ForEach(value.reviews.filter {
                $0.criterionId == criterion.id && $0.contractRevision == value.currentRevision
              }.sorted { $0.sequence > $1.sequence }) { review in
                Text(outcomeStatus(review.result))
                Text(review.comment)
                Text(review.reviewedAt).font(.caption)
                ForEach(value.evidence.filter { review.evidenceIds.contains($0.id) }) { evidence in
                  Text(evidence.contentSummary)
                  Text(evidence.sourceRef).font(.caption).textSelection(.enabled)
                }
              }
            }
          }
        }
      }
    }
    .navigationTitle(detail?.title ?? String(localized: "Outcome"))
    .navigationBarTitleDisplayMode(.inline)
    .refreshable { await load() }
    .task(id: store.api?.resourceGeneration) { detail = nil; await load() }
  }

  private func load() async {
    guard !loading else { return }
    loading = true
    failure = nil
    defer { loading = false }
    do { detail = try await store.fetch("/api/v0/outcomes/\(API.segment(id))", as: OutcomeDetail.self) }
    catch { if !UserFacingError.isCancelled(error) { failure = UserFacingError.message(error) } }
  }
}

private var outcomeDesktopNotice: some View {
  Text("Planning, approval, acceptance and rework: please complete on Desktop.")
    .font(.subheadline).foregroundStyle(NativePalette.muted)
}

private func outcomeStatus(_ value: String?) -> LocalizedStringKey {
  switch value {
  case "draft": "Draft"
  case "planning": "Planning"
  case "pending_approval": "Pending approval"
  case "approved": "Approved"
  case "queued": "Queued"
  case "running": "Running"
  case "completed": "Completed"
  case "review_pending", "needs_review": "Pending review"
  case "decision_pending", "waiting_decision": "Pending decision"
  case "human_action_pending", "waiting_human": "Pending human action"
  case "accepted": "Accepted"
  case "failed": "Failed"
  case "cancelled": "Cancelled"
  case "paused": "Paused"
  case "pending": "Pending"
  case "ready": "Ready"
  case "in_progress": "In progress"
  case "submitted": "Submitted"
  case "rejected": "Rejected"
  case "retry_pending": "Pending retry"
  case "PASS": "Pass"
  case "FAIL": "Fail"
  case "UNVERIFIED", nil: "Unverified"
  case "WAIVED_BY_APPROVED_CHANGE": "Waived by approved change"
  default: "Unknown status"
  }
}
