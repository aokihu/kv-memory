# SQLite Crash-Safety Troubleshooting

## Purpose

This guide helps diagnose and resolve SQLite crash-safety issues in production.

## Quick Triage Checklist

Run these checks first:

```bash
DB_FILE="${KVDB_SQLITE_FILE:-./kv.db}"

# 1) Core PRAGMA state
sqlite3 "$DB_FILE" "PRAGMA journal_mode;"
sqlite3 "$DB_FILE" "PRAGMA synchronous;"
sqlite3 "$DB_FILE" "PRAGMA busy_timeout;"

# 2) WAL status
ls -lh "$DB_FILE" "$DB_FILE-wal" "$DB_FILE-shm" 2>/dev/null || true
sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(PASSIVE);"

# 3) Integrity checks
sqlite3 "$DB_FILE" "PRAGMA quick_check;"
sqlite3 "$DB_FILE" "PRAGMA integrity_check;"

# 4) Runtime logs (systemd)
journalctl -u kvdb-mem -S "30 minutes ago" | grep -E "(checkpoint|startup|integrity|locked|busy)"
```

## Common Issues and Fixes

## 1) WAL file keeps growing

Symptoms:

- `*.db-wal` grows continuously across multiple checkpoint intervals
- logs include repeated checkpoint warnings/failures

Likely causes:

- `KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=0`
- long-running read transactions blocking checkpoint
- disk/permission errors during checkpoint

Actions:

1. verify checkpoint interval is enabled (`> 0`)
2. run manual checkpoint:

   ```bash
   sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(TRUNCATE);"
   ```

3. inspect long-running clients and reduce transaction duration
4. verify filesystem writable and disk has free space

## 2) Frequent startup recovery logs

Symptoms:

- frequent `startup detected WAL residue`
- frequent `startup-recovery checkpoint completed`

Likely causes:

- service process crashes or hard kills
- host instability (OOM, abrupt restart, node reboot)

Actions:

1. inspect service crash history (`journalctl -u kvdb-mem`)
2. inspect host OOM/reboot events (`dmesg`, node monitoring)
3. verify graceful shutdown path is used in deploy scripts
4. keep `KVDB_SQLITE_SYNCHRONOUS=EXTRA` for durability

## 3) Slow startup when integrity check enabled

Symptoms:

- startup latency increases significantly
- startup logs wait on integrity check completion

Likely causes:

- `KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=FULL` on large DB

Actions:

1. switch startup mode to `QUICK` for normal production
2. run `FULL` only in maintenance windows
3. if check fails, follow Issue 4 (integrity failure)

## 4) Integrity check fails

Symptoms:

- `PRAGMA quick_check` or `PRAGMA integrity_check` returns non-`ok`
- startup logs show `startup ..._check failed`

Actions:

1. stop write traffic (maintenance mode)
2. backup current DB/WAL/SHM files immediately
3. run full check and capture output:

   ```bash
   sqlite3 "$DB_FILE" "PRAGMA integrity_check;"
   ```

4. if corruption confirmed, restore from latest valid backup
5. after restore, run `PRAGMA integrity_check;` again before reopening writes

## 5) SQLITE_BUSY / database is locked

Symptoms:

- logs contain lock timeout or busy errors
- write requests retry then fail

Likely causes:

- high write contention from multiple processes
- long transactions holding `BEGIN IMMEDIATE` locks

Actions:

1. verify `KVDB_SQLITE_BUSY_TIMEOUT_MS` is reasonable (e.g. `10000`)
2. reduce lock duration in callers (short transactions)
3. monitor checkpoint `busy` result via:

   ```bash
   sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(PASSIVE);"
   ```

4. review concurrent access tests and align workload patterns

## Diagnostic Tools

## SQL probes

```bash
# checkpoint status
sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(PASSIVE);"

# force truncate checkpoint (manual maintenance)
sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(TRUNCATE);"

# quick structural check
sqlite3 "$DB_FILE" "PRAGMA quick_check;"

# full integrity check
sqlite3 "$DB_FILE" "PRAGMA integrity_check;"
```

## Log probes

```bash
journalctl -u kvdb-mem -S "1 hour ago" | grep -E "(startup|checkpoint|integrity|busy|locked)"
```

## Escalation Rules

Escalate immediately when:

- `integrity_check` result is not `ok`
- checkpoint failures persist for 15+ minutes
- WAL size remains above critical threshold after manual checkpoint
- startup recovery events spike and coincide with write failures

## Implementation and Test References

- Runtime checkpoint/recovery/integrity orchestration: `src/libs/kv/db/schema.ts`
- Config defaults and env parsing: `src/libs/kv/db/config.ts`
- Integrity wrappers: `src/libs/kv/db/integrity.ts`
- Tests:
  - `tests/db.crash-recovery.test.ts`
  - `tests/db.integrity.test.ts`
  - `tests/db.schema.test.ts`
  - `tests/db.transaction.test.ts`
