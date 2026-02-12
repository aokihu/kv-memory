# mcp-integration Specification

## Purpose
TBD - created by archiving change remove-memory-domain-type-fields.

## Requirements

### Requirement: MCP tools without domain and type
MCP tools for memory operations SHALL NOT include domain and type parameters. MCP tools SHALL include search tools for memory search functionality.

#### Scenario: MemoryAdd MCP tool
- **WHEN** client uses MemoryAdd tool
- **THEN** the tool parameters do not include domain or type
- **AND** successful response does not contain domain or type fields

#### Scenario: MemoryUpdate MCP tool
- **WHEN** client uses MemoryUpdate tool
- **THEN** the tool parameters do not include domain or type
- **AND** partial updates do not allow setting domain or type

#### Scenario: MemoryGet MCP tool
- **WHEN** client uses MemoryGet tool
- **THEN** the response does not contain domain or type fields

#### Scenario: MemorySearch MCP tool availability
- **WHEN** MCP server is running with search feature enabled
- **THEN** memory_search tool is available to clients
- **AND** tool supports query, limit, and offset parameters

#### Scenario: MemoryFulltextSearch MCP tool availability
- **WHEN** MCP server is running with search feature enabled
- **THEN** memory_fulltext_search tool is available to clients
- **AND** tool supports keywords, operator, limit, and offset parameters

### Requirement: MCP prompt updates
MCP prompts for memory capture SHALL be updated to reflect removed fields. MCP prompts MAY be updated to mention search capabilities.

#### Scenario: CaptureMemory prompt
- **WHEN** client uses CaptureMemory prompt
- **THEN** the prompt description does not mention domain or type fields
- **AND** examples do not include domain or type values

#### Scenario: Search-related prompts
- **WHEN** search feature is enabled
- **THEN** MCP MAY provide prompts for memory search operations
- **AND** prompts guide users on effective search techniques

### Requirement: MCP schema validation
MCP schemas for memory operations SHALL validate against new structure. MCP schemas for search tools SHALL be properly defined.

#### Scenario: MemoryValueSchema validation
- **WHEN** MCP validates memory data
- **THEN** schema rejects objects containing domain or type fields
- **AND** provides clear error messages

#### Scenario: MemoryNoMetaSchema validation
- **WHEN** MCP validates memory input without meta
- **THEN** schema does not require domain or type fields
- **AND** accepts valid memory data without these fields

#### Scenario: Search tool schema validation
- **WHEN** MCP validates search tool parameters
- **THEN** schema validates query/keywords parameters as required strings
- **AND** schema validates limit/offset parameters as optional integers
- **AND** schema validates operator parameter as optional enum (AND/OR)

### Requirement: Backward compatibility warnings
MCP tools SHALL provide warnings when old clients attempt to use removed fields. New search tools SHALL not break existing functionality.

#### Scenario: Client sends deprecated parameters
- **WHEN** client includes domain or type in MCP tool call
- **THEN** MCP returns validation error
- **AND** error message guides client to update their implementation

#### Scenario: Search tool compatibility
- **WHEN** client uses search tools
- **THEN** existing memory operations continue to work unchanged
- **AND** search tools integrate seamlessly with existing MCP toolset
