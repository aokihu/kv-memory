# Progress Log

## 2026-02-10
- Created planning files under `.plan/Hephaestus/`.
- Starting codebase inspection for `keys` field removal.
- Updated core runtime files (`src/type.ts`, `src/libs/db/*`, `src/libs/kv/kv.ts`, controller + mcp schema/tool/prompt) to remove removed-tag-field usage.
- Updated affected tests and benchmarks to stop passing removed tag field.
- Validation run:
  - `bun test` -> blocked by existing port conflict (`EADDRINUSE` on 8787 in `src/index.ts`).
  - Targeted tests passed: `bun test tests/kv.sqlite.test.ts tests/concurrent-access.test.ts tests/final-verification.test.ts tests/api-compatibility.test.ts tests/db.migrate.test.ts`.
- Cleaned remaining documentation/spec/script references for removed tag field (`MCP-README.md`, `test_mcp.md`, migration guide, OpenSpec main spec, MCP helper scripts).
- Verification command passed with no matches outside historical/internal areas:
  - `rg -n "\\bkeywords\\b" --glob '!openspec/changes/archive/**' --glob '!.opencode/**' --glob '!node_modules/**'`

## 2026-02-10 (Link 机制重构)
- 已重置任务计划，目标为 memory 与 links 解耦。
- Step 1 进行中：正在定位 `memories.links` JSON 列与 `memory_links` 表的读写耦合点。
- Step 1 完成：确认核心耦合位于 `src/type.ts`、`src/libs/db/query.ts`、`src/libs/kv/kv.ts`、service/controller/mcp 输入层。
- 已完成核心重构：memory 主表移除 links 读写，links 仅走 `memory_links`。
- 已落实用户补充：返回 links 时附带关联 memory summary。
- 已接收新约束：放弃历史数据库兼容，schema 不兼容时直接重建 memories/memory_links。
- 测试：`bun test tests/kv.sqlite.test.ts tests/concurrent-access.test.ts tests/api-compatibility.test.ts` 通过。
- 按最新要求更新 MCP prompt：明确 session_new/memory_add/memory_get 使用步骤，并强调 key 必须使用 ':' 作为分隔符。
