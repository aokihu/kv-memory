# Deployment Guide

## Purpose

This guide defines the production rollout steps for fresh SQLite deployment.

## Preconditions

- Code is merged and release artifact is built.
- Database host has enough free disk space for runtime DB and backups.
- Operator has access to run Bun scripts in production environment.

## Safety Checkpoints

1. Confirm deployment config points to expected SQLite file path.
2. Confirm runtime directory is writable.
3. Run test/compile verification before release.
4. Start service and verify schema tables are created.

## Step-by-Step Rollout

### 1) Pre-Deployment Validation

```bash
bunx tsc --noEmit
bun test tests/kv.sqlite.test.ts tests/db.schema.test.ts tests/db.migrate.test.ts tests/api-compatibility.test.ts tests/concurrent-access.test.ts tests/final-verification.test.ts
```

### 2) Service Startup

```bash
bun run dev
```

### 3) Post-Deployment Validation

- Execute smoke API checks for login/add/get/update/update_key.
- Verify DB table counts are non-zero for expected namespaces.
- Verify logs do not contain schema init or database open errors.

## Incident Triggers

Initiate rollback immediately if any of the following occurs:

- Service fails to open or initialize SQLite database.
- Critical API routes fail continuously after deployment.
- Data read/write inconsistency is detected.

## Related Documents

- `docs/KEYV_TO_SQLITE_MIGRATION.md`
- `docs/MONITORING_AND_LOGGING.md`
- `docs/ROLLBACK_PLAN.md`
