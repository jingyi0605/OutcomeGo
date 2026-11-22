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
  @State private var showingNew = false

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
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
      ToolbarItem(placement: .primaryAction) {
        Button { showingNew = true } label: { Image(systemName: "plus") }
          .accessibilityLabel("New outcome")
          .accessibilityIdentifier("new-outcome")
      }
    }
    .sheet(isPresented: $showingNew) {
      NavigationStack { NewOutcomeView { Task { await load() } } }
    }
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

struct OutcomeDetailView: View {
  @Environment(AppStore.self) private var store
  let id: String
  @State private var detail: OutcomeDetail?
  @State private var loading = false
  @State private var adopting = false
  @State private var failure: String?
  @State private var notice: String?

  var body: some View {
    NativeList {
      Section { outcomeDesktopNotice }
      if loading { ProgressView() }
      if let failure { InlineFailure(message: failure) { Task { await load() } } }
      if let notice { Text(notice).font(.subheadline).foregroundStyle(.green) }
      if let value = detail {
        Section {
          Text(outcomeStatus(value.status))
          Text(value.description)
          Text("Current revision: \(value.currentRevision.map(String.init) ?? "—")")
          Text("Updated: \(value.updatedAt)")
          ForEach(value.currentRevisionView?.goal ?? [], id: \.self) { Text($0) }
        }
        if let plan = value.plan {
          Section("Task plan (\(plan.tasks.count))") {
            if let notes = plan.notes, !notes.isEmpty {
              Text(notes).font(.subheadline).foregroundStyle(NativePalette.muted)
            }
            ForEach(plan.tasks, id: \.key) { task in
              VStack(alignment: .leading, spacing: 4) {
                Text("\(task.title) (\(task.key))").font(.headline)
                Text(task.nature == "deliverable" ? "Deliverable" : "Action").font(.caption)
                if let deps = task.dependsOn, !deps.isEmpty {
                  Text("After: \(deps.joined(separator: ", "))").font(.caption).foregroundStyle(NativePalette.muted)
                }
              }
            }
          }
        }
        OutcomeThreadSection(
          outcomeId: id, canSend: !["accepted", "cancelled"].contains(value.status)
        ) { Task { await load() } }
        Section("Work items") {
          ForEach(value.workItems.sorted { $0.ordinal < $1.ordinal }) { item in
            VStack(alignment: .leading, spacing: 5) {
              Text(item.title).font(.headline)
              Text(outcomeStatus(item.status))
              HStack(spacing: 8) {
                Text("Revision \(item.contractRevision)").font(.caption)
                if let nature = item.nature {
                  Text(nature == "deliverable" ? "Deliverable" : "Action").font(.caption)
                }
                if let planKey = item.planKey, !planKey.isEmpty {
                  Text(planKey).font(.caption).foregroundStyle(NativePalette.muted)
                }
              }
              if let review = item.review, review.state != "none" {
                Text(taskReviewLabel(review.state))
                  .font(.caption)
                  .foregroundStyle(review.state == "rejected_once" ? .red : NativePalette.muted)
                ForEach(Array(review.findings.enumerated()), id: \.offset) { _, finding in
                  Text("• [\(finding.kind)] \(finding.reason)")
                    .font(.caption)
                    .foregroundStyle(NativePalette.muted)
                }
              }
              if let reason = item.statusReason { Text(reason) }
              if item.executorType == "human" {
                NavigationLink("View human action") { OutcomeHumanActionView(id: item.id) }
              }
            }
          }
        }
        if let prereview = value.prereview {
          let currentRevMatch = prereview.revision == value.currentRevision
          let hasLikelyPass = prereview.results.contains { $0.suggestion == "likely_pass" }
          Section("Preliminary review (v\(prereview.revision))") {
            Text(prereview.summary).font(.subheadline)
            if !currentRevMatch {
              Text("Stale revision — prereview is from revision \(prereview.revision).")
                .font(.caption)
                .foregroundStyle(.orange)
            }
            ForEach(Array(prereview.attention.enumerated()), id: \.offset) { _, attn in
              Text("• \(attn.question)").font(.subheadline)
            }
            if hasLikelyPass && ["review_pending", "needs_review", "completed"].contains(value.status) {
              Button("Adopt likely-pass items") {
                Task { await adopt(prereview: prereview) }
              }
              .disabled(adopting || !currentRevMatch)
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
              if let pre = value.prereview?.results.first(where: { $0.criterionId == criterion.id }) {
                Text("\(prereviewSuggestionLabel(pre.suggestion)): \(pre.reason)")
                  .font(.caption)
                  .foregroundStyle(NativePalette.muted)
              }
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
    do { detail = try await store.readOutcomeDetail(id) }
    catch { if !UserFacingError.isCancelled(error) { failure = UserFacingError.message(error) } }
  }

  private func adopt(prereview: OutcomePrereview) async {
    guard !adopting else { return }
    adopting = true
    failure = nil
    notice = nil
    defer { adopting = false }
    do {
      detail = try await store.adoptOutcomePrereview(
        id,
        input: AdoptPrereviewRequest(
          expectedRevision: prereview.revision,
          turnId: prereview.turnId,
          clientRequestId: UUID().uuidString
        )
      )
      notice = "Likely-pass prereview items adopted."
    } catch {
      if !UserFacingError.isCancelled(error) { failure = UserFacingError.message(error) }
    }
  }
}

private func taskReviewLabel(_ state: String) -> String {
  switch state {
  case "rejected_once": return "Rejected once (rework queued)"
  case "unreviewed": return "Unreviewed"
  case "passed": return "Task review passed"
  default: return state
  }
}

private func prereviewSuggestionLabel(_ suggestion: String) -> String {
  switch suggestion {
  case "likely_pass": return "Likely pass"
  case "likely_fail": return "Likely fail"
  default: return "Unclear"
  }
}

private var outcomeDesktopNotice: some View {
  Text("Approval, acceptance and rework: please complete on Desktop.")
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
