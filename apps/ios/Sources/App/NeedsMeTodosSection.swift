import SwiftUI

struct NeedsMeTodosSection: View {
  @Environment(AppStore.self) private var store
  @State private var page: MobileTodoPage?
  @State private var busy = false
  @State private var loadFailed = false
  @State private var actionMessage: LocalizedStringKey?
  @State private var snoozing: MobileTodo?
  @State private var snoozeDate = Date.now

  private var items: [MobileTodo] { page?.items ?? [] }

  var body: some View {
    Section("To-dos that need me") {
      Button("Refresh to-dos") { Task { await refresh() } }.disabled(busy)
      if busy { ProgressView() }
      else if loadFailed { Text("Could not load to-dos.") }
      else if page == nil { Text("To-dos are unavailable on this server.") }
      else if items.isEmpty { Text("No to-dos need attention.") }
      if let actionMessage { Text(actionMessage) }
      ForEach(items) { todo in
        VStack(alignment: .leading, spacing: 6) {
          Text(todo.title).font(.headline)
          if let state = attentionLabel(todo) { Text(state).font(.subheadline) }
          if let rawDate = todo.attentionDate,
            let date = (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(rawDate))
              ?? (try? Date.ISO8601FormatStyle().parse(rawDate)) {
            Text(date.formatted(date: .abbreviated, time: .shortened)).font(.caption)
          }
          if let note = todo.note, !note.isEmpty { Text(note) }
          if let summary = todo.summary, !summary.isEmpty, summary != todo.note { Text(summary) }
          ForEach(todo.actions, id: \.self) { action in
            Button(action.label) {
              if action == .snooze {
                snoozeDate = .now
                snoozing = todo
              } else { Task { await act(todo, action: action) } }
            }.buttonStyle(.borderless).disabled(busy || loadFailed)
          }
        }
      }
      if page?.nextCursor != nil && !loadFailed {
        Button("Load more to-dos") { Task { await refresh(more: true) } }.disabled(busy)
      }
    }
    .task { await refresh() }
    .sheet(item: $snoozing) { todo in
      NavigationStack {
        Form {
          DatePicker("Snooze until", selection: $snoozeDate, displayedComponents: [.date, .hourAndMinute])
        }
        .navigationTitle("Snooze")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { snoozing = nil } }
          ToolbarItem(placement: .confirmationAction) {
            Button("Snooze") {
              let selectedDate = snoozeDate
              snoozing = nil
              Task { await act(todo, action: .snooze, until: selectedDate) }
            }
          }
        }
      }
    }
  }

  private func attentionLabel(_ todo: MobileTodo) -> LocalizedStringKey? {
    if todo.status == "suggested" { return "To-do suggestion" }
    if todo.displayState == "follow_up" { return "Needs follow-up" }
    if todo.overdue == true { return "Overdue" }
    if todo.displayState == "today" { return "Today" }
    return nil
  }

  private func fetch(more: Bool = false) async {
    loadFailed = false
    do {
      let next = try await store.needsMeTodos(cursor: more ? page?.nextCursor : nil)
      if more, let next {
        var ids = Set(items.map(\.id))
        page = MobileTodoPage(items: items + next.items.filter { ids.insert($0.id).inserted }, nextCursor: next.nextCursor)
      } else { page = next }
    } catch {
      if (error as? APIError)?.unauthorized == true { page = nil }
      else if !UserFacingError.isCancelled(error) { loadFailed = true }
    }
  }

  private func refresh(more: Bool = false) async {
    guard !busy else { return }
    busy = true
    actionMessage = nil
    defer { busy = false }
    await fetch(more: more)
  }

  private func act(_ todo: MobileTodo, action: MobileTodoAction, until: Date? = nil) async {
    guard !busy, !loadFailed, items.contains(where: { $0.id == todo.id && $0.revision == todo.revision }) else { return }
    if action == .snooze, (until ?? .distantPast) <= .now {
      actionMessage = "Choose a future snooze time."
      return
    }
    busy = true
    actionMessage = nil
    defer { busy = false }
    do { try await store.actOnTodo(todo, action: action, snoozeUntil: until) }
    catch {
      if UserFacingError.isCancelled(error) { return }
      if (error as? APIError)?.unauthorized == true { page = nil; return }
      actionMessage = (error as? APIError)?.status == 409
        ? "The to-do changed. Review the current list." : "Could not update the to-do."
    }
    if let page {
      self.page = MobileTodoPage(items: page.items.filter { $0.id != todo.id }, nextCursor: page.nextCursor)
    }
    await fetch()
  }
}

private extension MobileTodoAction {
  var label: LocalizedStringKey {
    switch self {
    case .accept: "Accept suggestion"
    case .snooze: "Snooze"
    case .dismiss: "Dismiss"
    case .complete: "Complete"
    }
  }
}
