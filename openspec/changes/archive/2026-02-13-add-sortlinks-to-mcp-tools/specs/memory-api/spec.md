# memory-api Specification

## Purpose
TBD - created by archiving change remove-memory-domain-type-fields.

## MODIFIED Requirements

### Requirement: Memory API without domain and type
The Memory API SHALL NOT accept or return domain and type fields. The Memory API SHALL support consistent link sorting behavior across all endpoints.

#### Scenario: Create memory API
- **WHEN** client calls memory creation API
- **THEN** the request body must not contain domain or type fields
- **AND** successful response does not contain domain or type fields

#### Scenario: Get memory API
- **WHEN** client calls memory retrieval API
- **THEN** the response does not contain domain or type fields
- **AND** all other fields are present
- **AND** response supports optional `sortLinks` query parameter for controlling link sorting

#### Scenario: Update memory API
- **WHEN** client calls memory update API
- **THEN** the request body must not contain domain or type fields
- **AND** successful response does not contain domain or type fields

#### Scenario: Search memory API
- **WHEN** client calls memory search API
- **THEN** response includes search results with memory data
- **AND** response supports optional `sortLinks` query parameter for controlling link sorting in results

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
The API SHALL provide clear versioning information for breaking changes. The API SHALL ensure consistent behavior between HTTP API and MCP tools for link sorting.

#### Scenario: API version header
- **WHEN** client makes API request
- **THEN** response includes X-API-Version header
- **AND** version indicates removal of domain and type fields

#### Scenario: Migration documentation
- **WHEN** client receives error about removed fields
- **THEN** error response includes link to migration guide
- **AND** migration guide explains how to update client code

#### Scenario: Consistent link sorting behavior
- **WHEN** client uses HTTP API with `sortLinks: true`
- **AND** client uses MCP tools with `sortLinks: true`
- **THEN** both return links arrays sorted identically
- **AND** sorting algorithm is consistent across both interfaces

#### Scenario: Default sorting behavior consistency
- **WHEN** client uses HTTP API without specifying `sortLinks` parameter
- **AND** client uses MCP tools without specifying `sortLinks` parameter
- **THEN** both default to `sortLinks: true`
- **AND** both return links arrays sorted identically

#### Scenario: Parameter validation consistency
- **WHEN** client specifies invalid `sortLinks` value in HTTP API
- **AND** client specifies invalid `sortLinks` value in MCP tools
- **THEN** both return appropriate validation errors
- **AND** error messages are consistent in format and content