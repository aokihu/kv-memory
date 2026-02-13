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

#### Scenario: Get memory API
- **WHEN** client calls memory retrieval API
- **THEN** the response does not contain domain or type fields
- **AND** all other fields are present

#### Scenario: Update memory API
- **WHEN** client calls memory update API
- **THEN** the request body must not contain domain or type fields
- **AND** successful response does not contain domain or type fields

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

#### Scenario: Migration documentation
- **WHEN** client receives error about removed fields
- **THEN** error response includes link to migration guide
- **AND** migration guide explains how to update client code

## ADDED Requirements

### Requirement: Memory retrieval with sorted links
When retrieving a memory via API, the system SHALL return the Links array sorted by combined score (`link weight × memory score`) in descending order.

#### Scenario: GET /memory/:key returns sorted links
- **WHEN** client calls GET /memory/:key to retrieve a memory
- **THEN** the Links array in the response is sorted by `link weight × memory score` in descending order
- **AND** links with higher combined scores appear first in the array

#### Scenario: Optional link sorting control
- **WHEN** client calls GET /memory/:key?sortLinks=true
- **THEN** the Links array is sorted by combined score (default behavior)
- **WHEN** client calls GET /memory/:key?sortLinks=false
- **THEN** the Links array is returned in original order or unsorted

#### Scenario: Batch memory retrieval with sorted links
- **WHEN** client retrieves multiple memories in a batch operation
- **THEN** the Links array in each memory is sorted by combined score
- **AND** sorting is applied consistently across all memories in the batch

### Requirement: API response format consistency
The API SHALL maintain consistent response format when links are sorted.

#### Scenario: Response metadata includes sorting info
- **WHEN** links are sorted by combined score
- **THEN** the API response may include metadata indicating the sorting method used
- **AND** the metadata does not break existing client parsing

#### Scenario: Backward compatibility
- **WHEN** an existing client retrieves a memory
- **THEN** the client receives the sorted Links array without any changes to its code
- **AND** the client's functionality is not broken by the new sorting behavior

### Requirement: Error handling for sorting parameters
The API SHALL properly handle invalid or malformed sorting parameters.

#### Scenario: Invalid sortLinks parameter
- **WHEN** client calls API with `sortLinks=invalid`
- **THEN** API returns 400 Bad Request with descriptive error message
- **AND** error message suggests valid values: "true" or "false"

#### Scenario: Missing sortLinks parameter
- **WHEN** client calls API without sortLinks parameter
- **THEN** API uses default value of `true` (sort links by combined score)
- **AND** links are sorted by combined score in descending order