# 搜索功能使用指南

本文档提供 kvdb-mem 搜索功能的详细使用说明和示例。

## 目录
- [概述](#概述)
- [快速开始](#快速开始)
- [HTTP API 使用示例](#http-api-使用示例)
- [MCP 工具使用示例](#mcp-工具使用示例)
- [Namespace 过滤](#namespace-过滤)
- [配置说明](#配置说明)
- [高级用法](#高级用法)
- [故障排除](#故障排除)

## 概述

kvdb-mem 提供了基于 SQLite FTS5 的全文搜索功能，支持：
- 关键词搜索（单关键词）
- 全文搜索（多关键词组合）
- 相关性排序
- 分页和结果高亮
- **Namespace 过滤**（基于 session 的命名空间隔离）
- 通过 HTTP API 和 MCP 工具访问

## 快速开始

### 1. 启动服务

```bash
# 安装依赖
bun install

# 启动 HTTP 服务（默认端口 3000）
bun run dev

# 或者启动 MCP 服务
bun run mcp
```

### 2. 添加测试数据

首先添加一些测试记忆：

```bash
# 使用 curl 添加记忆
curl -X POST http://localhost:3000/add_memory \
  -H "Content-Type: application/json" \
  -d '{
    "key": "tech:quantum:basics",
    "summary": "量子计算基础概念",
    "text": "量子计算利用量子比特进行并行计算，相比经典计算机有指数级加速潜力。量子比特可以处于叠加态，这是量子计算的核心优势。"
  }'

curl -X POST http://localhost:3000/add_memory \
  -H "Content-Type: application/json" \
  -d '{
    "key": "tech:ai:llm",
    "summary": "大语言模型技术",
    "text": "大语言模型基于Transformer架构，通过自注意力机制处理序列数据。GPT系列模型在自然语言处理任务上表现出色。"
  }'

curl -X POST http://localhost:3000/add_memory \
  -H "Content-Type: application/json" \
  -d '{
    "key": "project:kvdb:design",
    "summary": "KVDB记忆系统设计",
    "text": "本项目使用SQLite实现Key-Value记忆存储，支持全文搜索和记忆链接。系统采用分层架构：Controller → Service → Lib。"
  }'
```

### 3. 执行搜索

```bash
# 搜索包含"量子"的记忆
curl "http://localhost:3000/search?q=量子"

# 全文搜索包含"量子"或"计算"的记忆
curl "http://localhost:3000/fulltext?keywords=量子,计算&operator=OR"
```

## HTTP API 使用示例

### 基础关键词搜索

```bash
# 搜索单个关键词
curl "http://localhost:3000/search?q=量子"

# 带分页的搜索
curl "http://localhost:3000/search?q=计算&limit=10&offset=0"

# 禁用关键词高亮
curl "http://localhost:3000/search?q=模型&highlight=false"
```

### 全文搜索

```bash
# 使用 OR 运算符（匹配任一关键词）
curl "http://localhost:3000/fulltext?keywords=量子,计算,比特&operator=OR"

# 使用 AND 运算符（匹配所有关键词）
curl "http://localhost:3000/fulltext?keywords=量子,计算&operator=AND"

# 带分页的全文搜索
curl "http://localhost:3000/fulltext?keywords=SQLite,搜索,架构&operator=OR&limit=5&offset=10"
```

### 响应格式

搜索 API 返回 JSON 格式的响应：

```json
{
  "status": "ok",
  "data": {
    "results": [
      {
        "key": "tech:quantum:basics",
        "summary": "量子计算基础概念",
        "text": "量子计算利用量子比特进行并行计算...",
        "excerpt": "<mark>量子</mark>计算利用<mark>量子</mark>比特进行并行计算...",
        "relevance": 0.92,
        "meta": {
          "createdAt": "2025-01-15T10:30:00Z",
          "updatedAt": "2025-01-16T14:20:00Z"
        }
      }
    ],
    "pagination": {
      "total": 15,
      "limit": 20,
      "offset": 0,
      "hasMore": false
    }
  }
}
```

## MCP 工具使用示例

### 启动 MCP 服务

```bash
# STDIO 模式（默认）
bun run mcp

# HTTP 流式模式
MCP_TRANSPORT=http bun run mcp
```

### 使用 memory_search 工具

```json
{
  "tool": "memory_search",
  "arguments": {
    "query": "量子计算",
    "limit": 10,
    "offset": 0,
    "highlight": true,
    "output_format": "json"
  }
}
```

### 使用 memory_fulltext_search 工具

```json
{
  "tool": "memory_fulltext_search",
  "arguments": {
    "keywords": "量子,计算,比特",
    "operator": "OR",
    "limit": 5,
    "highlight": true,
    "output_format": "json"
  }
}
```

### MCP 工具响应示例

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "key": "tech:quantum:basics",
        "summary": "量子计算基础概念",
        "excerpt": "<mark>量子</mark>计算利用<mark>量子</mark>比特进行并行计算...",
        "relevance": 0.92,
        "score": 0.92
      }
    ],
    "pagination": {
      "total": 3,
      "limit": 10,
      "offset": 0,
      "hasMore": false
    }
  }
}
```

## Namespace 过滤

搜索功能支持基于 session 的 namespace 过滤，允许不同 session 的用户只能搜索到自己 namespace 下的记忆。

### 核心概念

| 概念 | 说明 |
|------|------|
| **Session** | 用户会话标识，通过 `/login` 或 `session_new` 创建 |
| **Namespace** | 每个 session 关联的命名空间，记忆的 key 以 `{namespace}:` 开头 |
| **过滤机制** | 提供有效 session 时，搜索只返回该 namespace 下的记忆 |

### Session 与 Namespace 的关系

```
用户请求
    │
    ▼
Session (abc123)
    │
    ├── kv_namespace: "project_a"
    │
    ▼
搜索 "量子"
    │
    └── 只返回 key 以 "project_a:" 开头的记忆
        例如：project_a:decision:001 ✓
              project_a:tech:quantum ✓
              other_project:note:001 ✗ (被过滤)
```

### 使用 HTTP API 进行 Namespace 过滤

#### 1. 创建 Session 并获取 Namespace

```bash
# 获取 session 和 namespace
curl http://localhost:3000/login
```

响应示例：
```json
{
  "status": "ok",
  "data": {
    "session": "a1b2c3d4e5f6",
    "namespace": "user_alice",
    "expiresAt": "2025-01-20T10:30:00Z"
  }
}
```

#### 2. 添加带 Namespace 的记忆

```bash
# 添加记忆（key 需要以 namespace 开头）
curl -X POST http://localhost:3000/add_memory \
  -H "Content-Type: application/json" \
  -d '{
    "key": "user_alice:project:quantum_research",
    "summary": "量子计算研究项目",
    "text": "本项目探索量子计算在密码学中的应用..."
  }'
```

#### 3. 使用 Session 进行 Namespace 过滤搜索

```bash
# 全局搜索（所有 namespace）
curl "http://localhost:3000/search?q=量子"

# Namespace 过滤搜索（只搜索 user_alice 的记忆）
curl "http://localhost:3000/search?q=量子&session=a1b2c3d4e5f6"

# 带 session 的全文搜索
curl "http://localhost:3000/fulltext?keywords=量子,计算&session=a1b2c3d4e5f6&operator=OR"
```

### 使用 MCP 工具进行 Namespace 过滤

#### 1. 创建 Session

```json
{
  "tool": "session_new",
  "arguments": {}
}
```

响应：
```json
{
  "success": true,
  "session": "b2c3d4e5f6g7"
}
```

#### 2. 添加带 Namespace 的记忆

```json
{
  "tool": "memory_add",
  "arguments": {
    "key": "myproject:decision:architecture",
    "value": {
      "summary": "系统架构决策",
      "text": "我们决定采用微服务架构来实现更好的可扩展性...",
      "links": []
    }
  }
}
```

#### 3. 使用 Session 进行 Namespace 过滤搜索

```json
// 基础关键词搜索（带 namespace 过滤）
{
  "tool": "memory_search",
  "arguments": {
    "query": "架构",
    "session": "b2c3d4e5f6g7",
    "limit": 10,
    "output_format": "json"
  }
}

// 全文搜索（带 namespace 过滤）
{
  "tool": "memory_fulltext_search",
  "arguments": {
    "keywords": "微服务,架构",
    "session": "b2c3d4e5f6g7",
    "operator": "OR",
    "limit": 10,
    "output_format": "json"
  }
}
```

### 典型使用场景

#### 场景 1：多用户数据隔离

在 SaaS 应用中，每个用户的数据需要完全隔离：

```typescript
// 用户 A 登录时创建 session
const sessionA = await createSession('user_alice');

// 用户 A 只能搜索自己的记忆
const results = await search('项目计划', { session: sessionA });
// 只返回 key 以 "user_alice:" 开头的记忆
```

#### 场景 2：项目隔离

同一用户在不同项目中的记忆需要隔离：

```typescript
// 项目 A 的 session
const projectASession = await createSession('project_a');

// 项目 B 的 session
const projectBSession = await createSession('project_b');

// 在项目 A 中搜索
curl "http://localhost:3000/search?q=决策&session=project_a_session"
// 只返回 project_a namespace 的记忆
```

#### 场景 3：全局搜索（管理员）

管理员需要跨 namespace 搜索：

```typescript
// 管理员执行全局搜索（不提供 session）
const allResults = await search('系统配置', { 
  // 不提供 session 参数
});
// 返回所有 namespace 的匹配结果
```

### 错误处理

#### 无效 Session

```json
// HTTP API 返回 401
{
  "success": false,
  "message": "invalid session"
}

// MCP 工具返回
{
  "success": false,
  "message": "invalid session"
}
```

**解决方案**：
1. 重新调用 `/login` 或 `session_new` 获取新 session
2. 检查 session 字符串是否拼写正确
3. 确认 session 未过期（默认 3 分钟）

### 最佳实践

1. **始终使用 namespace 前缀**：添加记忆时，确保 key 包含 namespace 前缀
   ```
   推荐: user_alice:project:decision_001
   避免: decision_001 (无法被 namespace 过滤找到)
   ```

2. **Session 缓存**：在客户端缓存 session，避免频繁创建

3. **错误处理**：始终处理 `invalid session` 错误，自动刷新 session

4. **权限控制**：管理员功能可以通过不提供 session 来实现全局搜索

## 配置说明

### 环境变量

搜索功能可以通过以下环境变量配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `KVDB_SEARCH_ENABLED` | `true` | 是否启用搜索功能 |
| `KVDB_SEARCH_DEFAULT_LIMIT` | `20` | 默认搜索结果数量 |
| `KVDB_SEARCH_MAX_LIMIT` | `100` | 最大搜索结果数量 |

### 数据库配置

搜索功能使用 SQLite FTS5 扩展，需要确保：
1. SQLite 编译时启用了 FTS5 支持
2. 数据库迁移脚本已运行（自动创建 FTS5 表）

### 索引维护

系统提供索引维护工具：

```bash
# 优化 FTS5 索引（减少碎片）
curl -X POST http://localhost:3000/admin/optimize-fts-index

# 重建 FTS5 索引（数据损坏时使用）
curl -X POST http://localhost:3000/admin/rebuild-fts-index
```

## 高级用法

### 1. 中文搜索优化

FTS5 使用 `unicode61` 分词器，对中文支持有限。如需更好的中文分词，可以考虑：

```typescript
// 在应用层添加简单的中文分词预处理
function preprocessChineseQuery(query: string): string {
  // 简单的中文分词：按字符分割
  return query.split('').join(' ');
}

// 使用预处理后的查询
const processedQuery = preprocessChineseQuery('量子计算');
```

### 2. 搜索结果缓存

对于高频搜索查询，可以添加缓存层：

```typescript
import { LRUCache } from 'lru-cache';

const searchCache = new LRUCache<string, SearchResponse>({
  max: 100, // 最大缓存条目数
  ttl: 60 * 1000, // 缓存有效期：1分钟
});

async function searchWithCache(query: string, params: SearchParams): Promise<SearchResponse> {
  const cacheKey = `${query}:${JSON.stringify(params)}`;
  
  const cached = searchCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  
  const result = await searchService.search(query, params);
  searchCache.set(cacheKey, result);
  return result;
}
```

### 3. 搜索性能监控

监控搜索性能指标：

```typescript
// 记录搜索性能指标
async function trackSearchPerformance(
  query: string,
  duration: number,
  resultCount: number
) {
  console.log({
    event: 'search_performance',
    query,
    duration_ms: duration,
    result_count: resultCount,
    timestamp: new Date().toISOString(),
  });
}

// 在搜索函数中使用
const startTime = Date.now();
const results = await searchService.search(query, params);
const duration = Date.now() - startTime;

trackSearchPerformance(query, duration, results.pagination.total);
```

## 故障排除

### 常见问题

#### 1. 搜索返回空结果

**可能原因：**
- 数据库中没有匹配的记忆
- FTS5 表未正确创建
- 搜索功能被禁用

**解决方案：**
```bash
# 检查搜索功能是否启用
echo $KVDB_SEARCH_ENABLED

# 检查 FTS5 表是否存在
sqlite3 kv.db "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts';"

# 验证记忆数据
sqlite3 kv.db "SELECT key, summary FROM memories LIMIT 5;"
```

#### 2. 搜索性能慢

**可能原因：**
- 索引碎片化
- 数据量过大
- 查询过于复杂

**解决方案：**
```bash
# 优化索引
curl -X POST http://localhost:3000/admin/optimize-fts-index

# 限制搜索结果数量
curl "http://localhost:3000/search?q=关键词&limit=10"

# 添加搜索条件过滤
# （当前版本支持基础过滤，后续版本可扩展）
```

#### 3. 中文搜索不准确

**可能原因：**
- FTS5 默认分词器对中文支持有限
- 查询词包含停用词

**解决方案：**
```bash
# 使用更简单的查询词
curl "http://localhost:3000/search?q=量子"

# 或者使用全文搜索
curl "http://localhost:3000/fulltext?keywords=量子,计算&operator=OR"
```

#### 4. MCP 搜索工具不可用

**可能原因：**
- MCP 服务未启动
- 工具未正确注册
- 客户端连接问题

**解决方案：**
```bash
# 检查 MCP 服务状态
ps aux | grep "bun run mcp"

# 重启 MCP 服务
bun run mcp

# 检查工具注册
grep -n "memory_search" src/mcp/server.ts
```

### 错误代码

| HTTP 状态码 | 错误代码 | 说明 | 解决方案 |
|------------|----------|------|----------|
| 400 | `bad_request` | 参数格式错误 | 检查请求参数格式 |
| 400 | `invalid_operator` | 无效的逻辑运算符 | operator 只能是 AND 或 OR |
| 400 | `invalid_limit_offset` | 无效的分页参数 | limit 和 offset 必须是有效数字 |
| 500 | `search_disabled` | 搜索功能未启用 | 设置 KVDB_SEARCH_ENABLED=true |
| 500 | `database_error` | 数据库错误 | 检查数据库连接和权限 |

## 最佳实践

### 1. 查询优化
- 使用具体的查询词而非模糊词
- 合理使用 limit 参数限制结果数量
- 对于复杂查询，使用全文搜索的 AND 运算符

### 2. 性能优化
- 定期优化 FTS5 索引
- 为高频查询添加缓存
- 监控搜索性能指标

### 3. 用户体验
- 提供搜索建议（后续版本功能）
- 显示搜索结果的摘要和高亮
- 支持分页浏览大量结果

### 4. 数据质量
- 确保记忆有清晰的摘要字段
- 定期清理无效或过期的记忆
- 维护记忆之间的链接关系

## 后续计划

搜索功能的后续改进计划包括：

1. **中文分词优化**：集成更好的中文分词器
2. **搜索建议**：提供输入时的搜索建议
3. **高级过滤**：支持按标签、时间范围等过滤
4. **搜索结果排序**：支持按时间、相关性等多种排序方式
5. **搜索历史**：记录用户的搜索历史

如有问题或建议，请参考项目文档或提交 Issue。