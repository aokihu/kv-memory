# Keyv to SQLite Migration Guide

## Overview

This guide describes how to migrate legacy Keyv SQLite data (`keyv` table) into the new relational schema:

- `memories`
- `memory_links`

The migration tool is implemented in `src/libs/db/migrate.ts` and is safe to run multiple times.

## Safety Guarantees

- A backup of the source database is always created before migration starts.
- The source database is opened read-only by the migration script.
- The target writes are transactional.
- The migration is idempotent (`UPSERT` + link table resync), so repeated runs keep consistent results.

## Command Line Usage

```bash
bun run src/libs/db/migrate.ts --source <source-db-path> [--target <target-db-path>] [--backup-dir <dir>] [--dry-run]
```

### Required

- `--source`: path to legacy Keyv SQLite database file.

### Optional

- `--target`: path to target SQLite database file. Defaults to source path.
- `--backup-dir`: backup output directory. Defaults to `./backups`.
- `--dry-run`: parse and validate source rows without writing target data.

## Typical Migration Steps

1. Stop services writing to the legacy database.
2. Run migration in dry-run mode:

   ```bash
   bun run src/libs/db/migrate.ts --source ./kv.db --dry-run
   ```

3. Inspect dry-run report (`migratedRecords`, `skippedRows`, warnings).
4. Run actual migration:

   ```bash
   bun run src/libs/db/migrate.ts --source ./kv.db --target ./kv-migrated.db
   ```

5. Inspect output report and ensure `validation.mismatches` is empty.

## Output Report Fields

- `sourceRows`: number of rows read from legacy `keyv` table.
- `migratedRecords`: rows successfully converted to `MemorySchema`.
- `skippedRows`: rows skipped due to parse/schema mismatch.
- `warnings`: skipped-row details.
- `insertedLinkRows`: number of link rows inserted this run.
- `validation`: post-migration consistency check summary.
- `backup.backupPath`: backup file path for recovery.

## Recovery Guide

If migration fails or validation reports mismatches:

1. Stop the migration process.
2. Keep the generated report for diagnostics.
3. Restore from `backup.backupPath` (and sidecars if present).
4. Re-run with `--dry-run` to inspect parse issues.
