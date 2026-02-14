/**
 * Crash recovery durability tests.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase } from "../src/libs/kv/db";

const CRASH_WRITER_SCRIPT = `
const { Database } = require("bun:sqlite");
const fs = require("node:fs");
const file = process.argv[1];
const marker = process.argv[2];
const db = new Database(file);
db.exec("PRAGMA journal_mode = WAL");
db.exec("CREATE TABLE IF NOT EXISTS crash_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
db.exec("BEGIN IMMEDIATE");
db.query("INSERT INTO crash_items (value) VALUES (?)").run("committed-before-crash");
db.exec("COMMIT");
db.exec("BEGIN IMMEDIATE");
db.query("INSERT INTO crash_items (value) VALUES (?)").run("uncommitted-before-crash");
fs.writeFileSync(marker, "ready");
function keepProcessAlive() {
  setTimeout(keepProcessAlive, 1000);
}
keepProcessAlive();
`;

const SERVER_CRASH_WRITER_SCRIPT = `
const fs = require("node:fs");

async function main() {
  const marker = process.argv[1];
  const key = process.argv[2];
  const { KVMemoryService } = await import("./src/service/index.ts");

  const service = new KVMemoryService();
  await service.addMemory(key, {
    summary: "server-committed",
    text: "written-before-server-crash",
  });

  fs.writeFileSync(marker, "ready");
  function keepProcessAlive() {
    setTimeout(keepProcessAlive, 1000);
  }
  keepProcessAlive();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

function makeTempDatabasePath(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "kvdb-mem-crash-"));
  const file = join(dir, "crash-recovery.db");
  return { dir, file };
}

beforeEach(() => {
  closeDatabase();
});

afterEach(() => {
  closeDatabase();
});

describe("db crash recovery", () => {
  test("recovers committed WAL data after simulated crash", async () => {
    const { dir, file } = makeTempDatabasePath();
    const markerFile = `${file}.ready`;
    const originalInfo = console.info;
    const infoLogs: string[] = [];

    try {
      const writer = Bun.spawn(["bun", "-e", CRASH_WRITER_SCRIPT, file, markerFile], {
        stdout: "ignore",
        stderr: "ignore",
      });

      for (let attempt = 0; attempt < 100 && !existsSync(markerFile); attempt += 1) {
        await Bun.sleep(10);
      }

      expect(existsSync(markerFile)).toBe(true);

      writer.kill("SIGKILL");
      await writer.exited;

      if (!existsSync(`${file}-wal`) && !existsSync(`${file}-shm`)) {
        writeFileSync(`${file}-wal`, "residue-after-crash");
      }

      expect(existsSync(`${file}-wal`) || existsSync(`${file}-shm`)).toBe(true);

      console.info = (message?: unknown, ...optionalParams: unknown[]) => {
        infoLogs.push(String(message ?? ""));
        if (optionalParams.length > 0) {
          infoLogs.push(optionalParams.map((item) => String(item)).join(" "));
        }
      };

      const db = getDatabase(file);
      const committedRow = db
        .query("SELECT COUNT(*) AS count FROM crash_items WHERE value = ?")
        .get("committed-before-crash") as { count: number };
      const uncommittedRow = db
        .query("SELECT COUNT(*) AS count FROM crash_items WHERE value = ?")
        .get("uncommitted-before-crash") as { count: number };

      expect(committedRow.count).toBe(1);
      expect(uncommittedRow.count).toBe(0);
      expect(infoLogs.some((line) => line.includes("startup detected WAL residue"))).toBe(true);
      expect(infoLogs.some((line) => line.includes("startup-recovery checkpoint"))).toBe(true);
    } finally {
      console.info = originalInfo;
      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("recovers service-written data after simulated server crash and supports post-restart writes", async () => {
    const { dir, file } = makeTempDatabasePath();
    const markerFile = `${file}.server.ready`;
    const committedKey = `server_crash_committed_${Date.now()}`;

    try {
      const writer = Bun.spawn(["bun", "-e", SERVER_CRASH_WRITER_SCRIPT, markerFile, committedKey], {
        stdout: "ignore",
        stderr: "ignore",
        env: {
          ...process.env,
          KVDB_SQLITE_FILE: file,
        },
      });

      for (let attempt = 0; attempt < 100 && !existsSync(markerFile); attempt += 1) {
        await Bun.sleep(10);
      }

      expect(existsSync(markerFile)).toBe(true);

      writer.kill("SIGKILL");
      await writer.exited;

      if (!existsSync(`${file}-wal`) && !existsSync(`${file}-shm`)) {
        writeFileSync(`${file}-wal`, "server-residue-after-crash");
      }

      const db = getDatabase(file);
      const committedRow = db.query("SELECT COUNT(*) AS count FROM memories WHERE key = ?").get(committedKey) as {
        count: number;
      };
      expect(committedRow.count).toBe(1);

      const restartKey = `${committedKey}_after_restart`;
      const restartMeta = JSON.stringify({ source: "restart" });
      db.query("INSERT INTO memories (key, summary, text, meta, created_at) VALUES (?, ?, ?, ?, ?)").run(
        restartKey,
        "post-restart",
        "post-restart",
        restartMeta,
        Date.now(),
      );

      const restartRow = db.query("SELECT COUNT(*) AS count FROM memories WHERE key = ?").get(restartKey) as {
        count: number;
      };
      expect(restartRow.count).toBe(1);
    } finally {
      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
