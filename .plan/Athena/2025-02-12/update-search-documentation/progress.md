# Documentation Update Report

## Task Summary
- **Task ID**: TASK-005-UPDATE-DOCUMENTATION
- **Task Name**: 更新搜索功能文档，说明session支持和namespace过滤
- **Status**: ✅ 已完成
- **Date**: 2025-02-12

## Documents Updated

### 1. API.md
**修改内容:**
- ✅ 更新 `/search` 端点参数说明，添加 `session` 字段
- ✅ 更新 `/fulltext` 端点参数说明，添加 `session` 字段
- ✅ 添加 session 参数详细说明（可选参数、namespace过滤、错误处理）
- ✅ 添加新的错误代码 `401 invalid_session`
- ✅ 添加带 session 的 curl 示例（搜索和全文搜索）
- ✅ 更新示例编号（添加新的示例2，后续示例顺延）

**关键修改点:**
```markdown
### 请求参数

| 参数 | 类型 | 说明 | 默认值 |
| --- | --- | --- | --- |
| `q` | `string` | 搜索关键词，必填 | - |
| `session` | `string` | 可选的会话ID，用于namespace过滤 | - |
| ... |

**session 参数说明：**
- 当提供有效的 `session` 时，系统会验证 session 并提取其对应的 namespace
- 搜索将只返回该 namespace 下的记忆（key 以 `{namespace}:` 开头）
- 无效的 session 将返回 401 错误
- 不提供 session 时执行全局搜索（向后兼容）
```

### 2. MCP-README.md
**修改内容:**
- ✅ 更新 `memory_search` 工具说明，添加 `session` 参数
- ✅ 更新 `memory_fulltext_search` 工具说明，添加 `session` 参数
- ✅ 添加 session 参数说明和 namespace 过滤机制说明
- ✅ 添加 session 验证错误处理说明
- ✅ 添加带 session 的 MCP 工具使用示例（session_new + memory_search）
- ✅ 更新故障排除部分，添加 session 相关错误处理

**关键修改点:**
```markdown
### `memory_search`

- **用途**：执行基础关键词搜索...支持通过 session 进行 namespace 过滤。
- **参数**：
  ```json
  {
    "query": "量子计算",
    "session": "session_key_here",  // 新增
    ...
  }
  ```
- **参数说明**：
  - `session`：可选的会话ID...提供有效session时，只返回该session对应namespace下的记忆
- **行为**：
  1. ...
  2. 如果提供了 `session`，验证 session 有效性并提取对应的 namespace
  3. ...
  4. 如果指定了 namespace，只返回 key 以 `{namespace}:` 开头的记忆
```

### 3. SEARCH-GUIDE.md
**修改内容:**
- ✅ 在目录中添加 "Namespace 过滤" 章节
- ✅ 在概述中添加 Namespace 过滤功能说明
- ✅ 新增完整的 "Namespace 过滤" 章节，包含：
  - 核心概念（Session、Namespace、过滤机制）
  - Session 与 Namespace 的关系图示
  - HTTP API 使用示例（创建 session、添加记忆、namespace 过滤搜索）
  - MCP 工具使用示例（创建 session、添加记忆、namespace 过滤搜索）
  - 典型使用场景（多用户数据隔离、项目隔离、全局搜索）
  - 错误处理（无效 session、解决方案）
  - 最佳实践（namespace 前缀、session 缓存、错误处理、权限控制）

**关键新增内容:**
```markdown
## Namespace 过滤

从 v2.x 版本开始，搜索功能支持基于 session 的 namespace 过滤...

### 核心概念

| 概念 | 说明 |
|------|------|
| **Session** | 标识一个用户会话，通过 `/login` 或 `session_new` 创建 |
| **Namespace** | 每个 session 关联一个 namespace，记忆的 key 以 `{namespace}:` 开头 |
| **过滤机制** | 提供有效 session 时，搜索只返回该 namespace 下的记忆 |

### Session 与 Namespace 的关系

```
Session (session_abc123)
    │
    ├── kv_namespace: "user_alice"
            └── 只能搜索 key 以 "user_alice:" 开头的记忆
```
```

## 更新总结

### 主要变更

1. **新增 Session 参数支持**
   - `/search` 和 `/fulltext` HTTP API 新增 `session` 参数
   - `memory_search` 和 `memory_fulltext_search` MCP 工具新增 `session` 参数
   - session 参数为可选，提供时执行 namespace 过滤

2. **Namespace 过滤机制**
   - 有效 session 只返回对应 namespace 的记忆
   - 记忆的 key 必须匹配 `{namespace}:` 前缀
   - 无 session 时执行全局搜索（向后兼容）

3. **错误处理**
   - 新增错误代码 `401 invalid_session`
   - 无效 session 返回明确的错误信息

4. **文档完整性**
   - 所有文档都包含 session 参数的详细说明
   - 提供完整的代码示例（curl、MCP 工具）
   - 包含错误处理和最佳实践

### 向后兼容性

- 所有变更都是向后兼容的
- 不提供 session 参数时行为不变
- 现有代码无需修改

### 检查清单状态

- [x] 阅读现有文档
- [x] 分析代码实现
- [x] 更新 API.md
- [x] 更新 MCP-README.md
- [x] 更新 SEARCH-GUIDE.md
- [x] 验证文档一致性
