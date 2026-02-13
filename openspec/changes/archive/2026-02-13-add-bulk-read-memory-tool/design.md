## Context

The bulk memory reading functionality was previously implemented as part of the `add-bulk-memory-read` change, but it was added as an extension to the existing `memory_get` MCP tool through a `bulkRead` parameter. This created architectural inconsistency and naming confusion. Users have specifically requested a standalone `bulk_read_memory` tool with snake_case naming convention, separate from the existing `memory_get` tool.

Current state:
- Bulk read algorithm already exists in `src/service/kvmemory.ts` as `bulkReadMemory` method
- HTTP API endpoint `GET /api/memories/{key}/bulk` is already implemented
- MCP tool `memory_get` currently supports bulk read via `bulkRead` parameter
- Documentation mentions both `memory_get` with bulk read and `memory_bulk_read` as separate tools
- 23 existing tests pass for the current implementation

## Goals / Non-Goals

**Goals:**
1. Create a standalone MCP tool `bulk_read_memory` (snake_case) for bulk memory operations
2. Remove bulk read functionality from `memory_get` tool to maintain single responsibility
3. Maintain backward compatibility with existing HTTP API and core algorithm
4. Update documentation to reflect the new tool architecture
5. Ensure all existing tests continue to pass

**Non-Goals:**
1. Changing the bulk read algorithm or core functionality
2. Modifying the HTTP API endpoint behavior
3. Changing the existing `memory_get` tool interface for single memory operations
4. Introducing new features beyond separating the tools

## Decisions

### Decision 1: Create new standalone tool instead of extending existing tool
**Rationale**: Users explicitly requested a standalone tool with snake_case naming (`bulk_read_memory`). This provides cleaner separation of concerns and follows the principle of single responsibility. The `memory_get` tool should focus on single memory retrieval, while `bulk_read_memory` handles bulk operations.

**Alternatives considered**:
- Keep bulk read as parameter in `memory_get`: Rejected because it violates user's explicit request and creates inconsistent tool architecture
- Rename existing tool: Rejected because it would break backward compatibility for single memory operations

### Decision 2: Reuse existing bulk read algorithm
**Rationale**: The bulk read algorithm in `src/service/kvmemory.ts` is already implemented, tested, and working. We should extract and reuse this functionality rather than reimplementing it.

**Implementation approach**:
- Create new MCP tool file: `src/mcp/tools/bulkReadMemory.ts`
- Import and use existing `bulkReadMemory` service method
- Maintain same parameter interface: `key`, `session`, `depth`, `breadth`, `totalLimit`, `sortLinks`, `output_format`
- Return same response structure: `targetMemory`, `associatedMemories`, `metadata`

### Decision 3: Update MCP server registration
**Rationale**: The new tool needs to be registered in the MCP server to be available to clients.

**Implementation approach**:
- Add new tool registration in `src/mcp/server.ts`
- Import the new tool handler
- Register with name `bulk_read_memory` (snake_case)

### Decision 4: Remove bulk read from memory_get tool
**Rationale**: To maintain clean separation and avoid confusion, bulk read parameters should be removed from `memory_get`.

**Implementation approach**:
- Remove `bulkRead`, `depth`, `breadth`, `total` parameters from `memory_get` schema
- Update `memory_get` handler to reject bulk read parameters
- Update tests to reflect the change

### Decision 5: Update documentation
**Rationale**: Documentation currently mentions both approaches inconsistently.

**Implementation approach**:
- Update `MCP-README.md`: Remove bulk read from `memory_get` section, add `bulk_read_memory` section
- Update `docs/BULK_READ_GUIDE.md`: Update examples to use new tool
- Update `API.md`: Clarify that HTTP API remains unchanged

## Risks / Trade-offs

**Risk 1**: Breaking existing clients using `memory_get` with bulk read parameters
- **Mitigation**: This is an intentional breaking change. Clients should migrate to use the new `bulk_read_memory` tool. The HTTP API remains unchanged for HTTP clients.

**Risk 2**: Inconsistent documentation during transition
- **Mitigation**: Update all documentation in a single change to ensure consistency.

**Risk 3**: Test failures due to tool separation
- **Mitigation**: Update test files to use the new tool for bulk read tests, and ensure `memory_get` tests only cover single memory operations.

**Risk 4**: Duplicate code between tools
- **Mitigation**: Both tools will use the same underlying service method (`bulkReadMemory` for bulk, `getMemory` for single), minimizing code duplication.

**Trade-off**: Tool proliferation vs. separation of concerns
- **Decision**: Accept having more specialized tools for better clarity and adherence to single responsibility principle.

## Migration Plan

1. **Implementation phase**:
   - Create new `bulk_read_memory` tool
   - Remove bulk read from `memory_get` tool
   - Update MCP server registration
   - Update tests

2. **Documentation phase**:
   - Update all documentation files
   - Verify consistency across all docs

3. **Testing phase**:
   - Run all existing tests (23 tests)
   - Add new tests for `bulk_read_memory` tool
   - Ensure no regression

4. **Deployment**:
   - This is a code change only, no database migration needed
   - Can be deployed with normal release process

## Open Questions

1. Should we deprecate the bulk read parameters in `memory_get` with a warning before removing them?
   - **Decision**: No, since this is addressing an inconsistency, we should make the clean break.

2. How to handle the `memory_bulk_read` documentation that already exists?
   - **Decision**: Update it to `bulk_read_memory` (snake_case) to match the actual implementation.