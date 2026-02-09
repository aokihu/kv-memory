# Monitoring and Logging

## Objective

Define minimum observability requirements for production migration and post-migration runtime.

## Core Metrics

### Migration Metrics

- `migration_source_rows`
- `migration_migrated_records`
- `migration_skipped_rows`
- `migration_inserted_link_rows`
- `migration_validation_mismatches`
- `migration_duration_ms`

### Runtime Health Metrics

- API success rate for:
  - `/login`
  - `/add_memory`
  - `/get_memory`
  - `/update_memory`
  - `/update_memory_key`
- p95 latency for read and write operations
- SQLite lock wait events / timeout events
- Error count grouped by message prefix (`KVMemory:*`, migration failures)

### Data Integrity Metrics

- `memories` row count by namespace
- `memory_links` row count by namespace
- ratio: `memory_links / memories`
- periodic validation mismatch count in replay/recheck jobs

## Logging Requirements

## Migration Logs

Log at minimum:

- source path / target path
- backup path
- migration report summary fields
- validation mismatch details (if any)

## Runtime Logs

Log error-level entries for:

- key not found update failures
- transaction rollback errors
- sqlite lock/timeout failures

Log warning-level entries for:

- skipped migration rows
- dangling links skipped during relation synchronization

## Suggested Alert Rules

- Alert if `migration_validation_mismatches > 0`
- Alert if API success rate < 99% for 5 minutes
- Alert if p95 latency doubles baseline for 10 minutes
- Alert if sqlite timeout errors exceed threshold (e.g. 20/min)

## Operational Checklist

1. Capture migration report and archive with release version.
2. Monitor first 30 minutes after cutover with high frequency checks.
3. Compare key counts against pre-deployment baseline.
4. Keep rollback path ready until metrics stabilize.
