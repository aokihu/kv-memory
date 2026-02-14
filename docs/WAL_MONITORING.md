# WAL Monitoring Guide

## Purpose

This guide defines practical WAL monitoring for SQLite crash-safety runtime.

## Scope

Covers:

- WAL file size monitoring (`*.db-wal`)
- checkpoint status verification
- alert thresholds and escalation suggestions

## Runtime Signals Used by This Project

The implementation emits these checkpoint/integrity logs:

- `startup detected WAL residue`
- `startup-recovery checkpoint completed`
- `periodic-checkpoint completed`
- `closeDatabase checkpoint completed`
- `... checkpoint failed ...`

Reference: `src/libs/kv/db/schema.ts`

## Baseline Configuration

Recommended production baseline:

```bash
KVDB_SQLITE_FILE=/var/lib/kvdb-mem/kv.db
KVDB_SQLITE_JOURNAL_MODE=WAL
KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=60000
KVDB_SQLITE_SYNCHRONOUS=EXTRA
```

## What to Monitor

## 1) WAL File Size

WAL growth should be cyclical, not unbounded.

```bash
DB_FILE="${KVDB_SQLITE_FILE:-./kv.db}"
WAL_FILE="${DB_FILE}-wal"

if [ -f "$WAL_FILE" ]; then
  stat -c "%n %s" "$WAL_FILE"
else
  echo "WAL file not present (idle or fully checkpointed)."
fi
```

## 2) Checkpoint Status (On-demand)

Use SQLite checkpoint pragma output (`busy`, `log`, `checkpointed`) to observe current progress.

```bash
DB_FILE="${KVDB_SQLITE_FILE:-./kv.db}"
sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(PASSIVE);"
```

Interpretation:

- `busy > 0`: checkpoint blocked by active writer/reader
- `log` keeps increasing for multiple intervals: checkpoint is not keeping up
- `checkpointed` should increase over time in a healthy system

## 3) Runtime Log Health

```bash
journalctl -u kvdb-mem -S "10 minutes ago" | grep -E "(periodic-checkpoint|startup-recovery|checkpoint failed)"
```

## Suggested Alert Thresholds

| Signal | Warning | Critical | Recommended Action |
| --- | --- | --- | --- |
| WAL file size | `> 128MB` for 10m | `> 512MB` for 10m | Reduce checkpoint interval; inspect long transactions |
| Checkpoint failures | `>= 1` in 5m | `>= 3` in 15m | Check disk, permissions, lock contention |
| `busy` in checkpoint result | Continuous for 5m | Continuous for 15m | Identify long-running readers/writers |
| Startup recovery events | `>= 2` in 1h | `>= 5` in 1h | Investigate process crashes/host instability |

## Sample Monitoring Script (Cron-friendly)

```bash
#!/usr/bin/env bash
set -euo pipefail

DB_FILE="${KVDB_SQLITE_FILE:-/var/lib/kvdb-mem/kv.db}"
WAL_FILE="${DB_FILE}-wal"
WARN_BYTES=$((128 * 1024 * 1024))
CRIT_BYTES=$((512 * 1024 * 1024))

if [ -f "$WAL_FILE" ]; then
  size_bytes=$(stat -c%s "$WAL_FILE")
  if [ "$size_bytes" -ge "$CRIT_BYTES" ]; then
    logger -t kvdb-mem -p user.crit "WAL size critical: ${size_bytes} bytes"
  elif [ "$size_bytes" -ge "$WARN_BYTES" ]; then
    logger -t kvdb-mem -p user.warn "WAL size warning: ${size_bytes} bytes"
  fi
fi

checkpoint_row=$(sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(PASSIVE);")
echo "checkpoint_status=$checkpoint_row"
```

## Operational Response Playbook

When alerts trigger:

1. verify `KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS` is not `0`
2. run manual checkpoint: `sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(TRUNCATE);"`
3. inspect logs for `checkpoint failed` and disk/permission errors
4. if `busy` persists, inspect long transactions and reduce lock hold time
5. if startup recovery spikes, investigate service restarts and host stability

## Validation References

- Checkpoint lifecycle tests: `tests/db.schema.test.ts`
- Crash recovery tests: `tests/db.crash-recovery.test.ts`
- Configuration parsing tests: `tests/db.config.test.ts`
