/**
 * Database config parsing tests.
 */

import { afterEach, describe, expect, test } from "bun:test";

const originalSynchronousEnv = process.env.KVDB_SQLITE_SYNCHRONOUS;
const originalJournalModeEnv = process.env.KVDB_SQLITE_JOURNAL_MODE;
const originalWalCheckpointIntervalEnv = process.env.KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS;
const originalIntegrityCheckEnv = process.env.KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP;
const originalFts5IntegrityCheckEnv = process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP;
let importCounter = 0;

function resetSynchronousEnv(): void {
  if (originalSynchronousEnv === undefined) {
    delete process.env.KVDB_SQLITE_SYNCHRONOUS;
    return;
  }

  process.env.KVDB_SQLITE_SYNCHRONOUS = originalSynchronousEnv;
}

function resetJournalModeEnv(): void {
  if (originalJournalModeEnv === undefined) {
    delete process.env.KVDB_SQLITE_JOURNAL_MODE;
    return;
  }

  process.env.KVDB_SQLITE_JOURNAL_MODE = originalJournalModeEnv;
}

function resetWalCheckpointIntervalEnv(): void {
  if (originalWalCheckpointIntervalEnv === undefined) {
    delete process.env.KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS;
    return;
  }

  process.env.KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS = originalWalCheckpointIntervalEnv;
}

function resetIntegrityCheckEnv(): void {
  if (originalIntegrityCheckEnv === undefined) {
    delete process.env.KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP;
    return;
  }

  process.env.KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP = originalIntegrityCheckEnv;
}

function resetFts5IntegrityCheckEnv(): void {
  if (originalFts5IntegrityCheckEnv === undefined) {
    delete process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP;
    return;
  }

  process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP = originalFts5IntegrityCheckEnv;
}

async function loadFreshConfigModule() {
  importCounter += 1;
  return import(`../src/libs/kv/db/config.ts?db-config-test=${importCounter}`);
}

afterEach(() => {
  resetSynchronousEnv();
  resetJournalModeEnv();
  resetWalCheckpointIntervalEnv();
  resetIntegrityCheckEnv();
  resetFts5IntegrityCheckEnv();
});

describe("db config", () => {
  test("defaults synchronous to EXTRA", async () => {
    delete process.env.KVDB_SQLITE_SYNCHRONOUS;
    const { getDatabaseConfig } = await loadFreshConfigModule();

    expect(getDatabaseConfig().pragma.synchronous).toBe("EXTRA");
  });

  test("accepts valid synchronous environment override", async () => {
    process.env.KVDB_SQLITE_SYNCHRONOUS = "full";
    const { getDatabaseConfig } = await loadFreshConfigModule();

    expect(getDatabaseConfig().pragma.synchronous).toBe("FULL");
  });

  test("falls back to EXTRA when synchronous value is invalid", async () => {
    process.env.KVDB_SQLITE_SYNCHRONOUS = "invalid-mode";
    const { getDatabaseConfig } = await loadFreshConfigModule();

    expect(getDatabaseConfig().pragma.synchronous).toBe("EXTRA");
  });

  test("accepts valid journal mode environment override", async () => {
    process.env.KVDB_SQLITE_JOURNAL_MODE = "delete";
    const { getDatabaseConfig } = await loadFreshConfigModule();

    expect(getDatabaseConfig().pragma.journalMode).toBe("DELETE");
  });

  test("falls back to WAL when journal mode is invalid", async () => {
    process.env.KVDB_SQLITE_JOURNAL_MODE = "broken-mode";
    const { getDatabaseConfig } = await loadFreshConfigModule();

    expect(getDatabaseConfig().pragma.journalMode).toBe("WAL");
  });

  test("defaults WAL checkpoint interval to 60000ms", async () => {
    delete process.env.KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS;
    const { getDatabaseConfig } = await loadFreshConfigModule();

    expect(getDatabaseConfig().maintenance.walCheckpointIntervalMs).toBe(60000);
  });

  test("accepts non-negative WAL checkpoint interval override", async () => {
    process.env.KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS = "2500";
    const { getDatabaseConfig } = await loadFreshConfigModule();

    expect(getDatabaseConfig().maintenance.walCheckpointIntervalMs).toBe(2500);
  });

  test("falls back when WAL checkpoint interval is invalid", async () => {
    process.env.KVDB_SQLITE_WAL_CHECKPOINT_INTERVAL_MS = "-1";
    const { getDatabaseConfig } = await loadFreshConfigModule();

    expect(getDatabaseConfig().maintenance.walCheckpointIntervalMs).toBe(60000);
  });

  test("defaults startup integrity check to OFF", async () => {
    delete process.env.KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP;
    const { getDatabaseConfig } = await loadFreshConfigModule();

    expect(getDatabaseConfig().maintenance.startupIntegrityCheck).toBe("OFF");
  });

  test("accepts startup integrity check override", async () => {
    process.env.KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP = "quick";
    const { getDatabaseConfig } = await loadFreshConfigModule();

    expect(getDatabaseConfig().maintenance.startupIntegrityCheck).toBe("QUICK");
  });

  test("falls back startup integrity check on invalid value", async () => {
    process.env.KVDB_SQLITE_INTEGRITY_CHECK_ON_STARTUP = "broken";
    const { getDatabaseConfig } = await loadFreshConfigModule();

    expect(getDatabaseConfig().maintenance.startupIntegrityCheck).toBe("OFF");
  });

  test("defaults startup FTS5 integrity check to OFF", async () => {
    delete process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP;
    const { getDatabaseConfig } = await loadFreshConfigModule();

    expect(getDatabaseConfig().maintenance.startupFts5IntegrityCheck).toBe("OFF");
  });

  test("accepts startup FTS5 integrity check override", async () => {
    process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP = "full";
    const { getDatabaseConfig } = await loadFreshConfigModule();

    expect(getDatabaseConfig().maintenance.startupFts5IntegrityCheck).toBe("FULL");
  });

  test("falls back startup FTS5 integrity check on invalid value", async () => {
    process.env.KVDB_SQLITE_FTS5_INTEGRITY_CHECK_ON_STARTUP = "broken";
    const { getDatabaseConfig } = await loadFreshConfigModule();

    expect(getDatabaseConfig().maintenance.startupFts5IntegrityCheck).toBe("OFF");
  });
});
