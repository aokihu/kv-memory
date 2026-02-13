# Purpose

MCP (Model Context Protocol) tool interface for memory operations, providing standardized memory retrieval capabilities for AI agents.

# Requirements

## Requirement: Memory MCP tool functionality
The Memory MCP tool SHALL provide memory operations including retrieval with configurable parameters.

### Scenario: Single memory retrieval via MCP
- **WHEN** user requests a single memory by key using MCP tool
- **THEN** tool returns the memory data with its metadata and links

### Scenario: Memory tool without bulk read
- **WHEN** user calls `memory_get` tool
- **THEN** tool only retrieves the single target memory
- **AND** does not perform bulk read operations
- **AND** does not accept bulk read parameters (depth, breadth, total, bulkRead)

## Requirement: MCP tool parameter support
The MCP tool SHALL support configuration parameters for memory operations.

### Scenario: MCP tool parameters for single memory
- **WHEN** user calls `memory_get` tool with parameters
- **THEN** tool accepts only single-memory parameters: key, session, sortLinks, output_format
- **AND** rejects bulk read parameters with appropriate error message

# Deprecation Notes

- **Removed**: Extended MCP tool interface for bulk reads - functionality moved to standalone `bulk_read_memory` tool
- **Removed**: MCP tool bulk read response format - now handled by `bulk_read_memory` tool
