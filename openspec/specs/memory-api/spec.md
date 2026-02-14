# memory-api Specification

## Purpose
TBD - created by archiving change remove-memory-domain-type-fields.
## Requirements
### Requirement: Memory API without domain and type
The Memory API SHALL NOT accept or return domain and type fields.

#### Scenario: Create memory API
- **WHEN** client calls memory creation API
- **THEN** the request body must not contain domain or type fields
- **AND** successful response does not contain domain or type fields
- **AND** the created memory has initial score of 50 in meta field

#### Scenario: Get memory API
- **WHEN** client calls memory retrieval API
- **THEN** the response does not contain domain or type fields
- **AND** all other fields are present
- **AND** includes the memory's score in meta field if available

#### Scenario: Update memory API
- **WHEN** client calls memory update API
- **THEN** the request body must not contain domain or type fields
- **AND** successful response does not contain domain or type fields
- **AND** the memory's score is preserved unless explicitly updated by decay algorithm

### Requirement: API error handling for removed fields
The API SHALL return appropriate error responses when clients attempt to use removed fields.

#### Scenario: Client includes domain in request
- **WHEN** client includes domain field in any API request
- **THEN** API returns 400 Bad Request
- **AND** error message: "domain field has been removed. Please update your client."

#### Scenario: Client includes type in request
- **WHEN** client includes type field in any API request
- **THEN** API returns 400 Bad Request
- **AND** error message: "type field has been removed. Please update your client."

### Requirement: API versioning and compatibility
The API SHALL provide clear versioning information for breaking changes.

#### Scenario: API version header
- **WHEN** client makes API request
- **THEN** response includes X-API-Version header
- **AND** version indicates removal of domain and type fields
- **AND** version indicates addition of score field support

#### Scenario: Migration documentation
- **WHEN** client receives error about removed fields
- **THEN** error response includes link to migration guide
- **AND** migration guide explains how to update client code

### Requirement: Memory state query support
The Memory API SHALL support querying memories by their lifecycle state and score.

#### Scenario: Query with state filter
- **WHEN** client queries memories with "state" parameter (e.g., "state=active")
- **THEN** API returns only memories in the specified state
- **AND** uses score thresholds to determine state (active: 70+, cold: 30-69, deprecated: 0-29)

#### Scenario: Query with score range
- **WHEN** client queries memories with "scoreMin" and "scoreMax" parameters
- **THEN** API returns memories with scores within the specified range
- **AND** validates that range is within 0-100

#### Scenario: Include all states
- **WHEN** client queries memories with "includeAllStates=true" parameter
- **THEN** API returns memories from all states (active, cold, deprecated)
- **AND** response includes each memory's state as a field

#### Scenario: Sort by score
- **WHEN** client queries memories with "sortBy=score" parameter
- **THEN** API returns memories sorted by score (descending by default)
- **AND** supports ascending/descending order specification

### Requirement: Memory statistics API
The API SHALL provide endpoints for retrieving memory statistics including score distribution and state counts.

#### Scenario: Get memory statistics
- **WHEN** client calls memory statistics endpoint
- **THEN** API returns counts of memories in each state
- **AND** includes average score, score distribution histogram
- **AND** includes recent state transition counts

#### Scenario: Get system health
- **WHEN** client calls system health endpoint
- **THEN** API includes memory system health metrics
- **AND** includes last decay calculation timestamp and status
- **AND** includes scheduler status for decay algorithm

