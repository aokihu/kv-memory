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
5. **Verify crash-safety configuration** - confirm WAL mode and synchronous settings.
6. **Validate WAL checkpoint functionality** - ensure periodic checkpoint is working.

## Production Crash-Safety Baseline

Use these environment variables as the minimum production baseline:

```bash
KVDB_SQLITE_FILE=/var/lib/kvdb-mem/kv.db
KVDB_SQLITE_JOURNAL_MODE=WAL
KVDB_SQLITE_SYNCHRONOUS=EXTRA
KVDB_SQLITE_BUSY_TIMEOUT_MS=10000
KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=60000
KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=QUICK
KVDB_SQLITE_FOREIGN_KEYS=on
```

Why these values:

- `WAL + EXTRA` is the default crash-safety profile implemented in runtime bootstrap.
- periodic checkpoint limits WAL growth during sustained writes.
- startup `QUICK` check catches structural corruption earlier with low startup cost.

## Step-by-Step Rollout

### 1) Pre-Deployment Validation

```bash
bunx tsc --noEmit
bun test tests/kv.sqlite.test.ts tests/db.schema.test.ts tests/db.migrate.test.ts tests/api-compatibility.test.ts tests/concurrent-access.test.ts tests/final-verification.test.ts
```

**Crash-Safety Validation** (run these additional tests):

```bash
# Validate crash recovery mechanisms
bun test tests/db.crash-recovery.test.ts

# Validate integrity check functionality
bun test tests/db.integrity.test.ts

# Validate configuration handling
bun test tests/db.config.test.ts

# Run SQLite crash-safety benchmark
bun run bench:sqlite-safety
```

Expected benchmark results for production-ready configuration:
- `wal_extra` (synchronous=EXTRA): ~17-20ms per 1000 writes
- `wal_normal` (synchronous=NORMAL): ~14-17ms per 1000 writes
- Should show <25% overhead for EXTRA vs NORMAL

### 2) Service Startup

```bash
bun run dev
```

**Crash-Safety Verification on Startup:**

Monitor startup logs for these crash-safety indicators:

```bash
# Check for successful crash-safety initialization
journalctl -u kvdb-mem -f | grep -E "(startup|checkpoint|integrity)"

# Expected log entries:
# - "startup detected WAL residue" (if recovery needed)
# - "startup-recovery checkpoint completed" (recovery success)
# - "startup quick_check passed" (integrity check passed)
# - "periodic-checkpoint completed" (ongoing checkpoint working)
```

### 3) Post-Deployment Validation

- Execute smoke API checks for login/add/get/update/update_key.
- Verify DB table counts are non-zero for expected namespaces.
- Verify logs do not contain schema init or database open errors.

**Crash-Safety Specific Validation:**

```bash
# 1. Resolve database file from runtime env
DB_FILE="${KVDB_SQLITE_FILE:-./kv.db}"

# 2. Verify crash-safety PRAGMA values are active
sqlite3 "$DB_FILE" "PRAGMA journal_mode;"  # Expected: wal
sqlite3 "$DB_FILE" "PRAGMA synchronous;"   # Expected: 3 (EXTRA)
sqlite3 "$DB_FILE" "PRAGMA busy_timeout;"  # Expected: 10000 (or configured value)

# 3. Test write durability
sqlite3 "$DB_FILE" "BEGIN; INSERT INTO memories VALUES('test-key', 'test', 'test', '{}', 1234567890); COMMIT;"
sync  # Force OS cache to disk
# Verify data persists across restart

# 4. Check WAL file is being managed
ls -lh "$DB_FILE-wal"  # Should exist during writes
# Wait for checkpoint interval (default 60s)
sleep 65
ls -lh "$DB_FILE-wal"  # Should be smaller/truncated

# 5. Verify startup integrity check (if enabled)
# Look in logs for: "startup quick_check passed"
```

### 4) Deployment Verification Checklist (Crash-Safety)

Run this sequence after every production rollout:

1. verify PRAGMA runtime values (`journal_mode`, `synchronous`, `busy_timeout`)
2. verify periodic checkpoint log appears within configured interval
3. verify WAL file size does not continuously grow for 2-3 intervals
4. if startup integrity check is enabled, verify pass log exists
5. run smoke API write+read and verify persisted data after service restart

## Incident Triggers

Initiate rollback immediately if any of the following occurs:

- Service fails to open or initialize SQLite database.
- Critical API routes fail continuously after deployment.
- Data read/write inconsistency is detected.
- **Crash-safety configuration validation fails** (e.g., WAL mode not enabled, synchronous mode misconfigured)
- **Startup integrity check reports corruption or inconsistencies**
- **WAL checkpoint consistently fails** or WAL file grows unbounded
- **Performance degradation exceeds 50%** after crash-safety configuration changes

### Crash-Safety Specific Rollback Criteria

If crash-safety configuration causes issues:

1. **Immediate mitigation** (keep service running):
   ```bash
   # Reduce synchronous level for better performance
   export KVDB_SQLITE_SYNCHRONOUS=NORMAL
   
   # Increase checkpoint frequency
   export KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=30000
   
   # Disable startup integrity check if causing delays
   export KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=OFF
   ```

2. **Full rollback** (if data corruption suspected):
   ```bash
   # Stop service
   systemctl stop kvdb-mem
   
   # Restore from pre-deployment backup
   cp /backup/kv.db.$(date +%Y%m%d) /var/lib/kvdb-mem/kv.db
   
   # Revert configuration
   export KVDB_SQLITE_SYNCHRONOUS=EXTRA
   export KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=60000
   
   # Restart with integrity check
   export KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=FULL
   systemctl start kvdb-mem
   ```

## Crash-Safety Deployment Configuration

### Environment-Specific Configurations

#### Development Environment
Focus on developer productivity with reasonable safety:

```bash
# .env.development
NODE_ENV=development
KVDB_SQLITE_FILE=./kv.db

# Crash-safety: Balance performance and durability
KVDB_SQLITE_SYNCHRONOUS=NORMAL        # Good performance, acceptable durability
KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=30000  # 30 seconds
KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=OFF    # Fast startup
KVDB_SQLITE_BUSY_TIMEOUT_MS=5000
```

#### Staging Environment
Match production configuration for realistic testing:

```bash
# .env.staging
NODE_ENV=production
KVDB_SQLITE_FILE=/var/lib/kvdb-mem/kv.db

# Crash-safety: Match production
KVDB_SQLITE_SYNCHRONOUS=EXTRA
KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=60000
KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=QUICK
KVDB_SQLITE_BUSY_TIMEOUT_MS=10000
```

#### Production Environment
Maximum durability and reliability:

```bash
# .env.production
NODE_ENV=production
KVDB_SQLITE_FILE=/var/lib/kvdb-mem/kv.db

# Crash-safety: Maximum durability
KVDB_SQLITE_SYNCHRONOUS=EXTRA              # Highest durability guarantee
KVDB_SQLITE_JOURNAL_MODE=WAL                # WAL mode for crash recovery
KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=60000 # Checkpoint every minute
KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=QUICK  # Quick integrity verification
KVDB_SQLITE_BUSY_TIMEOUT_MS=10000           # 10-second lock timeout
KVDB_SQLITE_FOREIGN_KEYS=on                 # Enforce referential integrity
```

### Systemd Service with Crash-Safety

Production systemd service with crash-safety considerations:

```ini
# /etc/systemd/system/kvdb-mem.service
[Unit]
Description=KVDB Memory Service
After=network.target

[Service]
Type=simple
User=kvdb
Group=kvdb
WorkingDirectory=/opt/kvdb-mem

# Crash-safety environment variables
Environment="NODE_ENV=production"
Environment="PORT=3000"
Environment="KVDB_SQLITE_FILE=/var/lib/kvdb-mem/kv.db"
Environment="KVDB_SQLITE_SYNCHRONOUS=EXTRA"
Environment="KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS=60000"
Environment="KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP=QUICK"

ExecStart=/usr/bin/bun run index.ts

# Restart policy for crash recovery
Restart=always
RestartSec=10
StartLimitInterval=60
StartLimitBurst=3

# Graceful shutdown for checkpoint
TimeoutStopSec=30
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

### Pre-Deployment Checklist

Before deploying to production, verify:

- [ ] Crash-safety environment variables are set correctly
- [ ] `KVDB_SQLITE_SYNCHRONOUS` is set appropriately for your durability requirements
- [ ] WAL checkpoint interval is configured based on write volume
- [ ] Disk I/O performance is sufficient for chosen synchronous mode
- [ ] Backup strategy is in place and tested
- [ ] Integrity check on startup is enabled (at least QUICK mode)
- [ ] Monitoring is configured for WAL file size and checkpoint events

### Post-Deployment Verification

After deployment, verify crash-safety is working:

```bash
# 1. Verify configuration is active
DB_FILE="${KVDB_SQLITE_FILE:-./kv.db}"
sqlite3 "$DB_FILE" "PRAGMA journal_mode;"  # Should return "wal"
sqlite3 "$DB_FILE" "PRAGMA synchronous;"  # Should return 3 (EXTRA)

# 2. Check logs for successful startup
journalctl -u kvdb-mem | grep -E "(journal_mode|synchronous|checkpoint|integrity)"

# 3. Verify WAL file is being managed
ls -lh "$DB_FILE-wal"  # Should exist during writes
sleep 65  # Wait for checkpoint
ls -lh "$DB_FILE-wal"  # Should be smaller/truncated

# 4. Test crash recovery (in staging only)
systemctl stop kvdb-mem  # Simulate crash
# Verify checkpoint on shutdown
systemctl start kvdb-mem
# Verify startup recovery worked correctly
```

## Related Documents

- `docs/KEYV_TO_SQLITE_MIGRATION.md`
- `docs/MONITORING_AND_LOGGING.md`
- `docs/ROLLBACK_PLAN.md`
- `docs/SQLITE_CRASH_SAFETY_TROUBLESHOOTING.md` - Common issues and solutions
- `docs/WAL_MONITORING.md` - WAL file monitoring and alerting setup

## Implementation and Test References

- Runtime crash-safety bootstrap: `src/libs/kv/db/schema.ts`
- Config parsing and defaults: `src/libs/kv/db/config.ts`
- Integrity check wrappers: `src/libs/kv/db/integrity.ts`
- Validation tests: `tests/db.config.test.ts`, `tests/db.schema.test.ts`, `tests/db.integrity.test.ts`, `tests/db.crash-recovery.test.ts`
