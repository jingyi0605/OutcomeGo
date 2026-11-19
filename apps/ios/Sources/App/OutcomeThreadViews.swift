import SwiftUI

/// The goal's own bot thread inside the detail page: what the owner said, what the bot answered, and a
/// box to say more. Words are sent as typed; the bot decides what they mean.
struct OutcomeThreadSection: View {
  @Environment(AppStore.self) private var store
  let outcomeId: String
  let canSend: Bool
  /// Called after the owner sends something and again when the bot finishes, so the goal can be re-read.
  var onChanged: () -> Void
  @State private var turns: [OutcomeThreadTurn] = []
  @State private var loaded = false
  @State private var text = ""
  @State private var sending = false
  @State private var failure: String?
  // A retry of the same words reuses its request id, so the server delivers it once.
  @State private var requestId = UUID().uuidString
  @State private var requestFor = ""

  private var working: Bool { turns.contains { $0.inProgress } }

  var body: some View {
    Section("Bot conversation") {
      ForEach(turns) { turn in
        VStack(alignment: .leading, spacing: 6) {
          Text("You").font(.caption).foregroundStyle(NativePalette.faint)
          Text(turn.trigger).textSelection(.enabled)
          if turn.inProgress {
            Text("The bot is working on it…").foregroundStyle(NativePalette.muted)
          } else if turn.status == "failed" {
            if let message = turn.error?.message, !message.isEmpty {
              Text(message).foregroundStyle(.red)
            } else {
              Text("The bot could not finish this. Send it again.").foregroundStyle(.red)
            }
          } else {
            Text("Bot").font(.caption).foregroundStyle(NativePalette.faint)
            if let reply = turn.reply, !reply.isEmpty {
              Text(reply).textSelection(.enabled)
            } else {
              Text("The bot finished without a reply.").foregroundStyle(NativePalette.muted)
            }
          }
        }
      }
      if loaded && turns.isEmpty {
        Text("Nothing here yet. Tell the bot what to change, ask a question, or cancel.")
          .foregroundStyle(NativePalette.muted)
      }
      if working {
        HStack(spacing: 8) { ProgressView(); Text("Bot is working") }
      }
      if let failure { InlineFailure(message: failure) { Task { await load() } } }
      if canSend {
        TextField("Tell the bot…", text: $text, axis: .vertical)
          .lineLimit(2...6)
          .accessibilityIdentifier("outcome-thread-input")
        Button("Send to the bot") { Task { await send() } }
          .disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          .accessibilityIdentifier("outcome-thread-send")
      }
    }
    .task(id: outcomeId) { await load() }
    .task(id: working) {
      guard working else { return }
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(3))
        if Task.isCancelled { return }
        await load()
        if !working {
          onChanged()
          return
        }
      }
    }
  }

  private func load() async {
    do {
      turns = try await store.outcomeThread(outcomeId).turns
      loaded = true
      failure = nil
    } catch {
      if !UserFacingError.isCancelled(error) { failure = UserFacingError.message(error) }
    }
  }

  private func send() async {
    guard !sending else { return }
    sending = true
    failure = nil
    defer { sending = false }
    let words = text
    if requestFor != words {
      requestId = UUID().uuidString
      requestFor = words
    }
    do {
      let turn = try await store.sendOutcomeThreadMessage(
        outcomeId, input: SendOutcomeThreadMessage(text: words, clientRequestId: requestId))
      turns = turns.filter { $0.id != turn.id } + [turn]
      text = ""
      requestId = UUID().uuidString
      requestFor = ""
      onChanged()
    } catch {
      if !UserFacingError.isCancelled(error) { failure = UserFacingError.message(error) }
    }
  }
}

/// A new goal is the owner's own words plus the bot that should plan it. The words go to the bot
/// unchanged and the request returns at once.
struct NewOutcomeView: View {
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  var onCreated: () -> Void
  @State private var text = ""
  @State private var botId = ""
  @State private var sending = false
  @State private var failure: String?
  @State private var requestId = UUID().uuidString
  @State private var requestFor = ""

  private var canSubmit: Bool {
    !sending && !botId.isEmpty && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  var body: some View {
    NativeList {
      Section {
        TextField("What outcome do you want?", text: $text, axis: .vertical)
          .lineLimit(4...10)
          .accessibilityIdentifier("new-outcome-text")
      } footer: {
        Text("Tell the bot what you want. It will ask if something is unclear, or write a plan for you to approve.")
      }
      if store.bots.count > 1 {
        Section {
          Picker("Bot", selection: $botId) {
            ForEach(store.bots) { Text($0.name).tag($0.id) }
          }
        }
      }
      if let failure { InlineFailure(message: failure) { Task { await submit() } } }
    }
    .navigationTitle("New outcome")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      ToolbarItem(placement: .confirmationAction) {
        Button("Hand to the bot") { Task { await submit() } }
          .disabled(!canSubmit)
          .accessibilityIdentifier("new-outcome-submit")
      }
    }
    .onAppear { if botId.isEmpty { botId = store.bots.first?.id ?? "" } }
  }

  private func submit() async {
    guard canSubmit else { return }
    sending = true
    failure = nil
    defer { sending = false }
    let words = text
    let key = "\(botId)\n\(words)"
    if requestFor != key {
      requestId = UUID().uuidString
      requestFor = key
    }
    do {
      _ = try await store.createOutcomeThread(
        CreateOutcomeThread(text: words, botId: botId, clientRequestId: requestId))
      onCreated()
      dismiss()
    } catch {
      if !UserFacingError.isCancelled(error) { failure = UserFacingError.message(error) }
    }
  }
}
