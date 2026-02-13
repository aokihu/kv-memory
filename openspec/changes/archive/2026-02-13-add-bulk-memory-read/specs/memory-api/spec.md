## MODIFIED Requirements

### Requirement: Memory retrieval API
The system SHALL provide API endpoints for memory operations including single and bulk retrieval.

#### Scenario: Single memory retrieval
- **WHEN** client requests a single memory by key
- **THEN** system returns the memory data with its metadata and links

#### Scenario: Bulk memory retrieval with depth traversal
- **WHEN** client requests bulk read of a memory
- **THEN** system retrieves the target memory and associated memories using depth-first traversal
- **AND** applies configurable depth, breadth, and total limits
- **AND** sorts associated memories by `link_weight × memory_score` descending
- **AND** prevents duplicate memory retrieval

### Requirement: API parameter validation
The system SHALL validate all API parameters against configured limits.

#### Scenario: Parameter validation for bulk reads
- **WHEN** client provides depth parameter greater than 6
- **THEN** system returns validation error
- **AND** does not process the request

#### Scenario: Parameter validation for breadth limits
- **WHEN** client provides breadth parameter greater than 20
- **THEN** system returns validation error
- **AND** does not process the request

#### Scenario: Parameter validation for total limits
- **WHEN** client provides total parameter greater than 50
- **THEN** system returns validation error
- **AND** does not process the request

### Requirement: API response format for bulk reads
The system SHALL return bulk read results in a structured format including traversal metadata.

#### Scenario: Bulk read response structure
- **WHEN** bulk read completes successfully
- **THEN** response includes:
  - `targetMemory`: The originally requested memory
  - `associatedMemories`: Array of retrieved associated memories
  - `metadata`: Object containing `depthReached`, `totalRetrieved`, `duplicatesSkipped`

## ADDED Requirements

### Requirement: New bulk read endpoint
The system SHALL provide a new HTTP endpoint for bulk memory reads.

#### Scenario: Bulk read endpoint access
- **WHEN** client sends GET request to `/api/memories/{key}/bulk`
- **THEN** system processes bulk read with default or provided parameters
- **AND** returns structured response with memories and metadata

#### Scenario: Bulk read with query parameters
- **WHEN** client includes query parameters `?depth=4&breadth=8&total=30`
- **THEN** system uses provided parameters for traversal
- **AND** validates parameters against maximum limits

### Requirement: Backward compatibility
The system SHALL maintain backward compatibility with existing single memory read endpoints.

#### Scenario: Existing single read endpoint
- **WHEN** client uses existing `/api/memories/{key}` endpoint
- **THEN** system continues to return single memory as before
- **AND** no bulk traversal is performed