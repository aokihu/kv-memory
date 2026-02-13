# mcp-search-tools Specification

## Purpose
TBD - created by syncing change add-memory-search-with-mcp-tools. Update Purpose after archive.

## MODIFIED Requirements

### Requirement: MCP search tools
The system SHALL provide MCP tools for memory search functionality, enabling Agents to search memories through the MCP protocol. The search tools SHALL support optional `sortLinks` parameter for controlling link array sorting in search results.

#### Scenario: memory_search MCP tool
- **WHEN** Agent uses memory_search tool with query parameter
- **THEN** tool returns search results matching the query
- **AND** results include memory key, summary, and relevance score
- **AND** tool supports optional limit and offset parameters for pagination
- **AND** tool supports optional `sortLinks` parameter for controlling link sorting

#### Scenario: memory_fulltext_search MCP tool
- **WHEN** Agent uses memory_fulltext_search tool with keywords parameter
- **THEN** tool returns full-text search results
- **AND** tool supports operator parameter (AND/OR) for keyword combination
- **AND** results include keyword highlighting in text excerpts
- **AND** tool supports optional `sortLinks` parameter for controlling link sorting

#### Scenario: MCP tool parameter validation
- **WHEN** Agent uses search tools with invalid parameters
- **THEN** tool returns descriptive error message
- **AND** error message follows MCP error format standards
- **AND** validation includes `sortLinks` parameter type checking

#### Scenario: MCP tool output format
- **WHEN** search tools return results
- **THEN** output format is consistent with existing MCP memory tools
- **AND** results are structured for easy parsing by Agents
- **AND** links arrays in results are sorted according to `sortLinks` parameter

#### Scenario: Search results with sorted links
- **WHEN** Agent uses search tools with `sortLinks: true`
- **THEN** each memory in search results has its links array sorted by combined score
- **AND** sorting uses `link weight × memory score` algorithm
- **AND** sorting is applied consistently across all search results

#### Scenario: Search results with unsorted links
- **WHEN** Agent uses search tools with `sortLinks: false`
- **THEN** each memory in search results has its links array in original order
- **AND** no sorting algorithm is applied to links

### Requirement: MCP tool integration
The MCP search tools SHALL be properly integrated into the existing MCP server and tool registry. The integration SHALL include support for `sortLinks` parameter across all search tools.

#### Scenario: Tool registration
- **WHEN** MCP server starts with search feature enabled
- **THEN** memory_search and memory_fulltext_search tools are registered
- **AND** tools are available to connected clients
- **AND** registered tools include `sortLinks` parameter in their schema definitions

#### Scenario: Tool schema definition
- **WHEN** MCP tools are registered
- **THEN** each tool has proper JSON schema definition for parameters
- **AND** schema includes descriptions and examples for all parameters
- **AND** schema includes `sortLinks` parameter definition with default value `true`

#### Scenario: Tool compatibility
- **WHEN** Agent uses search tools
- **THEN** tool behavior is consistent with REST API search endpoints
- **AND** results are equivalent to corresponding API calls
- **AND** `sortLinks` parameter behavior matches HTTP API behavior

#### Scenario: Default sorting behavior
- **WHEN** Agent uses search tools without specifying `sortLinks` parameter
- **THEN** default value `true` is used
- **AND** links arrays in search results are sorted by combined score
- **AND** behavior is consistent with HTTP API default behavior