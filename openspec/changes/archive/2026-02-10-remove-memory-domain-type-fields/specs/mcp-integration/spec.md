## ADDED Requirements

### Requirement: MCP tools without domain and type
MCP tools for memory operations SHALL NOT include domain and type parameters.

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

### Requirement: MCP prompt updates
MCP prompts for memory capture SHALL be updated to reflect removed fields.

#### Scenario: CaptureMemory prompt
- **WHEN** client uses CaptureMemory prompt
- **THEN** the prompt description does not mention domain or type fields
- **AND** examples do not include domain or type values

### Requirement: MCP schema validation
MCP schemas for memory operations SHALL validate against new structure.

#### Scenario: MemoryValueSchema validation
- **WHEN** MCP validates memory data
- **THEN** schema rejects objects containing domain or type fields
- **AND** provides clear error messages

#### Scenario: MemoryNoMetaSchema validation
- **WHEN** MCP validates memory input without meta
- **THEN** schema does not require domain or type fields
- **AND** accepts valid memory data without these fields

### Requirement: Backward compatibility warnings
MCP tools SHALL provide warnings when old clients attempt to use removed fields.

#### Scenario: Client sends deprecated parameters
- **WHEN** client includes domain or type in MCP tool call
- **THEN** MCP returns validation error
- **AND** error message guides client to update their implementation