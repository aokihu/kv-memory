# Memory API 文档（含 score 与状态查询能力）

## 概述

本文档更新了 Memory API 中与记忆衰退算法相关的能力，重点包括：

- `meta.score` 字段定义与行为
- 状态分类规则（`active`/`cold`/`deprecated`）
- 新增查询参数（`scoreMin`、`scoreMax`、`states`、`sortBy` 等）
- 新增端点（`/api/memories/stats`、`/api/health/memory-system`）

> 注意：`domain` 和 `type` 字段已移除，不应出现在请求体或响应体中。

## 基础信息

| 项目 | 说明 |
| --- | --- |
| 主机 | `http://localhost` |
| 端口 | 默认 `3000` |
| 协议 | `HTTP/1.1` |
| 内容类型 | `application/json` |

## 核心数据模型更新

### `meta.score` 字段说明

| 字段 | 类型 | 取值范围 | 默认值 | 用途 |
| --- | --- | --- | --- | --- |
| `meta.score` | `number` | `0-100` | `50` | 表示记忆当前活跃度，用于状态分类、排序和过滤 |

规则说明：

- 新增记忆时，`meta.score` 初始值为 `50`
- 衰退算法运行时会重算 `score`
- `score` 始终限制在 `0-100`（超出会被截断）

### 状态分类说明

以下状态用于业务查询与管理：

| 状态 | score 区间 | 含义 |
| --- | --- | --- |
| `active` | `70-100` | 高活跃记忆，优先参与常规检索 |
| `cold` | `30-69` | 低活跃记忆，通常在扩展检索或回溯时出现 |
| `deprecated` | `0-29` | 已弱化/待淘汰记忆，默认不作为优先结果 |

补充：模型层还定义了 `deleted` 状态，主要用于内部生命周期管理，不建议作为常规查询目标状态。

## 端点总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/add_memory` | 新增记忆（创建时自动初始化 `score`） |
| `POST` | `/get_memory` | 获取单条记忆（返回中可包含 `meta.score`） |
| `POST` | `/update_memory` | 更新记忆内容，`score` 由算法维护 |
| `POST` | `/update_memory_key` | 重命名记忆 key |
| `GET` | `/search` | 基础检索 |
| `GET` | `/fulltext` | 多关键词检索 |
| `GET` | `/api/memories/stats` | 记忆统计（新增） |
| `GET` | `/api/health/memory-system` | 记忆系统健康检查（新增） |

## 查询参数（新增）

以下参数用于支持按分数与状态进行检索与排序（面向实现-memory-decay-algorithm 规范）：

| 参数 | 类型 | 说明 | 示例 |
| --- | --- | --- | --- |
| `scoreMin` | `number` | 最小分数，范围 `0-100` | `scoreMin=30` |
| `scoreMax` | `number` | 最大分数，范围 `0-100` | `scoreMax=90` |
| `states` | `string` | 逗号分隔状态集合 | `states=active,cold` |
| `includeAllStates` | `boolean` | 是否包含全部状态 | `includeAllStates=true` |
| `sortBy` | `string` | 排序字段，支持 `score` | `sortBy=score` |
| `sortOrder` | `string` | 排序方向：`asc`/`desc` | `sortOrder=desc` |

参数约束：

- `scoreMin` 与 `scoreMax` 需在 `0-100`
- 推荐同时提供 `scoreMin <= scoreMax`
- `states` 建议仅使用 `active,cold,deprecated`

## 新增端点详情

### `GET /api/memories/stats`

用于返回记忆状态统计、分数分布与导出内容。

请求参数（当前实现）：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fromTimestamp` | `number(int)` | 否 | 统计窗口起始时间戳 |
| `toTimestamp` | `number(int)` | 否 | 统计窗口结束时间戳 |
| `histogramBinSize` | `number(int)` | 否 | 直方图区间粒度 |
| `cacheTtlMs` | `number(int)` | 否 | 缓存有效期（毫秒） |
| `exportFormat` | `string` | 否 | 导出格式：`json`/`csv`/`both` |

示例：

```bash
curl -X GET "http://localhost:3000/api/memories/stats?fromTimestamp=1735689600000&toTimestamp=1738291200000&histogramBinSize=10&cacheTtlMs=60000&exportFormat=both"
```

响应示例（结构示意）：

```json
{
  "ok": true,
  "data": {
    "generatedAt": 1738300000000,
    "counts": {
      "total": 120,
      "active": 52,
      "cold": 49,
      "deprecated": 19
    }
  }
}
```

### `GET /api/health/memory-system`

用于返回记忆系统健康状态，包括调度器运行状态与统计查询性能。

示例：

```bash
curl -X GET "http://localhost:3000/api/health/memory-system"
```

响应示例（结构示意）：

```json
{
  "ok": true,
  "data": {
    "status": "healthy",
    "scheduler": {
      "available": true,
      "totalTaskCount": 1,
      "runningTaskCount": 1,
      "lastRunAt": 1738300000000,
      "nextRunAt": 1738300900000
    },
    "memoryOverview": {
      "generatedAt": 1738300000000,
      "totalCount": 120,
      "states": {
        "active": 52,
        "cold": 49,
        "deprecated": 19
      }
    },
    "performance": {
      "statisticsQueryDurationMs": 18,
      "schedulerFailureRate": 0
    }
  }
}
```

## 配置参数说明

### 衰退与状态配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `initialScore` | `50` | 新记忆初始分值 |
| `scoreRange` | `0-100` | 分值合法区间 |
| `activeThreshold` | `>=70` | 判定为 `active` |
| `coldThreshold` | `30-69` | 判定为 `cold` |
| `deprecatedThreshold` | `0-29` | 判定为 `deprecated` |
| `decayScheduleInterval` | `15m` | 衰退任务默认调度周期 |

### 统计接口运行参数

| 参数 | 默认行为 | 说明 |
| --- | --- | --- |
| `cacheTtlMs` | 使用服务默认缓存策略 | 控制统计结果缓存有效期 |
| `histogramBinSize` | 使用服务默认分桶策略 | 控制 score 分布图粒度 |
| `exportFormat` | `json` | 导出格式选择 |

## 使用示例

### 1) 按分数区间筛选并按 score 降序

```bash
curl -X GET "http://localhost:3000/search?q=memory&scoreMin=40&scoreMax=95&sortBy=score&sortOrder=desc"
```

### 2) 仅查询 active 与 cold 状态

```bash
curl -X GET "http://localhost:3000/search?q=agent&states=active,cold"
```

### 3) 查询全部状态并返回统计

```bash
curl -X GET "http://localhost:3000/search?q=architecture&includeAllStates=true"
curl -X GET "http://localhost:3000/api/memories/stats?exportFormat=json"
```

## 最佳实践

- 检索时优先组合 `scoreMin` + `states`，避免一次拉取过多低价值数据
- 管理后台优先使用 `/api/memories/stats` 观察状态分布，再调整阈值与衰退参数
- 健康巡检固定调用 `/api/health/memory-system`，关注 `status` 与 `scheduler` 关键字段
- 客户端迁移时彻底移除 `domain`/`type` 字段，防止 400 校验错误

## 相关文档链接

- 记忆衰退算法说明：`docs/MEMORY_ALGORITHM.md`
- 客户端迁移指南（移除 domain/type）：`docs/CLIENT_MIGRATION_GUIDE_DOMAIN_TYPE_REMOVAL.md`
- OpenSpec 变更（memory-api）：`openspec/changes/implement-memory-decay-algorithm/specs/memory-api/spec.md`
- OpenSpec 变更（memory-decay-algorithm）：`openspec/changes/implement-memory-decay-algorithm/specs/memory-decay-algorithm/spec.md`
