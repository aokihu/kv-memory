# Rollback Plan

## Goal

Provide an executable rollback process if migration or post-cutover validation fails.

## Rollback Triggers

Start rollback when one or more conditions are true:

- Migration command fails.
- Migration validation mismatch is non-empty.
- Critical API routes cannot recover within agreed error budget.
- Data integrity checks fail after cutover.

## Required Inputs

- Backup file path from migration report (`backup.backupPath`)
- Deployment version identifier
- Current production DB file path

## Rollback Procedure

### 1) Freeze Writes

- Stop application process or block write endpoints.

### 2) Preserve Failed State (Forensics)

```bash
cp ./kv.db ./kv.db.failed.$(date +%s)
```

### 3) Restore Backup

```bash
cp <backup-path> ./kv.db
```

If sidecars exist in backup output, restore them as well:

```bash
cp <backup-path>-wal ./kv.db-wal || true
cp <backup-path>-shm ./kv.db-shm || true
```

### 4) Restart Service

```bash
bun run dev
```

### 5) Validate Recovery

- Execute smoke API checks.
- Verify key memory retrieval succeeds.
- Verify error rate returns to baseline.

## Post-Rollback Actions

- Record incident timeline.
- Attach migration report and failed DB snapshot.
- Identify root cause before next migration attempt.
- Re-run `scripts/migration-dry-run.sh` in staging with same dataset characteristics.
