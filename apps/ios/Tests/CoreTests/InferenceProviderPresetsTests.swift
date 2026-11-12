import Foundation
import XCTest

@testable import OutcomeGoCore

final class InferenceProviderPresetsTests: XCTestCase {
  private let json = """
    [{"id":"deepseek-api","name":"DeepSeek","group":"vendor",
      "endpoints":{"openai-completions":"https://api.deepseek.com/v1",
                   "anthropic-messages":"https://api.deepseek.com/anthropic"},
      "keysUrl":"https://platform.deepseek.com/api_keys"},
     {"id":"ollama-local","name":"Ollama","group":"local",
      "endpoints":{"openai-completions":"http://localhost:11434/v1"},"noKey":true}]
    """

  func testDecodesTheServersCatalog() throws {
    let presets = try JSONDecoder().decode([InferenceProviderPreset].self, from: Data(json.utf8))
    XCTAssertEqual(presets.map(\.id), ["deepseek-api", "ollama-local"])
    XCTAssertFalse(presets[0].noKey)
    XCTAssertTrue(presets[1].noKey)
    XCTAssertEqual(presets[0].protocols, [.openaiChat, .anthropicMessages])
    XCTAssertEqual(presets[0].defaultProtocol, .openaiChat)
    XCTAssertEqual(presets[0].baseUrl(for: .anthropicMessages), "https://api.deepseek.com/anthropic")
    XCTAssertEqual(presets[0].baseUrl(for: .openaiResponses), "")
  }

  func testAnOptionalKeyIsReadFromTheCatalog() throws {
    let json = """
      [{"id":"magpie-local","name":"magpie","group":"local",
        "endpoints":{"openai-completions":"http://127.0.0.1:3425/v1"},"keyOptional":true}]
      """
    let preset = try JSONDecoder().decode([InferenceProviderPreset].self, from: Data(json.utf8))[0]
    XCTAssertTrue(preset.keyOptional)
    XCTAssertFalse(preset.noKey)
  }

  func testAddBodyNamesThePresetOnlyWhenOneWasPicked() {
    let preset = InferenceProviderPreset(
      id: "deepseek-api", name: "DeepSeek", group: "vendor",
      endpoints: ["openai-completions": "https://api.deepseek.com/v1"])
    XCTAssertEqual(
      InferenceProviderRequest.add(
        preset: preset, name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1",
        proto: .openaiChat, noAuth: false),
      .object([
        "presetId": .string("deepseek-api"), "name": .string("DeepSeek"),
        "baseUrl": .string("https://api.deepseek.com/v1"), "api": .string("openai-completions"),
      ]))
    XCTAssertEqual(
      InferenceProviderRequest.add(
        preset: nil, name: "Mine", baseUrl: "http://10.0.0.5:8000/v1", proto: .anthropicMessages,
        noAuth: true),
      .object([
        "name": .string("Mine"), "baseUrl": .string("http://10.0.0.5:8000/v1"),
        "api": .string("anthropic-messages"), "noAuth": .bool(true),
      ]))
  }

  func testPathsEscapeTheProviderId() {
    XCTAssertEqual(InferenceProviderRequest.removePath("custom-a b"), "/api/v0/inference-custom-providers/custom-a%20b")
  }
}
