<Metadata version="1.0" />
<Project lastUpdateTime="2026/1/26 20:00:00">
    <Dir path="/" desc="Project root with Bun configs, sqlite stores, documents, TypeScript sources, and MCP service components" />
    <File path="/README.md" desc="Project overview, quick start, and process notes" />
    <File path="/AGENTS.md" desc="Agent responsibilities plus rules and runtime expectations" />
    <File path="/CLAUDE.md" desc="Bun-first tooling guidance and API reminders" />
    <File path="/MCP-README.md" desc="MCP service overview, setup, and API expectations" />
    <Dir path="/docs" desc="Supplementary documentation for memory behavior and algorithms" />
    <File path="/docs/MEMORY_ALGORITHM.md" desc="Detailed description of the memory evolution algorithm" />
    <Dir path="/src" desc="TypeScript implementation of the KV memory, session, and MCP services" />
    <Dir path="/src/controller" desc="HTTP controllers for login and memory endpoints" />
    <File path="/src/controller/index.ts" desc="Exports the registered memory controllers" />
    <File path="/src/controller/login.ts" desc="/login handler that issues anonymous Bun sessions" />
    <File path="/src/controller/getMemory.ts" desc="/get_memory POST handler that validates session, updates meta, and returns memory" />
    <File path="/src/controller/addMemory.ts" desc="/add_memory POST handler that validates MemoryNoMeta payloads and persists them" />
    <File path="/src/controller/updateMemory.ts" desc="/update_memory POST handler (currently unused) for partial memory patches" />
    <Dir path="/src/service" desc="Business logic for KV memory and session stores" />
    <File path="/src/service/kvmemory.ts" desc="KVMemoryService that wraps the sqlite-backed KV store and meta updates" />
    <File path="/src/service/session.ts" desc="SessionService that creates/reads Keyv sessions with TTLs" />
    <Dir path="/src/libs" desc="Shared helpers layered beneath the services" />
    <Dir path="/src/libs/kv" desc="Keyv + sqlite wrapper for KV memory persistence" />
    <File path="/src/libs/kv/kv.ts" desc="KVMemory singleton handling add/get/update operations and meta initialization" />
    <File path="/src/index.ts" desc="Bun.serve server wiring, route map, and AppServerContext assembly" />
    <File path="/src/type.ts" desc="Zod schema definitions for Memory, metadata, links, and context payloads" />
    <File path="/src/db.ts" desc="Placeholder for future database wiring (currently empty)" />
    <File path="/src/mcp.ts" desc="MCP server entrypoint that wires the long-running coordination service" />
    <Dir path="/src/session" desc="Session helpers directory (empty for now)" />
    <Dir path="/tests" desc="Bun test suite that hits the memory API flow" />
    <File path="/test-mcp.js" desc="Standalone script for exercising MCP server flows" />
    <File path="/tests/all.test.ts" desc="API flow tests for login, add, and get memory endpoints" />
    <Dir path="/node_modules" desc="Installed Bun dependencies" />
    <Dir path="/scripts" desc="Automation helpers (currently empty)" />
    <File path="/package.json" desc="Bun scripts plus dependency definitions" />
    <File path="/bun.lock" desc="Pinned Bun dependency graph" />
    <File path="/tsconfig.json" desc="TypeScript compiler settings tailored for Bun" />
    <File path="/kv.db" desc="SQLite store that backs the KV memory entries" />
    <File path="/session.db" desc="SQLite store used by SessionService" />
</Prject>
