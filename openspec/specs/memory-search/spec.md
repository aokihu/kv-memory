# memory-search Specification

## Purpose
TBD - created by syncing change add-memory-search-with-mcp-tools. Update Purpose after archive.

## Requirements

### Requirement: Full-text search capability
The system SHALL provide full-text search functionality for memory content using SQLite FTS5 extension. The search SHALL support keyword matching, relevance ranking, and pagination.

#### Scenario: Basic keyword search
- **WHEN** user searches for memories containing keyword "quantum"
- **THEN** system returns all memories where summary or text contains "quantum"
- **AND** results are ranked by relevance

#### Scenario: Multi-keyword search with OR operator
- **WHEN** user searches for memories containing keywords "博士" OR "Atom" OR "量子"
- **THEN** system returns memories matching any of the keywords
- **AND** results are ranked by relevance score

#### Scenario: Search with pagination
- **WHEN** user searches with limit=10 and offset=20
- **THEN** system returns at most 10 results starting from the 21st most relevant result
- **AND** response includes total result count for pagination

#### Scenario: Search result formatting
- **WHEN** search returns results
- **THEN** each result includes memory key, summary, text excerpt with keyword highlighting
- **AND** relevance score is included for sorting

### Requirement: Search API endpoints
The system SHALL provide REST API endpoints for memory search functionality.

#### Scenario: GET /search endpoint
- **WHEN** client calls GET /search?q=quantum&limit=10&offset=0
- **THEN** system returns JSON response with search results
- **AND** response includes pagination metadata (total, limit, offset)

#### Scenario: GET /fulltext endpoint
- **WHEN** client calls GET /fulltext?keywords=博士,Atom,量子&operator=OR
- **THEN** system returns JSON response with full-text search results
- **AND** operator parameter controls logical combination of keywords

#### Scenario: Search error handling
- **WHEN** client calls search API with invalid parameters
- **THEN** system returns 400 Bad Request with descriptive error message
- **AND** error message suggests correct parameter format

### Requirement: FTS5 index management
The system SHALL create and maintain SQLite FTS5 virtual tables for efficient full-text search.

#### Scenario: FTS5 table creation
- **WHEN** database is initialized with search feature enabled
- **THEN** system creates FTS5 virtual table for memory content indexing
- **AND** index includes summary and text fields for searching

#### Scenario: Index synchronization
- **WHEN** new memory is added or existing memory is updated
- **THEN** FTS5 index is automatically updated to reflect changes
- **AND** search results immediately reflect updated content

#### Scenario: Index optimization
- **WHEN** system performs maintenance operations
- **THEN** FTS5 index can be optimized for performance
- **AND** optimization does not affect search availability