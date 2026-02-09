/**
 * Source database backup utilities.
 *
 * This module creates immutable file copies before migration starts.
 * Debug entry point: inspect `backupDatabaseFile()` if backup file is missing.
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Backup result metadata.
 */
export type BackupResult = {
  sourcePath: string;
  backupPath: string;
  createdAt: number;
  copiedSidecars: string[];
};

/**
 * Create a backup copy for SQLite database file and its sidecars.
 *
 * Trigger condition: must run before any migration write operation.
 * Debug hint: if WAL mode is enabled, check `.db-wal` and `.db-shm` copy list.
 */
export function backupDatabaseFile(sourcePath: string, backupDir?: string): BackupResult {
  if (!existsSync(sourcePath)) {
    throw new Error(`source database not found: ${sourcePath}`);
  }

  const createdAt = Date.now();
  const targetDir = backupDir ?? "./backups";
  mkdirSync(targetDir, { recursive: true });

  const fileName = basename(sourcePath);
  const backupPath = join(targetDir, `${fileName}.${createdAt}.bak`);

  cpSync(sourcePath, backupPath, { force: false });

  const copiedSidecars: string[] = [];
  for (const suffix of ["-wal", "-shm"]) {
    const sidecarSource = `${sourcePath}${suffix}`;
    if (!existsSync(sidecarSource)) {
      continue;
    }

    const sidecarBackup = `${backupPath}${suffix}`;
    cpSync(sidecarSource, sidecarBackup, { force: true });
    copiedSidecars.push(sidecarBackup);
  }

  return {
    sourcePath,
    backupPath,
    createdAt,
    copiedSidecars,
  };
}
