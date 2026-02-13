# Purpose

Standalone MCP tool for bulk memory reading operations with depth-first traversal and weight-based sorting.

# Requirements

## Requirement: Standalone bulk read memory tool
The system SHALL provide a standalone MCP tool named `bulk_read_memory` (snake_case) for bulk memory reading operations, separate from the existing `memory_get` tool.

### Scenario: Tool availability
- **WHEN** user queries available MCP tools
- **THEN** `bulk_read_memory` tool is listed as an available tool

### Scenario: Tool naming convention
- **WHEN** user examines tool names
- **THEN** the tool name is exactly `bulk_read_memory` (snake_case, not `memory_bulk_read` or `bulk-memory-read`)

## Requirement: Bulk read parameters
The `bulk_read_memory` tool SHALL support configurable parameters for controlling the bulk read operation.

### Scenario: Basic bulk read with defaults
- **WHEN** user calls `bulk_read_memory` tool with only required parameters
- **THEN** system performs bulk read with default limits: depth=3, breadth=5, total=20

### Scenario: Custom bulk read parameters
- **WHEN** user calls `bulk_read_memory` tool with custom parameters: depth=4, breadth=10, total=30
- **THEN** system performs bulk read with specified limits

### Scenario: Parameter validation
- **WHEN** user calls `bulk_read_memory` tool with invalid parameters: depth=10, breadth=30, total=100
- **THEN** system rejects the request with appropriate error message
- **AND** enforces maximum limits: depth≤6, breadth≤20, total≤50

## Requirement: Depth-first traversal algorithm
The `bulk_read_memory` tool SHALL implement depth-first traversal of associated memories.

### Scenario: Depth-first traversal order
- **WHEN** memory A links to B and C, B links to D
- **AND** user requests bulk read of memory A with depth=3
- **THEN** bulk read retrieves memories in order: A, B, D, C (depth-first)

## Requirement: Weight-based sorting
The `bulk_read_memory` tool SHALL sort associated memories by `link_weight × memory_score` in descending order when selecting which memories to include in bulk reads.

### Scenario: Weight-based selection
- **WHEN** memory A links to B (weight=0.8, score=0.9) and C (weight=0.9, score=0.7)
- **AND** user requests bulk read with breadth=1
- **THEN** system selects memory B first (0.8×0.9=0.72 > 0.9×0.7=0.63)

## Requirement: Deduplication
The `bulk_read_memory` tool SHALL ensure each memory is retrieved only once during a bulk read operation, even if reachable through multiple paths.

### Scenario: Deduplication in complex graph
- **WHEN** memory A links to B and C, B links to C, C links to D
- **AND** user requests bulk read of memory A
- **THEN** memory C is retrieved only once despite being reachable from both A and B

## Requirement: Immediate limit enforcement
The `bulk_read_memory` tool SHALL stop immediately when any limit (depth, breadth, or total) is reached during traversal.

### Scenario: Depth limit enforcement
- **WHEN** memory chain A→B→C→D→E (depth 4)
- **AND** user requests bulk read with depth=2
- **THEN** system retrieves only A, B, C (depth 0,1,2) and stops

### Scenario: Breadth limit enforcement
- **WHEN** memory A links to 10 memories (B1..B10)
- **AND** user requests bulk read with breadth=5
- **THEN** system retrieves only the top 5 memories by weight×score and stops

### Scenario: Total limit enforcement
- **WHEN** bulk read would retrieve 30 memories
- **AND** user requests bulk read with total=20
- **THEN** system retrieves only 20 memories and stops

## Requirement: Response format
The `bulk_read_memory` tool SHALL return results in a structured format compatible with MCP protocol.

### Scenario: Response structure
- **WHEN** bulk read completes successfully
- **THEN** response includes: `targetMemory`, `associatedMemories` array, `metadata` with traversal stats

### Scenario: Output format options
- **WHEN** user calls `bulk_read_memory` tool with `output_format` parameter
- **THEN** system returns results in specified format (toon or json)

## Requirement: Backward compatibility
The `bulk_read_memory` tool SHALL maintain compatibility with existing bulk read functionality.

### Scenario: Same algorithm as existing implementation
- **WHEN** user performs bulk read with same parameters via `bulk_read_memory` tool
- **THEN** results are identical to previous implementation via `memory_get` with bulkRead parameter

### Scenario: HTTP API unchanged
- **WHEN** client calls existing HTTP endpoint `GET /api/memories/{key}/bulk`
- **THEN** endpoint continues to work with same behavior and response format
