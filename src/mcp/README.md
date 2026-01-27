# MCP Refactor Prep

## Goals
- Separate schemas, tools, prompts, and transport bootstrap so each concern has its own module
- Make it easier to extend MCP capabilities without editing a single 300+ line file
- Keep FastMCP setup backwards-compatible while code migrates into `src/mcp`

## Proposed Layout
- `src/mcp/index.ts` – entry that composes and exports the configured server plus `startMcpServer`
- `src/mcp/server.ts` – initializes `FastMCP` instance with metadata and shared helpers (session resolution, store access)
- `src/mcp/schemas/` – Zod schemas for tool parameters and shared payloads (`memory.ts`, `session.ts`)
- `src/mcp/tools/` – individual tool modules (`memoryAdd.ts`, `memoryGet.ts`, etc.) exporting metadata + handler wired by `registerTools`
- `src/mcp/prompts/` – prompt definitions grouped per use case (e.g., `captureMemory.ts`)
- `src/mcp/resources/` – resource templates such as the `memory://` loader

## Next Steps
1. Move shared helpers (session store resolution, schema definitions) from `src/mcp.ts` into the new directories.
2. Create `registerTools.ts` to attach all exported tool definitions onto the shared server instance.
3. Update existing imports (`SessionService`, `KVMemoryService`, schemas) to use the new module boundaries.
4. Replace `src/mcp.ts` with a thin façade that re-exports from `src/mcp/index.ts` during migration.
5. Add targeted tests for the refactored modules once they are in place.

This gives us a clear scaffolding so the actual refactor can proceed incrementally without breaking consumers.
