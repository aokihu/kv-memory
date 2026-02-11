# Task Plan

## Goal
调整 link 机制：memory 实体不再携带 links 字段；读取 memory 时由 links 关系表组装并返回关联关系。

## Steps
1. 审查当前 memory/links 数据模型与读写链路，定位 links 在 memory 中的耦合点。
2. 更新类型与数据库读写逻辑，使 memory 主体不再存储 links 字段。
3. 更新查询/服务层：读取 memory 时从 links 表装配关联关系返回给 Agent。
4. 对接入口层（controller/mcp schema/tool/prompt）以匹配新输入输出结构。
5. 更新相关测试并运行目标测试验证行为。

## Status
- [completed] Step 1
- [completed] Step 2
- [completed] Step 3
- [completed] Step 4
- [completed] Step 5

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| session-catchup.py not found at expected path | 1 | Continue with manual planning files in `.plan/Hephaestus/` |
| `bun test` failed with `EADDRINUSE` on port 8787 | 1 | Ran targeted test files that cover modified paths; all passed |
| migration compatibility tests mismatch after schema decoupling | 1 | User confirmed old DB compatibility can be dropped; keep focus on current runtime path |
