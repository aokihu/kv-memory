# Task Plan: Fix full test suite to green

## New Task: Update BULK_READ_GUIDE tool naming

### Goal
Update `docs/BULK_READ_GUIDE.md` to reflect renamed bulk read tool and parameter schema.

### Current Phase
Phase 3

### Execution Steps
#### Phase 1: Inspect document references
- [x] Locate all `memory_bulk_read` and `totalLimit` references
- [x] Identify all tool call examples needing updates
- **Status:** complete

#### Phase 2: Apply scoped documentation edits
- [x] Rename tool `memory_bulk_read` -> `bulk_read_memory`
- [x] Rename parameter `totalLimit` -> `total`
- [x] Update architecture wording to independent bulk-read tool
- **Status:** complete

#### Phase 3: Verify replacements
- [x] Re-read edited file and confirm no stale references remain
- [x] Confirm examples and narrative are internally consistent
- **Status:** complete

## Goal
Run `bun test`, identify failing tests, implement minimal fixes, and verify all tests pass.

## Current Phase
Phase 5

## Phases
### Phase 1: Failure analysis and grouping
- [x] Review full test output and cluster failures by root cause
- [x] Locate impacted source and test files
- **Status:** complete

### Phase 2: Implement root-cause fixes
- [x] Fix database API compatibility causing `.run` missing failures
- [x] Fix search service compatibility around optional `kv.getLinks`
- [x] Fix service method compatibility for namespace and non-namespace call styles
- **Status:** complete

### Phase 3: Targeted verification
- [x] Run focused test files for each fixed failure group
- [x] Confirm no regressions in touched areas
- **Status:** complete

### Phase 4: Full verification
- [x] Re-run `bun test`
- [x] Confirm all tests pass
- **Status:** complete

### Phase 5: Delivery
- [x] Provide detailed test result report and fix summary
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Start with largest shared stack traces first | Maximize fix impact with minimal edits |
| Use minimal compatible changes | Respect existing behavior and reduce regression risk |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `session-catchup.py` helper script path missing | 1 | Continue with local planning artifacts and proceed |
