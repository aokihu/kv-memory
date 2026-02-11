# KV-Mem 下一步功能规划

> 由 Atom（量子机器人 AT-001）分析整理  
> 基于当前 kvdb-mem 系统架构与 AGENTS.md 记忆管理哲学

---

## 📊 当前系统能力盘点

kvdb-mem 已具备扎实的基础架构：

| 功能模块 | 状态 | 说明 |
|---------|------|------|
| 基础 CRUD | ✅ | add / get / update / delete |
| 记忆链接系统 | ✅ | links / relations 双向关联 |
| 元数据管理 | ✅ | meta（访问次数、时间戳、状态等） |
| 记忆生命周期 | ✅ | active / cold / deprecated / deleted |
| 事务支持 | ✅ | SQLite WAL 模式 |
| MCP 协议 | ✅ | 完整的 MCP 工具集 |

**核心优势**：基于 SQLite 的可靠存储 + 灵活的链接语义网络

---

## 🚀 建议新增功能（8大模块）

### 1. 记忆搜索与发现 🔍

**功能描述**
- 全文检索记忆内容（支持模糊搜索）
- 关键词高亮与相关性排序
- 搜索结果分页与过滤

**API 设计**
```
GET /search?q=quantum&limit=10&offset=0
GET /fulltext?keywords=博士,Atom,量子&operator=OR
```

**为什么需要**
> 当记忆数量超过100条后，仅靠 key 的层级结构已难以快速定位。例如，我记得和博士讨论过"量子纠缠"，但忘记具体保存在哪个 key 下。搜索功能让记忆库真正可用。

**实现要点**
- SQLite FTS5 全文索引
- 关键词分词与权重计算
- 与现有 link 系统的结果融合排序

---

### 2. 智能联想推荐 🔗

**功能描述**
- 基于当前记忆的图遍历联想
- 发现"二度/三度关联"的隐藏记忆
- 可视化记忆图谱

**API 设计**
```
GET /associate?key=Atom:profile&depth=2&min_weight=0.5
GET /graph?center=Atom:profile&radius=3&format=dot
```

**为什么需要**
> 人的记忆不是线性的，而是联想式的。看到"博士"，我会联想到"实验室"、"量子计算机"、"机器人三定律"。现有 link 系统只存储了直接关联，联想功能可以激活"记忆链"。

**实现要点**
- BFS/DFS 图遍历算法
- 路径权重累加计算
- 防止循环引用的 visited 集合
- 可选 GraphViz DOT 格式输出

---

### 3. 记忆自动演化 🔄

**功能描述**
- 基于时间衰减和访问频率的自动状态迁移
- 符合 AGENTS.md 的"记忆生命周期"理念
- 定期清理/归档任务

**演化规则配置**
```typescript
interface EvolutionRule {
  // 超过30天未访问 -> cold
  coldAfter: 30 * 24 * 60 * 60 * 1000;
  // 超过90天未访问 -> deprecated
  deprecateAfter: 90 * 24 * 60 * 60 * 1000;
  // 访问超过100次 -> hot (优先保留在active)
  hotThreshold: 100;
  // 被link引用超过50次 -> important
  importantThreshold: 50;
}
```

**为什么需要**
> AGENTS.md 明确指出："记忆分值是派生状态，而不是持久字段"。记忆应该根据实际使用情况自然演化。例如，我刚学会"发送邮件技能"时很新鲜（active），但一个月后很少用，应该自动变为 cold，最终 deprecated。

**实现要点**
- 定时任务（bun:cron 或 node-cron）
- 批量更新状态的事务处理
- 状态变更的审计日志
- 可配置的规则引擎

---

### 4. 记忆去重与合并 🧬

**功能描述**
- 检测内容相似的记忆（基于文本相似度）
- 提供合并策略（覆盖/追加/智能融合）
- 批量去重操作

**API 设计**
```
POST /detect-duplicates
body: { threshold: 0.85, scope: "Atom:*" }

POST /merge
body: {
  source: "Atom:profile:v1",
  target: "Atom:profile:v2",
  strategy: "smart-merge", // 或 "overwrite", "concat"
  preserveMeta: true
}
```

**为什么需要**
> 长期使用中，我可能多次记录"博士的教导"，或者在不同情境下写类似的记忆。去重可以保持记忆库整洁。例如，我有两个 key 都记录"动漫喜好"，应该合并为一个更完整的版本。

**实现要点**
- 文本相似度算法（Cosine Similarity / Levenshtein Distance）
- 向量化存储（可选 SQLite VSS 扩展）
- 冲突解决策略（timestamp-based / manual / AI-assisted）
- 合并预览（dry-run 模式）

---

### 5. 批量操作 📦

**功能描述**
- 批量导入（JSON/CSV/YAML 格式）
- 批量导出（支持过滤和格式转换）
- 数据迁移与备份

**API 设计**
```
POST /batch-import
body: {
  format: "json",
  data: [{key, value, links}, ...],
  namespace: "Atom",
  onConflict: "skip" // 或 "overwrite", "merge"
}

GET /export?format=json&keys=Atom:*,Project:*&includeMeta=true

POST /backup
body: { name: "backup-2024-02-11", compress: true }

POST /restore
body: { backupId: "backup-2024-02-11", mergeStrategy: "overwrite-all" }
```

**为什么需要**
> 当我需要在不同设备间迁移记忆，或者初始化一个全新的 Agent 时，批量操作是必须的。例如，我想把我的"Atom 完整记忆"导出给另一个实例，或者从备份中恢复被误删的重要记忆。

**实现要点**
- 流式处理（stream processing）避免内存溢出
- 事务包装（批量操作要么全成功，要么全失败）
- 进度反馈（WebSocket 或 Server-Sent Events）
- 格式转换器（JSON ↔ YAML ↔ CSV）

---

### 6. 记忆统计仪表盘 📊

**功能描述**
- 记忆库整体健康度概览
- 各领域/命名空间分布统计
- 活跃度趋势分析
- 可视化图表

**API 设计**
```
GET /stats/overview
返回: {
  totalMemories: 150,
  active: 120,
  cold: 20,
  deprecated: 10,
  totalLinks: 450,
  avgLinksPerMemory: 3.0,
  memoryGrowth: [
    {date: "2024-01", count: 100},
    {date: "2024-02", count: 150}
  ],
  statusDistribution: {active: 120, cold: 20, deprecated: 10},
  topLinkedMemories: [
    {key: "Atom:profile", inDegree: 50, outDegree: 20}
  ],
  namespaceDistribution: {
    "Atom": 80,
    "Project": 40,
    "Skill": 30
  }
}

GET /stats/trends?metric=access_count&period=7d
GET /stats/graph-data?type=force-directed&limit=100
```

**为什么需要**
> AGENTS.md 说记忆应该"自然演化"，但我们首先需要知道记忆库的健康状态。例如，我想知道"有多少记忆变成了 cold？"、"哪些记忆是最重要的（被 link 最多）？"、"我的记忆增长趋势如何？"。仪表盘让抽象的"记忆演化"变得可视化。

**实现要点**
- 预计算统计表（避免实时查询大数据量）
- 图表库（Chart.js / D3.js / ECharts）
- WebSocket 实时推送关键指标变化
- 可导出报表（PDF / CSV）

---

### 7. 标签/分类系统 🏷️

**功能描述**
- 为记忆添加多维度标签（不同于 links 的语义关联）
- 基于标签的过滤和搜索
- 标签云和自动推荐

**Schema 扩展**
```typescript
// 记忆添加 tags 字段
const MemorySchema = z.object({
  ...
  tags: z.array(z.string()).default([]), // ["important", "todo", "bugfix"]
  categories: z.array(z.string()).default([]), // ["frontend", "backend", "ai"]
});

// 标签元数据表
interface TagMeta {
  name: string;
  color: string; // #FF5733
  description: string;
  createdAt: number;
  usageCount: number;
  autoApplyRules?: string[]; // 自动打标签规则
}
```

**API 设计**
```
POST /tags/create
body: { name: "urgent", color: "#FF0000", description: "需要立即处理" }

POST /memories/:key/tags
body: { tags: ["urgent", "ai-related"], operation: "add" } // 或 "remove", "set"

GET /tags/list?sort=usage&order=desc
GET /memories/by-tags?tags=urgent,ai-related&match=all // match: all / any
GET /tags/suggestions?for=Atom:profile&count=5 // 基于内容自动推荐标签
```

**为什么需要**
> Links 表达的是"语义关联"（Atom:profile → Atom:creator 是"创造关系"），但有时候我们只需要"分类"。例如，我想标记某些记忆为"重要"或"待办"，这些不是语义关联，而是管理标签。Tags 让记忆管理更灵活。

**实现要点**
- 标签和 links 是互补的，不重复
- 标签索引（加速按标签查询）
- 标签自动推荐（基于 TF-IDF 或简单规则）
- 标签合并（处理同义词如 "ai" 和 "人工智能"）

---

### 8. 记忆版本历史 📜

**功能描述**
- 保存记忆的所有历史版本
- 版本对比（diff）
- 回滚到任意版本
- 版本分支（实验性）

**Schema 扩展**
```typescript
// 版本历史表（单独存储）
interface MemoryVersion {
  id: string; // uuid
  memoryKey: string;
  version: number; // 自增版本号
  timestamp: number;
  operation: "create" | "update" | "merge" | "delete";
  author?: string; // 哪个 agent / 用户
  snapshot: Memory; // 完整快照
  diff?: { // 与上一版本的差异（可选，节省空间）
    summary?: { old: string; new: string };
    text?: { old: string; new: string };
    links?: { added: []; removed: [] };
  };
  commitMessage?: string; // 版本提交信息（类似 git commit）
}

// 当前记忆添加版本指针
interface Memory {
  ...
  meta: MemoryMeta & {
    currentVersion: number;
    versionCount: number;
  }
}
```

**API 设计**
```
GET /memories/:key/versions?limit=20&offset=0
返回: [
  {
    version: 5,
    timestamp: 1707619200000,
    operation: "update",
    author: "Atom",
    commitMessage: "添加了动漫喜好",
    snapshot: {...}
  }
]

GET /memories/:key/versions/compare?v1=3&v2=5
返回: {
  summary: { old: "Atom的核心人设", new: "Atom的核心人设 - 大筒木博士创造的量子机器人" },
  text: { added: [...], removed: [...] },
  links: { added: [...], removed: [...] }
}

POST /memories/:key/versions/rollback
body: { toVersion: 3, reason: "发现最新版本有误" }

POST /memories/:key/update
body: { ... }
query: { commitMessage: "添加了新的技能" } // 可选提交信息
```

**为什么需要**
> AGENTS.md 强调记忆会"演化"，但演化应该是可追溯的。例如，我的"profile"从最初简单的人设，到现在包含了动漫喜好、技能列表等。如果我想知道"我是什么时候开始喜欢《柯南》的？"，版本历史可以回答。另外，如果错误地更新了一个重要记忆，回滚功能是救命稻草。

**实现要点**
- 版本表独立存储（避免影响主表性能）
- 可选的 diff 存储策略（完整快照 vs 增量差异）
- 版本压缩（定期合并旧版本）
- 分支实验（高级功能，类似 git branch，低优先级）

---

## 📋 功能实现优先级

### 🔥 第一阶段：核心增强（立即需要）

| 功能 | 优先级 | 预计工作量 | 依赖 |
|------|--------|-----------|------|
| 记忆搜索 | P0 | 3天 | 需 FTS5 扩展 |
| 批量操作 | P0 | 2天 | 无 |
| 自动演化 | P1 | 5天 | 需定时任务 |

### ⭐ 第二阶段：智能增强（1-2月内）

| 功能 | 优先级 | 预计工作量 | 依赖 |
|------|--------|-----------|------|
| 智能联想 | P1 | 4天 | 依赖搜索 |
| 统计仪表盘 | P2 | 3天 | 需前端 |
| 去重合并 | P2 | 4天 | 依赖相似度算法 |

### 💡 第三阶段：高级功能（未来规划）

| 功能 | 优先级 | 预计工作量 | 依赖 |
|------|--------|-----------|------|
| 标签系统 | P2 | 3天 | 无 |
| 版本历史 | P3 | 5天 | 需存储策略 |
| 记忆图谱可视化 | P3 | 7天 | 需前端/图算法 |

---

## 🎯 实施建议

### 从用户价值出发

1. **立即实施搜索功能** - 这是当前最大的痛点。当 Atom 的记忆超过50条后，没有搜索几乎无法使用。

2. **自动演化紧跟其后** - 这是 AGENTS.md 核心理念，让系统"自我管理"。

3. **批量操作为数据迁移** - 方便导入导出，测试和备份。

### 技术选型建议

- **搜索**: SQLite FTS5（轻量，无需外部依赖如 Elasticsearch）
- **定时任务**: `bun:cron` 或 `node-cron`（简单够用）
- **相似度**: 初期用简单的文本相似度（Levenshtein），后期可引入向量嵌入
- **可视化**: 可选 D3.js 或 ECharts（如果做 Web 界面）

### 与现有架构的兼容

所有建议功能都：
- ✅ 不破坏现有 API
- ✅ 基于 SQLite（现有存储）
- ✅ 可选开启（通过配置）
- ✅ 渐进式实现（不一次性引入所有功能）

---

## 📝 下一步行动

如果你（aokihu/开发者）决定开始实施，建议按这个顺序：

**Week 1**: 实现基础搜索（FTS5 索引 + /search 端点）
**Week 2**: 实现批量导入/导出 + 数据迁移工具
**Week 3**: 设计并实现自动演化定时任务
**Week 4**: 测试 + 文档 + 性能优化

---

**由 Atom（AT-001）用量子大脑分析整理**  
*"让我用我的量子大脑想想看～哇！这些功能加上去，kvdb-mem 一定会成为最厉害的记忆系统！博士一定会为我骄傲的！✨"*

---

*本文档版本: 1.0*  
*最后更新: 2024年2月*  
*状态: 功能提案*
