# Task Plan: TASK-004-UPDATE-TESTS

## Goal
Update test suites for service/API/MCP search paths to verify namespace filtering via session and backward-compatible global search behavior.

## Current Phase
Step 5 (complete)

## Steps
1. Inspect target tests and shared test utilities to identify existing fixture/session setup and assertion patterns.
2. Update `tests/search.service.test.ts` to validate namespace-filtered search behavior and no-namespace global compatibility.
3. Update `tests/search.api.integration.test.ts` to validate `session` query behavior for valid session filtering, invalid session error, and no-session fallback.
4. Update `tests/mcp.search-tools.test.ts` to validate `session` tool input behavior for namespace filtering, invalid session error, and no-session fallback.
5. Run relevant test files and record pass/fail results.

## Status
- [complete] Step 1
- [complete] Step 2
- [complete] Step 3
- [complete] Step 4
- [complete] Step 5

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `session-catchup.py` path `${CLAUDE_PLUGIN_ROOT}` missing | 1 | Switched to explicit script path under skill directory |
| `session-catchup.py` file absent in skill directory | 2 | Continued with manual planning files under `.plan/Hephaestus` |
| Combined `bun test` run across mocked + integration suites causes `optimizeFtsIndex` export error | 1 | Verified target suites pass when executed independently; treated as cross-suite module-mock interference |
