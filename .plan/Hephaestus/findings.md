# Findings

## Requirements
- 用户要求修改 link 机制：`links` 不应出现在 memory 主体中。
- Agent 获取 memory 数据时，需基于 `links` 关系表列出关联关系。
- 用户补充：links 结果中需要显示关联 memory 的 `summary`。
- 用户确认：数据库不需要向后兼容，旧数据可抛弃。

## Discoveries
- 现有实现为“双写”：`memories.links` JSON 列 + `memory_links` 关系表。
- 多数读取路径先从 `memories.links` 读 JSON，再在 service 层补充 linked summary。
- 需要确保迁移与兼容逻辑不会再依赖 `memories.links` 字段。
- `KVMemory.get()`、`memoryRowToMemory()` 当前返回的 `Memory` 强制包含 `links`，这是主要耦合点。
- `memory_add`/`addMemoryController` 目前将 links 写入 memory 主体；需改为仅驱动 relation 表。
- `KVMemoryService.getMemory()` 已通过读取 link 目标 memory 补充 `summary`，满足关联摘要展示需求。
- `src/index.ts` 当前服务端口配置为 `8787`（第 18 行），与本次要求 `3030` 不一致。
- `updateMemoryKeyController` 在 `src/index.ts` 中已从 `./controller` 导入，并在 `/update_memory_key` 路由中被使用，导入状态正确。
