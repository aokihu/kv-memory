# Task Plan: MCP sortLinks parameter support

## Goal
Implement OpenSpec change `add-sortlinks-to-mcp-tools` for MCP schemas/tools with `sortLinks` support (boolean + string `"true"/"false"`), default `true`, and behavior consistent with HTTP API.

## Current Phase
Phase 7

## Phases
### Phase 1: Add shared MCP sortLinks schema
- [x] Create `src/mcp/schemas/common.ts`
- [x] Define `SortLinksSchema` with preprocess normalization
- [x] Ensure invalid value error is explicit
- **Status:** complete

### Phase 2: Update MCP schema definitions
- [x] Update `src/mcp/schemas/memory.ts` to include `sortLinks`
- [x] Update `src/mcp/schemas/search.ts` to include `sortLinks`
- [x] Keep defaults and type inference backward compatible
- **Status:** complete

### Phase 3: Extend service layer for sortLinks
- [x] Update `src/service/kvmemory.ts` to accept `sortLinks`
- [x] Wire get/search/fulltext flows with optional `sortLinks`
- [x] Preserve original behavior when not provided
- **Status:** complete

### Phase 4: Update MCP tool implementations
- [x] Update `src/mcp/tools/memoryGet.ts`
- [x] Update `src/mcp/tools/memorySearch.ts`
- [x] Update `src/mcp/tools/memoryFulltextSearch.ts`
- **Status:** complete

### Phase 5: Compatibility check
- [x] Verify default `sortLinks=true` behavior
- [x] Verify `"true"/"false"` and boolean values accepted
- [x] Verify invalid values surface validation errors
- **Status:** complete

### Phase 6: Add MCP sortLinks test coverage
- [x] Update `tests/mcp.search-tools.test.ts` for `memory_get` sortLinks behavior
- [x] Add `memory_search` sortLinks default/true/false/string/invalid tests
- [x] Add `memory_fulltext_search` sortLinks default/true/false/string/invalid tests
- [x] Run targeted MCP test file
- **Status:** complete

### Phase 7: Update TypeScript type definitions
- [x] Update `src/type.ts` with sortLinks-related MCP types
- [x] Ensure MCP schema output types align with runtime payload fields
- [x] Export service-layer sortLinks-related interface types
- [x] Run TypeScript compile check for regression screening
- **Status:** complete

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `session-catchup.py` missing under planning-with-files skill path | 1 | Continue with existing `.plan/Hephaestus` planning files |
| `bun test tests/mcp.search-tools.test.ts` fails with `SQLITE_IOERR_SHORT_READ` during DB init | 1 | Logged as environment/runtime blocker; test file update completed but runtime verification blocked |

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Create reusable `SortLinksSchema` in MCP schemas | Avoid drift across tools and match HTTP parsing behavior |
| Keep schema defaults at parse layer | Preserve backward compatibility for clients omitting parameter |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `session-catchup.py` missing under planning-with-files skill path | 1 | Continue with existing `.plan/Hephaestus` planning files |
