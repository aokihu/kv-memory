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

### SQLite Crash-Safety Metrics

#### WAL (Write-Ahead Log) Metrics

Monitor these metrics to ensure crash-safety mechanisms are functioning correctly:

| Metric Name | Type | Description | Alert Threshold |
|-------------|------|-------------|-----------------|
| `sqlite_wal_file_size_bytes` | Gauge | Current size of `-wal` file | > 100MB |
| `sqlite_wal_checkpoint_count` | Counter | Number of checkpoints executed | N/A |
| `sqlite_wal_checkpoint_duration_ms` | Histogram | Time taken for checkpoint operations | > 5000ms |
| `sqlite_startup_recovery_executed` | Counter | Number of startup WAL recovery operations | sudden spikes |
| `sqlite_integrity_check_failures` | Counter | Number of failed integrity checks | > 0 |

#### Checkpoint Monitoring

Track checkpoint operations to ensure WAL file doesn't grow unbounded:

```bash
# Monitor checkpoint log entries
journalctl -u kvdb-mem | grep -E "checkpoint"

# Expected patterns:
# - "startup-recovery checkpoint completed" - Startup recovery worked
# - "periodic-checkpoint completed" - Regular checkpoint working
# - "closeDatabase checkpoint completed" - Clean shutdown checkpoint
```

#### WAL File Size Monitoring

Monitor WAL file size to detect checkpoint issues:

```bash
# Check WAL file size
ls -lh /var/lib/kvdb-mem/kv.db-wal

# Set up automated monitoring (example with cron)
# Add to /etc/cron.d/kvdb-mem-monitoring
*/5 * * * * root /usr/local/bin/check-wal-size.sh

# check-wal-size.sh script:
#!/bin/bash
WAL_FILE="/var/lib/kvdb-mem/kv.db-wal"
MAX_SIZE=$((100 * 1024 * 1024))  # 100MB

if [ -f "$WAL_FILE" ]; then
    SIZE=$(stat -f%z "$WAL_FILE" 2>/dev/null || stat -c%s "$WAL_FILE" 2>/dev/null)
    if [ "$SIZE" -gt "$MAX_SIZE" ]; then
        echo "ALERT: WAL file size ${SIZE} bytes exceeds threshold ${MAX_SIZE} bytes" | \
            logger -t kvdb-mem -p user.alert
    fi
fi
```

#### Startup Recovery Monitoring

Detect unexpected shutdowns and recovery events:

```bash
# Monitor startup recovery events
journalctl -u kvdb-mem | grep -E "(startup detected WAL residue|startup-recovery)"

# Alert if recovery events spike (indicating frequent crashes)
# Example: More than 3 recoveries in 1 hour suggests instability
```

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

### General Metrics

- Alert if `migration_validation_mismatches > 0`
- Alert if API success rate < 99% for 5 minutes
- Alert if p95 latency doubles baseline for 10 minutes
- Alert if sqlite timeout errors exceed threshold (e.g. 20/min)

### Crash-Safety Specific Alerts

| Alert Condition | Severity | Description | Action |
|-----------------|----------|-------------|--------|
| `sqlite_wal_file_size_bytes > 100MB` | Warning | WAL file growing too large | Check checkpoint functionality, consider reducing checkpoint interval |
| `sqlite_wal_checkpoint_duration_ms > 5000ms` | Warning | Checkpoint taking too long | Monitor disk I/O, consider storage upgrade |
| `sqlite_startup_recovery_executed` spike | Critical | Frequent crash recoveries | Investigate service stability, check for OOM or crashes |
| `sqlite_integrity_check_failures > 0` | Critical | Database corruption detected | Immediate investigation, restore from backup if confirmed |
| `wal_checkpoint_failed` | Warning | Checkpoint operation failed | Check disk space and permissions |

### Example Alertmanager Rules (Prometheus)

```yaml
groups:
  - name: kvdb_mem_crash_safety
    rules:
      # WAL file size alert
      - alert: KVDB_WALFileTooLarge
        expr: sqlite_wal_file_size_bytes > 100 * 1024 * 1024
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "KVDB WAL file is too large"
          description: "WAL file size is {{ $value }} bytes, exceeding 100MB threshold"
      
      # Startup recovery spike
      - alert: KVDB_FrequentCrashRecovery
        expr: increase(sqlite_startup_recovery_executed[1h]) > 3
        labels:
          severity: critical
        annotations:
          summary: "Frequent crash recovery events detected"
          description: "{{ $value }} crash recoveries in the last hour"
      
      # Integrity check failure
      - alert: KVDB_IntegrityCheckFailed
        expr: increase(sqlite_integrity_check_failures[5m]) > 0
        labels:
          severity: critical
        annotations:
          summary: "Database integrity check failed"
          description: "Database corruption may have occurred"
```

## Operational Checklist

### Standard Migration Checklist

1. Capture migration report and archive with release version.
2. Monitor first 30 minutes after cutover with high frequency checks.
3. Compare key counts against pre-deployment baseline.
4. Keep rollback path ready until metrics stabilize.

### Crash-Safety Specific Checklist

**Pre-Deployment:**

- [ ] Validate crash-safety configuration in staging environment
- [ ] Run full crash-safety test suite (db.crash-recovery, db.integrity, db.config tests)
- [ ] Execute benchmark tests and confirm performance within acceptable range
- [ ] Document rollback procedures specific to crash-safety configuration
- [ ] Verify backup and restore procedures are tested and documented

**During Deployment:**

- [ ] Monitor startup logs for successful crash-safety initialization
- [ ] Verify WAL mode is enabled: `PRAGMA journal_mode = wal`
- [ ] Confirm synchronous mode is set correctly
- [ ] Watch for any startup recovery events (unexpected, may indicate prior crash)
- [ ] Verify first periodic checkpoint executes successfully

**Post-Deployment (First 24 Hours):**

- [ ] Monitor WAL file size - should not grow unbounded
- [ ] Check checkpoint completion logs at regular intervals
- [ ] Watch for any integrity check failures in logs
- [ ] Verify performance metrics are within expected bounds
- [ ] Monitor for any startup recovery events (indicating crashes)

**Ongoing Operations:**

- [ ] Weekly: Review crash-safety metrics (WAL size, checkpoint success rate)
- [ ] Monthly: Review logs for integrity check results and startup recovery events
- [ ] Quarterly: Execute full integrity check in maintenance window
- [ ] Annually: Review and test disaster recovery procedures

## Related Documents

- `../CONFIGURATION.md` - Comprehensive configuration reference including SQLite crash-safety settings
- `KEYV_TO_SQLITE_MIGRATION.md`
- `ROLLBACK_PLAN.md`
- `SQLITE_CRASH_SAFETY_TROUBLESHOOTING.md` - Common issues and solutions
- `WAL_MONITORING.md` - WAL file monitoring and alerting setup

