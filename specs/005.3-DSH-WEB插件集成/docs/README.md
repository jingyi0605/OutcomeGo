# 补充文档目录

本目录存放与 DSH-WEB 插件集成相关的补充文档。

## 文档清单

### DSH-WEB MCP 参考
- **`dsh-web-mcp-reference.md`**（待编写）
  - DSH-WEB MCP 服务器的完整接口文档
  - 所有 11 个工具的详细说明
  - 错误码列表
  - 来源：`/Users/jackson/Code/CodingNS/data/dsh-codingns/src/host/workspace-mcp/tools.ts`

### 集成指南
- **`configuration-guide.md`**（待编写）
  - 如何在 DSH-WEB 中生成和管理 MCP API Key
  - 如何在 OutcomeGo 中配置 DSH-WEB 账户
  - 常见问题排查

### 开发者指南
- **`developer-guide.md`**（待编写）
  - 如何在 Bot 中调用 DSH-WEB 插件工具
  - Bot 工作流示例（完整场景）
  - 如何扩展插件（如果 DSH-WEB MCP 后续添加新工具）

### 错误处理
- **`error-handling.md`**（待编写）
  - 常见错误码和解决方案
  - 网络故障恢复机制
  - 日志分析方法

### API Key 管理
- **`api-key-management.md`**（待编写）
  - API Key 的生成、轮换、撤销流程
  - 安全最佳实践
  - 多账户管理

### 性能和限制
- **`limits.md`**（待编写）
  - 并发请求限制
  - 数据大小限制（terminal_read、terminal_write）
  - 超时设置
  - 已知限制和规避方式

### 测试指南
- **`testing-guide.md`**（待编写）
  - 如何设置本地测试环境（DSH-WEB + OutcomeGo）
  - 单元测试编写方法
  - 集成测试场景

## 编写优先级

| 优先级 | 文档 | 原因 |
| --- | --- | --- |
| P0 | dsh-web-mcp-reference.md | 是实现的基础 |
| P1 | configuration-guide.md | 用户上手的第一步 |
| P1 | developer-guide.md | 开发者需要学习使用 |
| P2 | error-handling.md | 问题排查时需要 |
| P2 | api-key-management.md | 安全最佳实践 |
| P3 | limits.md | 参考信息 |
| P3 | testing-guide.md | 开发者指南 |

## 编写指南

- **语言**：中文
- **格式**：Markdown
- **代码示例**：包含清晰的代码片段和命令行示例
- **截图**：如有 UI 操作，包含相应截图
- **链接**：引用相关文档或源代码时使用相对路径

## 如何更新

- 当实现新工具时，更新 `dsh-web-mcp-reference.md` 和 `developer-guide.md`
- 当发现新的错误或限制时，更新 `error-handling.md` 和 `limits.md`
- 当修改配置流程时，更新 `configuration-guide.md`
- 定期检查文档是否与代码保持一致
