import Foundation

enum AppLanguage: String, CaseIterable, Identifiable {
  case english = "en-US"
  case simplifiedChinese = "zh-CN"

  static let `default` = AppLanguage.english
  var id: String { rawValue }
  var locale: Locale { Locale(identifier: rawValue) }
  var label: String { self == .simplifiedChinese ? "简体中文" : "English" }

  static func normalized(_ value: String?) -> AppLanguage {
    switch value?.lowercased() {
    case "zh", "zh-cn", "zh-hans", "zh-hans-cn": return .simplifiedChinese
    default: return .english
    }
  }
}
