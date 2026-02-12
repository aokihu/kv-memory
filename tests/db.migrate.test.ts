/**
 * Migration removal regression checks.
 *
 * Debug entry point: if this test fails, inspect `src/libs/kv/db/index.ts`
 * and verify migration exports were not reintroduced.
 */

import { describe, expect, test } from "bun:test";
import * as dbModule from "../src/libs/kv/db";

describe("db migration removal", () => {
  test("db module does not export migrateKeyvToSQLite", () => {
    const exportedKeys = new Set(Object.keys(dbModule));
    expect(exportedKeys.has("migrateKeyvToSQLite")).toBe(false);
  });
});
