# Deployment Guide

## Purpose

This guide defines the production rollout steps for the Keyv -> native SQLite migration.

## Preconditions

- Code is merged and release artifact is built.
- Database host has enough free disk space for backup + migrated copy.
- Operator has access to run Bun scripts in production environment.
- Maintenance window is scheduled (recommended for migration cutover).

## Safety Checkpoints

1. Confirm source DB file path.
2. Confirm backup directory writable and has free space.
3. Run migration rehearsal first.
4. Verify migration report has `validation.mismatches.length === 0`.
5. Only then execute production migration.

## Step-by-Step Rollout

### 1) Pre-Deployment Validation

```bash
bunx tsc --noEmit
bun test tests/kv.sqlite.test.ts tests/db.schema.test.ts tests/db.migrate.test.ts tests/api-compatibility.test.ts tests/concurrent-access.test.ts tests/final-verification.test.ts
```

### 2) Migration Rehearsal (Required)

```bash
bun run deploy:dry-run -- ./kv.db
```

Expected outcome:

- Rehearsal completes without script failure.
- `dry-run` report generated.
- Simulated migration report contains no mismatches.

### 3) Production Migration

```bash
bun run src/libs/db/migrate.ts --source ./kv.db --target ./kv.db
```

Expected outcome:

- Migration report printed.
- `validation.mismatches` is empty.

### 4) Service Startup

```bash
bun run dev
```

### 5) Post-Deployment Validation

- Execute smoke API checks for login/add/get/update/update_key.
- Verify logs do not contain migration mismatch errors.
- Verify DB table counts are non-zero for expected namespaces.

## Incident Triggers

Initiate rollback immediately if any of the following occurs:

- Migration command exits non-zero.
- Validation mismatch is non-empty.
- Critical API routes fail continuously after deployment.
- Data read/write inconsistency is detected.

## Related Documents

- `docs/KEYV_TO_SQLITE_MIGRATION.md`
- `docs/MONITORING_AND_LOGGING.md`
- `docs/ROLLBACK_PLAN.md`
