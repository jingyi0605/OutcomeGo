import Foundation

/// The three standard wire protocols a provider can be added over.
public enum ProviderProtocol: String, Codable, Sendable, CaseIterable, Identifiable {
  case openaiChat = "openai-completions"
  case openaiResponses = "openai-responses"
  case anthropicMessages = "anthropic-messages"
  public var id: String { rawValue }
  public var label: String {
    switch self {
    case .openaiChat: "OpenAI Chat"
    case .openaiResponses: "OpenAI Responses"
    case .anthropicMessages: "Anthropic Messages"
    }
  }
}

/// A vendor the server knows the endpoints of. The server owns this catalog.
public struct InferenceProviderPreset: Codable, Sendable, Identifiable, Hashable {
  public var id: String
  public var name: String
  public var group: String
  public var endpoints: [String: String]
  public var keysUrl: String?
  public var noKey: Bool
  /// The key may stay empty: a local server that only asks other computers for one.
  public var keyOptional: Bool
  public var note: String?
  public var icon: String?

  public init(
    id: String, name: String, group: String, endpoints: [String: String],
    keysUrl: String? = nil, noKey: Bool = false, keyOptional: Bool = false, note: String? = nil,
    icon: String? = nil
  ) {
    self.id = id
    self.name = name
    self.group = group
    self.endpoints = endpoints
    self.keysUrl = keysUrl
    self.noKey = noKey
    self.keyOptional = keyOptional
    self.note = note
    self.icon = icon
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    id = try c.decode(String.self, forKey: .id)
    name = try c.decode(String.self, forKey: .name)
    group = try c.decode(String.self, forKey: .group)
    endpoints = try c.decode([String: String].self, forKey: .endpoints)
    keysUrl = try c.decodeIfPresent(String.self, forKey: .keysUrl)
    noKey = try c.decodeIfPresent(Bool.self, forKey: .noKey) ?? false
    keyOptional = try c.decodeIfPresent(Bool.self, forKey: .keyOptional) ?? false
    note = try c.decodeIfPresent(String.self, forKey: .note)
    icon = try c.decodeIfPresent(String.self, forKey: .icon)
  }
  private enum Keys: String, CodingKey { case id, name, group, endpoints, keysUrl, noKey, keyOptional, note, icon }

  /// The protocols this vendor documents an address for, in the app's order.
  public var protocols: [ProviderProtocol] {
    ProviderProtocol.allCases.filter { endpoints[$0.rawValue] != nil }
  }
  public var defaultProtocol: ProviderProtocol { protocols.first ?? .openaiChat }
  public func baseUrl(for proto: ProviderProtocol) -> String { endpoints[proto.rawValue] ?? "" }
}

public enum ProviderPresetGroup {
  /// Section order and titles; a group the server adds later is listed last as-is.
  public static let order: [(id: String, title: String)] = [
    ("vendor", "Model makers"), ("cloud", "Cloud platforms"),
    ("relay", "Hosts and gateways"), ("local", "On this server"),
  ]
  /// A custom endpoint's generic mark, by its protocol.
  public static let genericIcon: [ProviderProtocol: String] = [
    .openaiChat: "generic-openai-chat", .openaiResponses: "generic-openai-responses",
    .anthropicMessages: "generic-anthropic-messages",
  ]
}

public enum InferenceProviderRequest {
  public static let presetsPath = "/api/v0/inference-provider-presets"
  public static let addPath = "/api/v0/inference-providers"
  public static func removePath(_ providerId: String) -> String {
    "/api/v0/inference-custom-providers/\(API.segment(providerId))"
  }
  /// The POST /inference-providers body.
  public static func add(
    preset: InferenceProviderPreset?, name: String, baseUrl: String, proto: ProviderProtocol,
    noAuth: Bool
  ) -> JSON {
    var body: [String: JSON] = [
      "name": .string(name), "baseUrl": .string(baseUrl), "api": .string(proto.rawValue),
    ]
    if let preset { body["presetId"] = .string(preset.id) }
    if noAuth { body["noAuth"] = .bool(true) }
    return .object(body)
  }
}
