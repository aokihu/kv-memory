/**
 * SQLite durability configuration benchmark.
 *
 * Focus:
 * 1) EXTRA synchronous overhead in WAL mode.
 * 2) WAL mode vs default DELETE journal mode.
 */

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WRITE_OPERATIONS = Number(process.env.BENCH_WRITE_OPERATIONS ?? "1200");

type JournalMode = "WAL" | "DELETE";
type SynchronousMode = "NORMAL" | "FULL" | "EXTRA";

type DurabilityScenario = {
  name: string;
  journalMode: JournalMode;
  synchronous: SynchronousMode;
};

type BenchmarkRow = {
  scenario: string;
  journalMode: JournalMode;
  synchronous: SynchronousMode;
  writes: number;
  totalMs: number;
  avgMs: number;
  opsPerSec: number;
};

const SCENARIOS: DurabilityScenario[] = [
  {
    name: "wal_extra",
    journalMode: "WAL",
    synchronous: "EXTRA",
  },
  {
    name: "wal_normal",
    journalMode: "WAL",
    synchronous: "NORMAL",
  },
  {
    name: "delete_full",
    journalMode: "DELETE",
    synchronous: "FULL",
  },
];

export async function runSqliteCrashSafetyBenchmark(): Promise<BenchmarkRow[]> {
  const rows: BenchmarkRow[] = [];

  for (const scenario of SCENARIOS) {
    rows.push(runScenario(scenario, WRITE_OPERATIONS));
  }

  printResults(rows);
  printComparisonSummary(rows);
  return rows;
}

function runScenario(scenario: DurabilityScenario, writes: number): BenchmarkRow {
  const sandbox = mkdtempSync(join(tmpdir(), `kvdb-bench-${scenario.name}-`));
  const file = join(sandbox, `${scenario.name}.db`);
  const db = new Database(file);

  try {
    db.exec(`PRAGMA journal_mode = ${scenario.journalMode}`);
    db.exec(`PRAGMA synchronous = ${scenario.synchronous}`);
    db.exec("PRAGMA temp_store = MEMORY");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("CREATE TABLE benchmark_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");

    const statement = db.query("INSERT INTO benchmark_items (value) VALUES (?)");

    const started = performance.now();
    for (let index = 0; index < writes; index += 1) {
      db.exec("BEGIN IMMEDIATE");
      statement.run(`item-${index}`);
      db.exec("COMMIT");
    }
    const totalMs = performance.now() - started;

    return {
      scenario: scenario.name,
      journalMode: scenario.journalMode,
      synchronous: scenario.synchronous,
      writes,
      totalMs,
      avgMs: totalMs / writes,
      opsPerSec: (writes / totalMs) * 1000,
    };
  } finally {
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function printResults(rows: BenchmarkRow[]): void {
  console.log("\nSQLite Crash Safety Benchmark");
  console.log("scenario\tjournal\tsynchronous\twrites\ttotal_ms\tavg_ms\tops_per_sec");

  for (const row of rows) {
    console.log(
      `${row.scenario}\t${row.journalMode}\t${row.synchronous}\t${row.writes}\t${row.totalMs.toFixed(2)}\t${row.avgMs.toFixed(4)}\t${row.opsPerSec.toFixed(2)}`,
    );
  }
}

function printComparisonSummary(rows: BenchmarkRow[]): void {
  const walExtra = rows.find((item) => item.scenario === "wal_extra");
  const walNormal = rows.find((item) => item.scenario === "wal_normal");
  const deleteFull = rows.find((item) => item.scenario === "delete_full");

  if (!walExtra || !walNormal || !deleteFull) {
    return;
  }

  const extraOverNormal = ((walExtra.totalMs - walNormal.totalMs) / walNormal.totalMs) * 100;
  const walExtraVsDelete = ((walExtra.totalMs - deleteFull.totalMs) / deleteFull.totalMs) * 100;

  console.log("\nComparison Summary");
  console.log(`WAL EXTRA vs WAL NORMAL total time delta: ${extraOverNormal.toFixed(2)}%`);
  console.log(`WAL EXTRA vs DELETE FULL total time delta: ${walExtraVsDelete.toFixed(2)}%`);
}

if (import.meta.main) {
  await runSqliteCrashSafetyBenchmark();
}
