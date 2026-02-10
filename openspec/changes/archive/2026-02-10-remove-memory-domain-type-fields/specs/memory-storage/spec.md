## MODIFIED Requirements

### Requirement: Database schema design
The system SHALL implement a database schema with the following tables and columns:

#### Scenario: Memories table structure
- **WHEN** the database is initialized
- **THEN** a `memories` table exists with columns: key (TEXT PRIMARY KEY), namespace (TEXT), summary (TEXT), text (TEXT), keywords (TEXT), meta (TEXT), links (TEXT), created_at (INTEGER)
- **AND** the table does NOT have domain and type columns

#### Scenario: Memory links table structure
- **WHEN** the database is initialized
- **THEN** a `memory_links` table exists with columns: id (INTEGER PRIMARY KEY AUTOINCREMENT), namespace (TEXT), from_key (TEXT), to_key (TEXT), link_type (TEXT), weight (REAL), created_at (INTEGER)

### Requirement: SQLite-based memory storage
The system SHALL use native SQLite with `bun:sqlite` instead of Keyv for memory persistence. The storage implementation SHALL support field-level storage of memory components in separate columns for efficient querying and incremental updates.

#### Scenario: Memory data stored in separate columns
- **WHEN** a memory is saved to the database
- **THEN** the meta, summary, and text fields are stored in separate columns in the memories table
- **AND** domain and type fields are not stored

#### Scenario: Links stored in separate table
- **WHEN** memory links are created or updated
- **THEN** the link relationships are stored in a separate memory_links table for efficient querying

#### Scenario: Backward compatibility
- **WHEN** existing code calls the KVMemory or KVMemoryService APIs
- **THEN** the system rejects requests containing domain or type fields
- **AND** returns appropriate error messages

## REMOVED Requirements

### Requirement: Domain-based indexing
**Reason**: Domain field has been removed from the Memory data structure
**Migration**: Use keywords or summary fields for categorization instead

### Requirement: Type-based classification
**Reason**: Type field has been removed from the Memory data structure
**Migration**: Use keywords field for type classification if needed