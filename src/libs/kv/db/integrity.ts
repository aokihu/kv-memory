/**
 * SQLite integrity check helpers.
 *
 * These wrappers normalize PRAGMA outputs for startup checks and manual diagnostics.
 * Debug entry point: inspect `messages` when `ok` is false.
 */

import type { Database } from "bun:sqlite";

/**
 * Integrity check mode.
 */
export type DatabaseIntegrityCheckMode = "quick" | "full";

/**
 * Normalized integrity check result.
 */
export type DatabaseIntegrityCheckResult = {
  mode: DatabaseIntegrityCheckMode;
  ok: boolean;
  messages: string[];
};

/**
 * FTS5 startup integrity check mode.
 */
export type Fts5IntegrityCheckMode = "QUICK" | "FULL";

/**
 * Normalized FTS5 startup integrity result payload.
 */
export type Fts5IntegrityCheckResult = {
  mode: Fts5IntegrityCheckMode;
  ok: boolean;
  checks: string[];
  issues: string[];
};

const FTS5_REQUIRED_TRIGGERS = ["memories_fts_insert", "memories_fts_delete", "memories_fts_update"] as const;

/**
 * Execute `PRAGMA quick_check` and return normalized result payload.
 */
export function runQuickCheck(db: Database): DatabaseIntegrityCheckResult {
  return runCheck(db, "quick");
}

/**
 * Execute `PRAGMA integrity_check` and return normalized result payload.
 */
export function runIntegrityCheck(db: Database): DatabaseIntegrityCheckResult {
  return runCheck(db, "full");
}

/**
 * Run startup-safe FTS5 integrity checks.
 *
 * QUICK mode validates required table presence and basic MATCH query execution.
 * FULL mode includes QUICK checks plus trigger existence, count parity, and row sampling.
 */
export function runFts5IntegrityCheck(db: Database, mode: Fts5IntegrityCheckMode): Fts5IntegrityCheckResult {
  const checks: string[] = [];
  const issues: string[] = [];

  const tableExists =
    (db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memories_fts' LIMIT 1")
      .get() as { name: string } | null) !== null;

  if (!tableExists) {
    issues.push("missing required table memories_fts");
    return {
      mode,
      ok: false,
      checks,
      issues,
    };
  }

  checks.push("memories_fts table exists");

  try {
    db.query("SELECT rowid FROM memories_fts WHERE memories_fts MATCH ? LIMIT 1").all(
      "kvdb_fts5_integrity_probe_token",
    );
    checks.push("memories_fts MATCH query executable");
  } catch (error) {
    issues.push(`memories_fts MATCH query failed: ${extractErrorMessage(error)}`);
  }

  if (mode === "FULL") {
    const triggerRows = db
      .query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (?, ?, ?)")
      .all(...FTS5_REQUIRED_TRIGGERS) as Array<{ name: string }>;
    const triggerNames = new Set(triggerRows.map((row) => row.name));

    for (const triggerName of FTS5_REQUIRED_TRIGGERS) {
      if (!triggerNames.has(triggerName)) {
        issues.push(`missing required trigger ${triggerName}`);
      }
    }

    if (triggerNames.size === FTS5_REQUIRED_TRIGGERS.length) {
      checks.push("FTS5 triggers exist");
    }

    const memoriesRow = db.query("SELECT COUNT(*) AS count FROM memories").get() as { count: number } | null;
    const ftsRow = db.query("SELECT COUNT(*) AS count FROM memories_fts").get() as { count: number } | null;
    const memoriesCount = memoriesRow?.count ?? 0;
    const ftsCount = ftsRow?.count ?? 0;

    if (memoriesCount !== ftsCount) {
      issues.push(`row count mismatch memories=${memoriesCount} memories_fts=${ftsCount}`);
    } else {
      checks.push(`row count matched (${memoriesCount})`);
    }

    const sampleRows = db
      .query("SELECT rowid, key FROM memories ORDER BY rowid DESC LIMIT 10")
      .all() as Array<{ rowid: number; key: string }>;

    for (const sample of sampleRows) {
      const indexed =
        (db.query("SELECT rowid FROM memories_fts WHERE rowid = ? LIMIT 1").get(sample.rowid) as
          | { rowid: number }
          | null) !== null;
      if (!indexed) {
        issues.push(`sample row missing from memories_fts rowid=${sample.rowid} key=${sample.key}`);
      }
    }

    if (sampleRows.length === 0 || !issues.some((issue) => issue.startsWith("sample row missing"))) {
      checks.push(`sample validation passed (${sampleRows.length} rows)`);
    }
  }

  return {
    mode,
    ok: issues.length === 0,
    checks,
    issues,
  };
}

function runCheck(db: Database, mode: DatabaseIntegrityCheckMode): DatabaseIntegrityCheckResult {
  const pragmaName = mode === "quick" ? "quick_check" : "integrity_check";
  const rows = db.query(`PRAGMA ${pragmaName}`).all() as Array<Record<string, unknown>>;

  const messages = rows
    .map((row) => {
      const value = row[pragmaName];
      if (typeof value === "string") {
        return value.trim();
      }

      if (value === null || value === undefined) {
        return "";
      }

      return String(value).trim();
    })
    .filter((message) => message.length > 0);

  return {
    mode,
    ok: messages.length > 0 && messages.every((message) => message.toLowerCase() === "ok"),
    messages,
  };
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
