# mcp-search-tools Specification

## Purpose
TBD - created by syncing change add-memory-search-with-mcp-tools. Update Purpose after archive.

## Requirements

### Requirement: MCP search tools
The system SHALL provide MCP tools for memory search functionality, enabling Agents to search memories through the MCP protocol.

#### Scenario: memory_search MCP tool
- **WHEN** Agent uses memory_search tool with query parameter
- **THEN** tool returns search results matching the query
- **AND** results include memory key, summary, and relevance score
- **AND** tool supports optional limit and offset parameters for pagination

#### Scenario: memory_fulltext_search MCP tool
- **WHEN** Agent uses memory_fulltext_search tool with keywords parameter
- **THEN** tool returns full-text search results
- **AND** tool supports operator parameter (AND/OR) for keyword combination
- **AND** results include keyword highlighting in text excerpts

#### Scenario: MCP tool parameter validation
- **WHEN** Agent uses search tools with invalid parameters
- **THEN** tool returns descriptive error message
- **AND** error message follows MCP error format standards

#### Scenario: MCP tool output format
- **WHEN** search tools return results
- **THEN** output format is consistent with existing MCP memory tools
- **AND** results are structured for easy parsing by Agents

### Requirement: MCP tool integration
The MCP search tools SHALL be properly integrated into the existing MCP server and tool registry.

#### Scenario: Tool registration
- **WHEN** MCP server starts with search feature enabled
- **THEN** memory_search and memory_fulltext_search tools are registered
- **AND** tools are available to connected clients

#### Scenario: Tool schema definition
- **WHEN** MCP tools are registered
- **THEN** each tool has proper JSON schema definition for parameters
- **AND** schema includes descriptions and examples for all parameters

#### Scenario: Tool compatibility
- **WHEN** Agent uses search tools
- **THEN** tool behavior is consistent with REST API search endpoints
- **AND** results are equivalent to corresponding API calls