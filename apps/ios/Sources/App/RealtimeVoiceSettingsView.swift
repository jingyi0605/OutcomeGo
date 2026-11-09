import SwiftUI

/// Realtime voice configuration mirrors the server contract used by the desktop
/// and Android clients. Voice note transcription remains a separate screen.
struct RealtimeVoiceSettingsView: View {
  @Environment(AppStore.self) private var store
  @State private var loaded = false
  @State private var saving = false
  @State private var enabled = false
  @State private var provider = "volcengine"
  @State private var providerKey = ""
  @State private var baseURL = ""
  @State private var sttURL = ""
  @State private var ttsURL = ""
  @State private var sttResourceID = ""
  @State private var ttsResourceID = ""
  @State private var deepgramBaseURL = ""
  @State private var sttModel = ""
  @State private var ttsModel = ""
  @State private var voice = ""
  @State private var language = ""
  @State private var narrationModel = ""
  @State private var message: String?

  var body: some View {
    NativeForm {
      if !loaded {
        Section { LoadingOrbLabel(title: "Loading…") }
      } else {
        Section {
          Toggle("Realtime voice", isOn: $enabled).tint(NativePalette.toggle)
        } footer: {
          SettingsFooter("Allow authenticated clients to open live voice conversations with a Bot.")
        }
        Section("Provider") {
          Picker("Default provider", selection: $provider) {
            Text("Volcengine").tag("volcengine")
            Text("Deepgram").tag("deepgram")
          }
          SecureField("API key", text: $providerKey)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .accessibilityIdentifier("realtime-voice-api-key")
        }
        Section("Provider connection") {
          if provider == "volcengine" {
            TextField("Base URL", text: $baseURL).textInputAutocapitalization(.never).autocorrectionDisabled()
            TextField("STT WebSocket URL", text: $sttURL).textInputAutocapitalization(.never).autocorrectionDisabled()
            TextField("TTS WebSocket URL", text: $ttsURL).textInputAutocapitalization(.never).autocorrectionDisabled()
            TextField("STT resource ID", text: $sttResourceID).textInputAutocapitalization(.never).autocorrectionDisabled()
            TextField("TTS resource ID", text: $ttsResourceID).textInputAutocapitalization(.never).autocorrectionDisabled()
          } else {
            TextField("Base URL", text: $deepgramBaseURL).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
        }
        Section("Speech defaults") {
          TextField("STT model", text: $sttModel).textInputAutocapitalization(.never).autocorrectionDisabled()
          TextField("TTS model", text: $ttsModel).textInputAutocapitalization(.never).autocorrectionDisabled()
          TextField("TTS voice", text: $voice).textInputAutocapitalization(.never).autocorrectionDisabled()
          TextField("Language", text: $language).textInputAutocapitalization(.never).autocorrectionDisabled()
          TextField("Narration model", text: $narrationModel).textInputAutocapitalization(.never).autocorrectionDisabled()
        } footer: {
          SettingsFooter("Narration speaks short progress updates while the Bot works. Leave fields blank to use server defaults.")
        }
        Section {
          if let message { Text(message).foregroundStyle(NativePalette.muted) }
          Button(saving ? "Saving…" : "Save settings") { Task { await save() } }
            .disabled(saving)
            .accessibilityIdentifier("realtime-voice-save")
        }
      }
    }
    .navigationTitle("Realtime voice").navigationBarTitleDisplayMode(.inline)
    .task { await load() }
  }

  private func load() async {
    guard !loaded else { return }
    do {
      let value = try await store.request("/api/server-settings/voice")
      enabled = value["enabled"].bool
      provider = value["defaultProvider"].string.isEmpty ? "volcengine" : value["defaultProvider"].string
      sttModel = value["sttModel"].string
      ttsModel = value["ttsModel"].string
      voice = value["voice"].string
      language = value["language"].string
      narrationModel = value["narrationModel"].string
      let volcengine = value["providers"]["volcengine"]
      let deepgram = value["providers"]["deepgram"]
      baseURL = volcengine["baseUrl"].string
      sttURL = volcengine["sttUrl"].string
      ttsURL = volcengine["ttsUrl"].string
      sttResourceID = volcengine["sttResourceId"].string
      ttsResourceID = volcengine["ttsResourceId"].string
      deepgramBaseURL = deepgram["baseUrl"].string
      loaded = true
    } catch { message = "Could not load realtime voice settings." }
  }

  private func save() async {
    saving = true
    defer { saving = false }
    do {
      var body: [String: JSON] = [
        "enabled": .bool(enabled), "defaultProvider": .string(provider),
        "volcengineBaseUrl": .string(baseURL), "volcengineSttUrl": .string(sttURL),
        "volcengineTtsUrl": .string(ttsURL), "volcengineSttResourceId": .string(sttResourceID),
        "volcengineTtsResourceId": .string(ttsResourceID), "deepgramBaseUrl": .string(deepgramBaseURL),
        "sttModel": .string(sttModel), "ttsModel": .string(ttsModel), "voice": .string(voice),
        "language": .string(language), "narrationModel": .string(narrationModel),
      ]
      if !providerKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        body[provider == "volcengine" ? "volcengineApiKey" : "deepgramApiKey"] = .string(providerKey)
      }
      _ = try await store.request("/api/server-settings/voice", method: "PUT", body: .object(body))
      providerKey = ""
      message = enabled ? "Realtime voice settings saved." : "Realtime voice is disabled."
    } catch { message = "Could not save realtime voice settings." }
  }
}
