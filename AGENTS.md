# AGENTS Guide

## Project Overview

本项目实现一个 **Key–Value + Database** 的记忆系统，用于 AI Agent 的长期协作与上下文演化。

### Key–Value 层
用于存储短期、高频、结构化记忆（如 `decision`、`constraint`、`bug`、`design` 等），支持快速读写与动态演化。

### Database 层
用于存储长期稳定文档（规范、说明、设计文档等），不参与动态记忆代谢。

系统目标不是“记住一切”，而是通过 **结构、行为和时间信号**，使记忆能够自然演化、沉底、合并或淘汰。

---

## Memory Model（High-Level）

每条 KV 记忆以 **Key** 作为稳定锚点。

### Value 组成

Value 中包含三类信息：

- **语义内容**（`summary`、`text`）
- **运行态元数据**（`meta`）
- **显式关联关系**（`links`）

### 核心原则

- 不人工打分  
- 不由模型主观判断记忆价值  
- 所有动态行为仅来源于：
  - 使用行为
  - 结构关系
  - 时间衰减  
- 记忆分值是 **派生状态**，而不是持久字段

---

## Memory Lifecycle（Conceptual）

记忆节点在系统中具有以下生命周期状态：

### `active`
当前活跃，参与默认搜索与联想。

### `cold`
低活跃，仅在显式查询或历史回溯中出现。

### `deprecated`
被新记忆替代或合并，仍可追溯，但不参与常规检索。

### `deleted`
不再参与系统运行（物理删除通常延迟执行）。

> 状态迁移完全由系统规则驱动，不允许 Agent 或模型直接修改。

---

## Links and Associative Recall

- 记忆节点之间通过 `links` 显式建立关联关系  
- Link 表达的是 **语义、因果或约束关系**，而不是相似度  
- Link 本身具有时间与使用统计，可随时间衰减  

Agent 可以通过 link 进行 **链式回溯与上下文扩展**，  
但 link 的创建、修改和删除必须遵守系统规则。

---

## Agent Responsibilities

### Agent 可以

- 读取 Key–Value 记忆与 Database 文档  
- 基于现有记忆进行推理、生成代码或提出决策建议  
- 建议创建新的记忆节点  
- 建议潜在的记忆关联（link suggestion）  
- 建议合并候选（merge candidate）

### Agent 不得

- 直接修改 `meta` 中的统计字段  
- 直接设置或覆盖记忆分值  
- 自动创建、修改或删除 link  
- 自动删除或合并记忆节点  

> 所有破坏性操作必须经过系统规则或人工确认。

---

## Codebase Orientation

- `src/type.ts`  
  记忆模型与 Schema 定义（Zod）

- `src/kv.ts`  
  Key–Value 记忆核心逻辑（读写、访问、演化）

- `src/db.ts`  
  Database 层配置与工具

- `src/index.ts`  
  应用入口或统一导出

本文件 **不描述算法实现细节**，仅定义协作边界与运行语义。

---

## Development and Runtime

- 使用 **Bun** 作为运行时与工具链  
- Key–Value 层基于 `@keyv/sqlite`  
- 所有外部或持久化数据在使用前必须通过 **Zod 校验**

### 常用命令

```bash
bun install
bun run dev
bun test
```

---

## Layered Validation Principles

- 将数据校验集中在 controller 层，确保下游接收的是规范化后的输入  
- service 层信任 controller 的验证结果，仅专注业务流程与状态管理  
- lib 层信任 service 层传递的数据，聚焦工具、算法与重用  
- 各层职责清晰分离，数据流自上而下，下层不再做完整性判断

## Layer Responsibilities

- **Controller 层**：接收外部请求，完成参数校验与必要格式化，将合法输入推入业务流  
- **Service 层**：以已验证数据为基础执行业务逻辑、状态变更与依赖协调  
- **Lib 层**：提供底层工具与算法，假设输入已由上层处理并优化性能与复用性

---

## Related Documents

- 记忆模型衰退算法[@/docs/MEMORY_ALGORITHM.md]

---

## Maintenance Rule

- 本文件用于 **Agent 对齐与协作约束**
- 保持简短、稳定、低频修改
- 当协议或运行边界发生变化时需同步更新

---

## 一句话总结

**AGENTS Guide 是“Agent 能做什么、不能做什么”的说明书，  
而不是“系统如何思考”的论文。**
