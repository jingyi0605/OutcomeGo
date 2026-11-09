import SwiftUI

/// Adds a provider over one of the standard protocols: OpenAI Chat, OpenAI Responses
/// or Anthropic Messages. The server owns the vendor list and keeps the key.
struct AddProviderSheet: View {
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  let setup: ModelSetup
  @State private var presetId = ""
  @State private var proto = ProviderProtocol.openaiChat
  @State private var name = ""
  @State private var baseUrl = ""
  @State private var apiKey = ""
  @State private var failure: String?
  @State private var adding = false
  @FocusState private var focus: Field?
  private enum Field: Hashable { case name, url, key }

  private var preset: InferenceProviderPreset? { setup.presets.first { $0.id == presetId } }
  private var protocols: [ProviderProtocol] { preset?.protocols ?? ProviderProtocol.allCases }
  /// The key field is shown unless the server never takes one.
  private var showsKey: Bool { preset?.noKey != true }
  private var keyIsEmpty: Bool { apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
  /// Added without a key: a keyless preset, or an optional key left empty.
  private var withoutKey: Bool { !showsKey || (preset?.keyOptional == true && keyIsEmpty) }
  private var ready: Bool {
    !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && (withoutKey || !keyIsEmpty)
  }

  var body: some View {
    NavigationStack {
      NativeForm {
        Section {
          Picker("Service", selection: $presetId) {
            Label {
              Text("Custom endpoint")
            } icon: {
              ProviderIconView(name: ProviderPresetGroup.genericIcon[proto], size: 18)
            }.tag("")
            ForEach(ProviderPresetGroup.order, id: \.id) { group in
              let members = setup.presets.filter { $0.group == group.id }
              if !members.isEmpty {
                Section(LocalizedStringKey(group.title)) {
                  ForEach(members) { member in
                    Label {
                      Text(member.name)
                    } icon: {
                      ProviderIconView(name: member.icon, size: 18)
                    }.tag(member.id)
                  }
                }
              }
            }
          }.pickerStyle(.menu).disabled(adding)
            .accessibilityIdentifier("add-provider-service")
          Picker("Protocol", selection: $proto) {
            ForEach(protocols) { Text($0.label).tag($0) }
          }.pickerStyle(.menu).disabled(adding || protocols.count < 2)
            .accessibilityIdentifier("add-provider-protocol")
        } footer: {
          if let error = setup.presetsError {
            InlineFailure(message: error) { Task { await setup.loadPresets() } }
          } else {
            SettingsFooter(
              "Connect any service that speaks OpenAI Chat, OpenAI Responses or Anthropic Messages. The key stays on your server."
            )
          }
        }
        Section {
          TextField("Name", text: $name)
            .focused($focus, equals: .name).submitLabel(.next)
            .onSubmit { focus = .url }
            .accessibilityIdentifier("add-provider-name")
          TextField("API base URL", text: $baseUrl)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .keyboardType(.URL).font(.system(.body, design: .monospaced))
            .focused($focus, equals: .url).submitLabel(showsKey ? .next : .done)
            .onSubmit { focus = showsKey ? .key : nil }
            .accessibilityIdentifier("add-provider-url")
          if showsKey {
            SecureField(preset?.keyOptional == true ? "API key (optional)" : "API key", text: $apiKey)
              .textInputAutocapitalization(.never).autocorrectionDisabled()
              .focused($focus, equals: .key).submitLabel(.done)
              .onSubmit { Task { await add() } }
              .accessibilityIdentifier("add-provider-key")
          }
        } footer: {
          if let keys = preset?.keysUrl.flatMap(URL.init(string:)), showsKey {
            Button("Get a key") { openURL(keys) }
              .font(.footnote).accessibilityIdentifier("add-provider-get-key")
          } else if let note = preset?.note, preset?.noKey == true || preset?.keyOptional == true {
            SettingsFooter(note)
          }
        }
        if let failure {
          Section { InlineFailure(message: failure) }
        }
      }
      .disabled(adding).scrollDismissesKeyboard(.interactively)
      .interactiveDismissDisabled(adding)
      .navigationTitle("Add provider").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(adding)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(adding ? "Checking the key…" : "Add") { Task { await add() } }
            .disabled(!ready || adding).accessibilityIdentifier("add-provider-submit")
        }
      }
      .onChange(of: presetId) { _, _ in
        failure = nil
        guard let preset else { return }
        proto = preset.defaultProtocol
        name = preset.name
        baseUrl = preset.baseUrl(for: proto)
      }
      .onChange(of: proto) { _, next in
        // A vendor documents an address per protocol; a typed address stays as it is.
        if let preset, preset.endpoints[next.rawValue] != nil { baseUrl = preset.baseUrl(for: next) }
      }
      .task { await setup.loadPresets() }
    }
  }

  private func add() async {
    guard ready, !adding else { return }
    focus = nil
    adding = true
    failure = nil
    let reason = await setup.addProvider(
      preset: preset, name: name.trimmingCharacters(in: .whitespacesAndNewlines),
      baseUrl: baseUrl.trimmingCharacters(in: .whitespacesAndNewlines), proto: proto,
      apiKey: withoutKey ? nil : apiKey.trimmingCharacters(in: .whitespacesAndNewlines))
    adding = false
    if let reason {
      failure = reason
      NativeHaptics.play(.error, source: "model.add-provider")
    } else {
      NativeHaptics.play(.success, source: "model.add-provider")
      dismiss()
    }
  }
}
