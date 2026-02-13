# Findings

## 2026-02-13
- `src/controller/getMemory.ts` requires `sortLinks` validation alignment with `src/controller/searchController.ts`.
- Expected behavior from task: accept boolean and string `"true"`/`"false"`, default to `true`, and return clear validation errors.
- `searchController.ts` uses `z.preprocess` to normalize empty/boolean/string values, then `z.boolean().optional().default(true)`.
- In current Zod version, boolean schema custom message uses `{ message: ... }` instead of `invalid_type_error`.
- MCP search tools currently define local schemas inside `memorySearch.ts` and `memoryFulltextSearch.ts`; they do not use `src/mcp/schemas/search.ts`.
- `src/service/searchService.ts` already supports `sortLinks` and defaults to `true`; MCP gap is mainly schema wiring and `KVMemoryService` argument forwarding.
- `src/service/kvmemory.ts#getMemory` currently has no `sortLinks` argument and always returns DB link order; this must be extended for HTTP/MCP consistency.
- MCP test helper `callRegisteredTool` returns parse errors via `isError: true` with first issue message; suitable for validating invalid `sortLinks` values.
- Existing test cleanup only matched keys prefixed directly with `mcp_search_test_`; namespace-prefixed keys (`namespace:mcp_search_test_*`) require `%:mcp_search_test_%` pattern for reliable cleanup.
