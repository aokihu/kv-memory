#!/usr/bin/env bash
set -euo pipefail

# Migration rehearsal script.
#
# This script never writes to the original source DB file.
# It performs:
# 1) copy source DB to rehearsal workspace
# 2) dry-run migration on copied source
# 3) simulated migration to copied target

SOURCE_DB="${1:-}"
WORKDIR="${2:-}"

if [[ -z "${SOURCE_DB}" ]]; then
  echo "Usage: bash scripts/migration-dry-run.sh <source-db-path> [workdir]"
  exit 1
fi

if [[ ! -f "${SOURCE_DB}" ]]; then
  echo "[error] source database not found: ${SOURCE_DB}"
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
if [[ -z "${WORKDIR}" ]]; then
  WORKDIR="./.migration-rehearsal-${TIMESTAMP}"
fi

mkdir -p "${WORKDIR}"

SOURCE_COPY="${WORKDIR}/source-copy.db"
TARGET_COPY="${WORKDIR}/target-copy.db"
BACKUP_DIR="${WORKDIR}/backups"

cp "${SOURCE_DB}" "${SOURCE_COPY}"
if [[ -f "${SOURCE_DB}-wal" ]]; then cp "${SOURCE_DB}-wal" "${SOURCE_COPY}-wal"; fi
if [[ -f "${SOURCE_DB}-shm" ]]; then cp "${SOURCE_DB}-shm" "${SOURCE_COPY}-shm"; fi

echo "[info] rehearsal workspace: ${WORKDIR}"
echo "[info] running dry-run migration on copied source"
bun run src/libs/db/migrate.ts --source "${SOURCE_COPY}" --backup-dir "${BACKUP_DIR}" --dry-run

echo "[info] running simulated migration to copied target"
bun run src/libs/db/migrate.ts --source "${SOURCE_COPY}" --target "${TARGET_COPY}" --backup-dir "${BACKUP_DIR}"

echo "[info] rehearsal completed successfully"
echo "[info] source copy: ${SOURCE_COPY}"
echo "[info] target copy: ${TARGET_COPY}"
echo "[info] backup dir : ${BACKUP_DIR}"
