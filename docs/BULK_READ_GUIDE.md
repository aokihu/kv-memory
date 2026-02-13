# 批量读取记忆功能用户指南

**版本**: 1.0.0  
**更新日期**: 2025-02-13  
**适用系统**: kvdb-mem  

---

## 目录

1. [功能概述](#功能概述)
2. [适用场景](#适用场景)
3. [核心概念](#核心概念)
4. [HTTP API 使用指南](#http-api-使用指南)
5. [MCP 工具使用指南](#mcp-工具使用指南)
6. [参数配置说明](#参数配置说明)
7. [最佳实践](#最佳实践)
8. [故障排除](#故障排除)
9. [相关文档](#相关文档)

---

## 功能概述

批量读取记忆功能允许用户通过单个API调用或MCP工具调用，获取一个目标记忆及其所有关联记忆。系统使用**深度优先遍历（DFS）**算法探索记忆关联网络，并按照关联强度排序返回结果。

### 核心能力

- **深度遍历**：支持最多6层深度的关联记忆探索
- **智能排序**：按 `link_weight × memory_score` 自动排序
- **自动去重**：防止同一记忆被重复返回
- **灵活限制**：可配置深度、广度、总量三个维度的限制
- **双端支持**：同时支持HTTP API和独立MCP工具 `bulk_read_memory`

---

## 适用场景

### 场景1：获取完整上下文

当你需要理解一个决策或设计的完整背景时，批量读取可以帮你获取所有相关的讨论、决策和文档。

**示例**：
```
目标记忆：项目架构设计决策
关联记忆：数据库选型、技术栈评估、性能考量、团队讨论...
```

### 场景2：知识图谱探索

探索一个主题的知识网络，发现相关的概念、文档和决策。

**示例**：
```
目标记忆：微服务架构介绍
关联记忆：服务发现、负载均衡、熔断机制、分布式事务...
```

### 场景3：回顾项目历史

快速回顾一个项目的完整历史，包括需求变更、技术决策和关键节点。

**示例**：
```
目标记忆：项目启动会议
关联记忆：需求文档、技术方案、里程碑计划、风险分析...
```

### 场景4：故障排查辅助

排查问题时，获取相关的错误日志、处理记录和解决方案。

**示例**：
```
目标记忆：生产环境异常告警
关联记忆：错误日志、排查过程、修复方案、验证结果...
```

---

## 核心概念

### 深度优先遍历（DFS）

系统使用深度优先遍历算法探索记忆关联网络：

```
┌─────────────────┐
│   目标记忆 A    │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐  ┌───────┐
│   B   │  │   C   │  ← 第一层
└───┬───┘  └───┬───┘
    │          │
    ▼          ▼
┌───────┐  ┌───────┐
│   D   │  │   E   │  ← 第二层
└───────┘  └───────┘
```

遍历顺序：A → B → D → C → E

**为什么选择DFS？**
- 更符合记忆关联的语义：深度关联往往更相关
- 优先探索深层关联：快速获取深度上下文
- 资源效率高：不需要维护庞大的队列

### 权重计算公式

系统使用以下公式计算关联记忆的综合得分：

```
综合得分 = link_weight × memory_score
```

**参数说明**：
- `link_weight`：关联强度，范围0.0-1.0
- `memory_score`：记忆活跃度，范围0-100

**示例**：

| 关联记忆 | link_weight | memory_score | 综合得分 |
|---------|-------------|--------------|----------|
| 记忆A | 0.9 | 85 | 76.5 |
| 记忆B | 0.8 | 90 | 72.0 |
| 记忆C | 0.7 | 80 | 56.0 |

排序结果：记忆A → 记忆B → 记忆C

### 三层限制策略

系统使用三层限制策略保护性能和响应时间：

```
┌─────────────────────────────────────────┐
│           三层限制金字塔                 │
├─────────────────────────────────────────┤
│                                         │
│              ┌───────┐                 │
│              │ 深度  │  max 6层         │
│              │ Depth │  default 3层    │
│              └───┬───┘                 │
│                  │                     │
│          ┌───────┴───────┐             │
│          │     广度      │  max 20个   │
│          │   Breadth    │  default 5个 │
│          └───────┬───────┘             │
│                  │                     │
│      ┌───────────┴───────────┐         │
│      │        总量           │  max 50个 │
│      │      Total Limit     │ default 20个│
│      └───────────────────────┘         │
│                                         │
└─────────────────────────────────────────┘
```

**限制规则**：
- **深度限制**：防止过深遍历（最大6层）
- **广度限制**：防止每层获取过多记忆（最大20个）
- **总量限制**：防止总响应过大（最大50条）

**达到任一限制立即停止遍历**

### 去重机制

系统使用基于 memory key 的去重机制：

```
遍历过程：
1. 访问记忆A → 添加到已访问集合 {A}
2. 访问记忆B → 添加到已访问集合 {A, B}
3. 发现记忆A（已访问）→ 跳过，记录为重复
4. 访问记忆C → 添加到已访问集合 {A, B, C}
```

**去重统计**：响应的 metadata.duplicatesSkipped 字段显示被跳过的重复记忆数量。

---

## HTTP API 使用指南

### 基础请求

#### 使用默认参数

```bash
curl -X GET "http://localhost:3000/api/memories/project:architecture/bulk"
```

**说明**：使用系统默认参数（depth=3, breadth=5, total=20）

#### 自定义参数

```bash
# 获取更深层的关联记忆
curl -X GET "http://localhost:3000/api/memories/project:architecture/bulk?depth=5&breadth=10"

# 获取更多记忆但保持较浅的深度
curl -X GET "http://localhost:3000/api/memories/project:architecture/bulk?depth=2&breadth=15&total=40"
```

### 响应解析

#### 成功响应

```json
{
  "ok": true,
  "data": {
    "targetMemory": {
      "key": "project:architecture",
      "value": {
        "summary": "系统架构设计",
        "text": "详细的架构设计文档...",
        "links": [...]
      },
      "meta": { "score": 85, "createdAt": 1738291200 }
    },
    "associatedMemories": [
      {
        "key": "project:database",
        "value": { "summary": "数据库选型", ... },
        "meta": { "score": 78 },
        "retrievalInfo": {
          "depth": 1,
          "weight": 0.85,
          "path": ["project:architecture"]
        }
      }
    ],
    "metadata": {
      "depthReached": 3,
      "totalRetrieved": 15,
      "duplicatesSkipped": 2,
      "executionTimeMs": 45
    }
  }
}
```

**关键字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `targetMemory` | Object | 原始请求的目标记忆完整数据 |
| `associatedMemories` | Array | 关联记忆列表，按权重排序 |
| `associatedMemories[].retrievalInfo` | Object | 检索元信息：depth(深度)、weight(权重)、path(路径) |
| `metadata.depthReached` | Integer | 实际达到的最大深度 |
| `metadata.totalRetrieved` | Integer | 实际获取的记忆总数 |
| `metadata.duplicatesSkipped` | Integer | 被跳过的重复记忆数量 |
| `metadata.executionTimeMs` | Integer | 执行耗时（毫秒） |

### 错误处理

#### 记忆不存在

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Memory with key 'non:existent' not found"
  }
}
```

**处理建议**：
- 确认key拼写正确
- 使用搜索API确认记忆存在
- 检查是否需要添加namespace前缀

#### 参数验证错误

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Parameter 'depth' exceeds maximum value of 6",
    "field": "depth",
    "maxAllowed": 6,
    "provided": 10
  }
}
```

**处理建议**：
- 检查depth是否在1-6范围内
- 检查breadth是否在1-20范围内
- 检查total是否在1-50范围内

#### 系统错误

```json
{
  "ok": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Failed to execute bulk read operation"
  }
}
```

**处理建议**：
- 检查系统日志获取详细错误信息
- 联系系统管理员
- 稍后重试

### 高级使用技巧

#### 分批获取大量关联记忆

由于单次请求最多返回50条记忆，如需获取更多，可以分批请求：

```bash
# 第一批：获取目标记忆和第一层关联
curl -X GET "http://localhost:3000/api/memories/project:architecture/bulk?depth=1&breadth=20&total=50"

# 后续批次：基于第一批结果获取更深层的关联
# 解析第一批返回的associatedMemories，获取key继续请求
```

#### 结合搜索API使用

先使用搜索API找到目标记忆，然后使用批量读取获取完整上下文：

```bash
# 1. 搜索找到目标记忆
SEARCH_RESULT=$(curl -s -X GET "http://localhost:3000/search?q=系统架构&limit=1")
TARGET_KEY=$(echo $SEARCH_RESULT | jq -r '.data.results[0].key')

# 2. 批量读取获取完整上下文
curl -X GET "http://localhost:3000/api/memories/${TARGET_KEY}/bulk?depth=4"
```

---

## MCP 工具使用指南

`bulk_read_memory` 是独立的批量读取工具，不复用 `memory_get` 的参数结构。

### 基础使用

#### 使用默认参数

```json
{
  "tool": "bulk_read_memory",
  "arguments": {
    "key": "project:architecture",
    "output_format": "json"
  }
}
```

**说明**：使用系统默认参数（depth=3, breadth=5, total=20）

#### 自定义参数

```json
{
  "tool": "bulk_read_memory",
  "arguments": {
    "key": "project:architecture",
    "depth": 5,
    "breadth": 10,
    "total": 40,
    "output_format": "json"
  }
}
```

### 带 Session 的批量读取

使用session可以限制只在特定namespace下搜索：

```json
// 1. 先创建 session
{
  "tool": "session_new",
  "arguments": {}
}

// 2. 使用 session 进行批量读取
{
  "tool": "bulk_read_memory",
  "arguments": {
    "key": "project:architecture",
    "session": "your_session_key_here",
    "depth": 4,
    "breadth": 8,
    "output_format": "json"
  }
}
```

### 响应解析

#### 成功响应

```json
{
  "success": true,
  "data": {
    "targetMemory": {
      "key": "project:architecture",
      "value": {
        "summary": "系统架构设计",
        "text": "详细的架构设计文档...",
        "links": [...]
      },
      "meta": { "score": 85 }
    },
    "associatedMemories": [
      {
        "key": "project:database",
        "value": { "summary": "数据库选型", ... },
        "meta": { "score": 78 },
        "retrievalInfo": {
          "depth": 1,
          "weight": 0.85,
          "path": ["project:architecture"]
        }
      }
    ],
    "metadata": {
      "depthReached": 3,
      "totalRetrieved": 15,
      "duplicatesSkipped": 2,
      "executionTimeMs": 45
    }
  }
}
```

**关键字段说明**：

| 字段路径 | 说明 |
|---------|------|
| `data.targetMemory` | 原始请求的目标记忆完整数据 |
| `data.associatedMemories` | 关联记忆列表，按权重排序 |
| `data.associatedMemories[].retrievalInfo` | 检索元信息：depth(深度)、weight(权重)、path(路径) |
| `data.metadata.depthReached` | 实际达到的最大深度 |
| `data.metadata.totalRetrieved` | 实际获取的记忆总数 |
| `data.metadata.duplicatesSkipped` | 被跳过的重复记忆数量 |
| `data.metadata.executionTimeMs` | 执行耗时（毫秒） |

#### 错误响应

##### 记忆不存在

```json
{
  "success": false,
  "message": "Memory with key 'non:existent' not found"
}
```

**处理建议**：
- 确认key拼写正确
- 使用 `memory_search` 验证记忆存在
- 检查是否需要添加namespace前缀

##### 参数验证错误

```json
{
  "success": false,
  "message": "Parameter 'depth' exceeds maximum value of 6",
  "field": "depth",
  "maxAllowed": 6,
  "provided": 10
}
```

**处理建议**：
- 确认depth在1-6范围内
- 确认breadth在1-20范围内
- 确认total在1-50范围内

---

## 参数配置说明

### 深度（depth）

控制遍历的最大深度层级。

| 值 | 说明 | 适用场景 |
|----|------|----------|
| 1 | 仅获取直接关联 | 快速了解直接相关内容 |
| 2-3 | 获取二级/三级关联 | 标准使用场景，平衡深度和性能 |
| 4-5 | 深层探索 | 需要完整上下文时使用 |
| 6 | 最大深度 | 全面探索复杂知识网络 |

**示例**：
```json
// 只需要直接关联
depth: 1

// 标准探索
depth: 3

// 深层分析
depth: 5
```

### 广度（breadth）

控制每层获取的最大关联记忆数。

| 值 | 说明 | 适用场景 |
|----|------|----------|
| 3-5 | 精简结果 | 关注最重要的关联 |
| 8-10 | 标准范围 | 平衡质量和数量 |
| 15-20 | 广泛搜索 | 需要全面覆盖 |

**示例**：
```json
// 只看最重要的几个关联
breadth: 3

// 标准范围
breadth: 8

// 广泛搜索
breadth: 15
```

### 总量（total）

控制返回的记忆总数上限（包括目标记忆）。

| 值 | 说明 | 适用场景 |
|----|------|----------|
| 10-20 | 小型结果集 | 快速查看核心内容 |
| 30-40 | 中型结果集 | 标准分析场景 |
| 50 | 最大结果集 | 全面分析 |

**示例**：
```json
// 快速查看
total: 15

// 标准分析
total: 30

// 全面分析
total: 50
```

---

## 最佳实践

### 实践1：渐进式探索

从较小的参数开始，根据需要逐步增加。

**推荐流程**：
1. 先用小参数快速查看：`depth=2, breadth=3, total=10`
2. 如果信息不足，适度增加：`depth=3, breadth=5, total=20`
3. 需要全面分析时，使用较大参数：`depth=4, breadth=10, total=40`

### 实践2：结合搜索使用

批量读取适合在找到目标记忆后使用。

**完整流程**：
1. 使用 `memory_search` 或 `memory_fulltext_search` 搜索关键词
2. 从搜索结果中选择最相关的记忆
3. 对该记忆使用 `bulk_read_memory` 获取完整上下文

**示例**：
```bash
# 1. 搜索找到目标
POST /search?q=微服务架构

# 2. 批量读取获取完整上下文  
GET /api/memories/project:microservice-architecture/bulk?depth=4
```

### 实践3：合理使用限制

不同的场景需要不同的限制配置：

| 场景 | 推荐参数 | 说明 |
|------|----------|------|
| 快速了解 | depth=2, breadth=3 | 只看核心关联 |
| 标准分析 | depth=3, breadth=5 | 平衡深度和性能 |
| 深度调研 | depth=5, breadth=8 | 全面了解上下文 |
| 广泛搜索 | depth=3, breadth=15 | 覆盖更多关联 |

### 实践4：利用metadata分析结果

响应中的metadata字段提供了有价值的信息：

```json
{
  "metadata": {
    "depthReached": 3,
    "totalRetrieved": 15,
    "duplicatesSkipped": 2,
    "executionTimeMs": 45
  }
}
```

**如何解读**：
- `depthReached`：实际达到的深度，如果等于设置的depth，说明可能还有更多深层关联
- `duplicatesSkipped`：被跳过的重复数，如果数值大，说明网络中有较多交叉关联
- `executionTimeMs`：执行时间，如果过长，考虑减小参数

### 实践5：处理大结果集

如果经常需要获取大量关联记忆，建议：

1. **分批获取**：
   ```
   第一批：depth=1, breadth=20 获取直接关联
   第二批：对重要的直接关联再次调用获取二级关联
   ```

2. **结合过滤**：
   - 先获取一批结果
   - 筛选出重要的记忆
   - 对这些重要记忆再次批量读取

---

## 故障排除

### 问题1：返回的记忆数量少于预期

**症状**：设置的breadth=10，但返回的关联记忆只有3个

**可能原因**：
1. 目标记忆的links数组中本来就没有10个关联
2. 达到depth限制停止遍历
3. 达到total限制停止遍历
4. 其他关联记忆因重复被跳过

**排查步骤**：
1. 先调用 `memory_get` 查看目标记忆的links数量
2. 检查响应的metadata.depthReached是否等于设置的depth
3. 查看metadata.duplicatesSkipped是否大于0

**解决方案**：
- 如果links数量不足，说明确实没有更多关联，不是功能问题
- 如果达到depth限制，可以适度增加depth参数
- 如果达到total限制，可以适度增加total参数

### 问题2：执行时间过长

**症状**：调用后很长时间没有返回结果

**可能原因**：
1. depth设置过大，导致遍历层数过多
2. breadth设置过大，导致每层处理过多关联
3. 关联网络很复杂，存在大量交叉关联

**解决方案**：
1. **减小depth参数**：从5-6降低到3-4
2. **减小breadth参数**：从15-20降低到5-8
3. **分多次调用**：
   ```
   第一次：depth=2, breadth=10 获取核心关联
   第二次：选择重要的关联再次调用获取更深层的关联
   ```

### 问题3：参数验证失败

**症状**：返回参数验证错误

**常见错误**：
- `depth exceeds maximum value of 6`
- `breadth exceeds maximum value of 20`
- `total exceeds maximum value of 50`

**解决方案**：
确保参数在有效范围内：
- `depth`: 1-6
- `breadth`: 1-20
- `total`: 1-50

### 问题4：返回的结果中有重复记忆

**症状**：看起来相同的记忆出现在结果中

**说明**：这不是bug，而是功能设计的预期行为。系统会自动去重，但如果两个不同的记忆有相似的summary，可能会被误认为重复。

**验证是否真正重复**：
检查两个记忆的key是否相同，如果key不同，说明是不同的记忆，只是内容相似。

**解决方案**：
如果确实需要区分相似内容，建议在创建记忆时使用更具区分度的summary。

### 问题5：关联记忆的排序不符合预期

**症状**：期望某个关联记忆排在前面，但实际排序较后

**说明**：排序基于 `link_weight × memory_score` 计算，不是基于创建时间或其他属性。

**排查方法**：
1. 检查该关联的link_weight是否较低
2. 检查该关联记忆的score是否较低
3. 查看retrievalInfo.weight字段了解实际计算的权重

**优化建议**：
如果某个关联很重要但weight较低，可以在创建或更新记忆时调整link_weight值。

---

## 相关文档

### 核心文档

- [API 文档](../API.md) - HTTP API完整说明
- [MCP 使用指南](../MCP-README.md) - MCP工具详细说明
- [记忆衰退算法说明](MEMORY_ALGORITHM.md) - 记忆score计算说明

### 批量读取相关规范

- [批量读取功能提案](../openspec/changes/add-bulk-memory-read/proposal.md)
- [批量读取设计文档](../openspec/changes/add-bulk-memory-read/design.md)
- [批量读取API规范](../openspec/changes/add-bulk-memory-read/specs/memory-api/spec.md)
- [批量读取MCP规范](../openspec/changes/add-bulk-memory-read/specs/memory-mcp/spec.md)
- [批量读取功能规范](../openspec/changes/add-bulk-memory-read/specs/bulk-memory-read/spec.md)

### 变更记录

- [CHANGELOG.md](../CHANGELOG.md) - 项目变更历史

---

**文档维护说明**

- 本文档版本：1.0.0
- 最后更新：2025-02-13
- 维护者：Athena (Documentation Architect)
- 反馈渠道：通过Issue提交文档改进建议

---

**协议声明**

本文档遵循 athena-communication-protocol 进行整理和发布。
