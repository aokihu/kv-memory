# Findings & Decisions

## Current Task Requirements
- Run full test suite with `bun test`
- Ensure all expected existing tests pass
- If failures exist, analyze and fix

## Failure Snapshot (initial `bun test`)
- Totals: `91 pass`, `45 fail`, `1 error`, `136 tests / 22 files`
- High-frequency failure signature: `TypeError ... .run is not a function`
  - Seen in `src/libs/kv/kv.ts` constructor (`this._database.run(...)`)
  - Seen in tests calling `db.query(...).run(...)`
- Search service failure signature: `this.kv.getLinks is not a function`
- API compatibility failure signature: Zod expects object but receives string in add/get flow

## Working Hypotheses
1. DB compatibility layer changed, but code/tests still rely on statement `.run()` and/or db `.run()` methods.
2. `SearchService` now assumes `kv.getLinks` exists, but mock in unit tests does not provide it.
3. Request schema for add-memory no longer accepts test payload shape.

## Resolutions Applied
- Restored KVMemoryService backward-compatible overloads for namespace and non-namespace call styles (`addMemory`, `updateMemory`, `updateKey`, `traverseMemory`).
- Updated `KVMemory` startup PRAGMA calls to use `exec`.
- Updated `SearchService`:
  - dependency injection support for unit tests (database/searchEnabled)
  - namespace SQL compatibility (`AND key LIKE ?` when no join)
  - optional `kv.getLinks` fallback to empty links
  - omit empty links in result payload for compatibility
- Removed global module mock coupling in `tests/search.service.test.ts` to prevent cross-file contamination.
- Added `sortLinks` validation to MCP `MemoryGetSchema`.
- Stabilized `tests/all.test.ts` keys with run-specific suffix to avoid cross-run conflicts.

## Resources
- `/home/aokihu/.local/share/opencode/tool-output/tool_c571cafda001wk2Rd3gR2eD0oz`
- `src/libs/kv/kv.ts`
- `src/service/searchService.ts`
- `tests/all.test.ts`

## New Task Findings: BULK_READ_GUIDE naming migration
- Target file: `docs/BULK_READ_GUIDE.md`
- Replaced MCP tool name: `memory_bulk_read` -> `bulk_read_memory`
- Replaced MCP parameter name: `totalLimit` -> `total`
- Updated all related MCP JSON examples and textual references
- Added explicit architecture statement: `bulk_read_memory` is a standalone MCP bulk-read tool
