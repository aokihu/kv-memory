## MODIFIED Requirements

### Requirement: SQLite-based memory storage
The system SHALL use native SQLite with `bun:sqlite` instead of Keyv for memory persistence. The storage implementation SHALL support field-level storage of memory components in separate columns for efficient querying and incremental updates. The storage SHALL also support FTS5 full-text search indexing.

#### Scenario: Memory data stored in separate columns
- **WHEN** a memory is saved to the database
- **THEN** the meta, summary, and text fields are stored in separate columns in the memories table
- **AND** domain and type fields are not stored
- **AND** content is indexed in FTS5 virtual table if search feature is enabled

#### Scenario: Links stored in separate table
- **WHEN** memory links are created or updated
- **THEN** the link relationships are stored in a separate memory_links table for efficient querying

#### Scenario: Backward compatibility
- **WHEN** existing code calls the KVMemory or KVMemoryService APIs
- **THEN** the system rejects requests containing domain or type fields
- **AND** returns appropriate error messages

#### Scenario: FTS5 index maintenance
- **WHEN** memory is added, updated, or deleted
- **THEN** corresponding FTS5 index entry is automatically updated
- **AND** search results reflect the change immediately

### Requirement: Database schema design
The system SHALL implement a database schema with the following tables and columns, including FTS5 virtual tables for search functionality.

#### Scenario: Memories table structure
- **WHEN** the database is initialized
- **THEN** a `memories` table exists with columns: key (TEXT PRIMARY KEY), summary (TEXT), text (TEXT), meta (TEXT), links (TEXT), created_at (INTEGER)
- **AND** the table does NOT have legacy classification columns (domain/type/tag)

#### Scenario: Memory links table structure
- **WHEN** the database is initialized
- **THEN** a `memory_links` table exists with columns: id (INTEGER PRIMARY KEY AUTOINCREMENT), from_key (TEXT), to_key (TEXT), link_type (TEXT), weight (REAL), created_at (INTEGER)

#### Scenario: FTS5 virtual table structure
- **WHEN** database is initialized with search feature enabled
- **THEN** an FTS5 virtual table `memories_fts` exists with columns: key, summary, text
- **AND** the table is configured for full-text search with appropriate tokenizers

### Requirement: Data migration
The system SHALL provide a migration script to convert existing Keyv SQLite data to the new schema. The system SHALL also provide migration for adding FTS5 indexes to existing databases.

#### Scenario: Migration script execution
- **WHEN** the migration script is run against an existing Keyv database
- **THEN** all data is successfully migrated to the new schema without data loss
- **AND** FTS5 indexes are created if search feature is enabled

#### Scenario: Migration idempotency
- **WHEN** the migration script is run multiple times
- **THEN** subsequent runs have no effect and do not corrupt data
- **AND** FTS5 indexes are only created if they don't exist

### Requirement: Performance improvements
The system SHALL provide performance improvements over the previous Keyv implementation, including efficient full-text search capabilities.

#### Scenario: Field-level query performance
- **WHEN** querying for memories by summary or domain
- **THEN** the query uses SQLite indexes and is faster than full JSON parsing

#### Scenario: Link query performance
- **WHEN** traversing memory links
- **THEN** the query uses the memory_links table and is faster than parsing JSON arrays

#### Scenario: Full-text search performance
- **WHEN** performing full-text search on memory content
- **THEN** the query uses FTS5 virtual table and returns results efficiently
- **AND** relevance ranking is computed by SQLite FTS5 engine