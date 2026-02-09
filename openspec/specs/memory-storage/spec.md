# memory-storage Specification

## Purpose
TBD - created by archiving change kv-to-sqlite. Update Purpose after archive.
## Requirements
### Requirement: SQLite-based memory storage
The system SHALL use native SQLite with `bun:sqlite` instead of Keyv for memory persistence. The storage implementation SHALL support field-level storage of memory components in separate columns for efficient querying and incremental updates.

#### Scenario: Memory data stored in separate columns
- **WHEN** a memory is saved to the database
- **THEN** the meta, summary, and text fields are stored in separate columns in the memories table

#### Scenario: Links stored in separate table
- **WHEN** memory links are created or updated
- **THEN** the link relationships are stored in a separate memory_links table for efficient querying

#### Scenario: Backward compatibility
- **WHEN** existing code calls the KVMemory or KVMemoryService APIs
- **THEN** the system behaves identically to the previous Keyv-based implementation

### Requirement: Database schema design
The system SHALL implement a database schema with the following tables and columns:

#### Scenario: Memories table structure
- **WHEN** the database is initialized
- **THEN** a `memories` table exists with columns: key (TEXT PRIMARY KEY), namespace (TEXT), domain (TEXT), summary (TEXT), text (TEXT), type (TEXT), keywords (TEXT), meta (TEXT), links (TEXT)

#### Scenario: Memory links table structure
- **WHEN** the database is initialized
- **THEN** a `memory_links` table exists with columns: id (INTEGER PRIMARY KEY AUTOINCREMENT), from_key (TEXT), to_key (TEXT), link_type (TEXT), weight (REAL)

### Requirement: Data migration
The system SHALL provide a migration script to convert existing Keyv SQLite data to the new schema.

#### Scenario: Migration script execution
- **WHEN** the migration script is run against an existing Keyv database
- **THEN** all data is successfully migrated to the new schema without data loss

#### Scenario: Migration idempotency
- **WHEN** the migration script is run multiple times
- **THEN** subsequent runs have no effect and do not corrupt data

### Requirement: Performance improvements
The system SHALL provide performance improvements over the previous Keyv implementation.

#### Scenario: Field-level query performance
- **WHEN** querying for memories by summary or domain
- **THEN** the query uses SQLite indexes and is faster than full JSON parsing

#### Scenario: Link query performance
- **WHEN** traversing memory links
- **THEN** the query uses the memory_links table and is faster than parsing JSON arrays

