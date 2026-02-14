## ADDED Requirements

### Requirement: SQLite durability configuration
The system SHALL configure SQLite for crash safety and data durability to prevent data loss during unexpected server termination.

#### Scenario: WAL mode enabled by default
- **WHEN** the database connection is initialized
- **THEN** the system sets journal_mode to WAL
- **AND** WAL mode remains active for all subsequent operations

#### Scenario: Synchronous mode configuration
- **WHEN** the database connection is initialized
- **THEN** the system sets synchronous to FULL or EXTRA
- **AND** write operations wait for data to reach stable storage before returning

#### Scenario: Connection durability settings
- **WHEN** the database connection is initialized
- **THEN** the following durability settings are applied:
  - busy_timeout = 5000 (5 seconds)
  - cache_size = -64000 (64MB)
  - temp_store = memory

#### Scenario: Safe connection closure
- **WHEN** the database connection needs to be closed
- **THEN** the system first executes PRAGMA wal_checkpoint(TRUNCATE)
- **AND** waits for checkpoint completion before closing the connection

#### Scenario: Startup WAL recovery
- **WHEN** the system starts and detects WAL files exist
- **THEN** it opens the database (SQLite automatically performs recovery)
- **AND** executes an explicit checkpoint to ensure data integrity