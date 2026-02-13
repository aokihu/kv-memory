#!/usr/bin/env bash
set -Eeuo pipefail

# Memory decay deployment script.
#
# Responsibilities:
# 1) pre-deploy validation and environment setup
# 2) database backup + migration (score column/index + data initialization)
# 3) service startup monitoring and health verification
# 4) rollback and recovery when deployment fails

DEPLOY_ENV="${DEPLOY_ENV:-dev}"
DB_PATH="${DB_PATH:-./kv.db}"
BACKUP_DIR="${BACKUP_DIR:-./scripts/.deploy-backups}"
START_COMMAND="${START_COMMAND:-}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
HEALTHCHECK_TIMEOUT_SEC="${HEALTHCHECK_TIMEOUT_SEC:-60}"
HEALTHCHECK_INTERVAL_SEC="${HEALTHCHECK_INTERVAL_SEC:-2}"
DEPLOY_LOG_FILE="${DEPLOY_LOG_FILE:-./scripts/deploy-memory-decay.log}"
ROLLBACK_ONLY="false"

STARTED_SERVICE="false"
SERVICE_PID=""
BACKUP_PREFIX=""
LATEST_BACKUP_POINTER=""

usage() {
  cat <<'EOF'
Usage:
  bash scripts/deploy-memory-decay.sh [options]

Options:
  --env <dev|test|prod>         Deployment environment
  --db-path <path>              SQLite database path
  --start-command <command>     Service start command
  --health-url <url>            Health probe URL
  --rollback-only               Restore latest backup without deploying
  --help                        Show this help message

Environment variables:
  DEPLOY_ENV, DB_PATH, BACKUP_DIR, START_COMMAND, HEALTHCHECK_URL,
  HEALTHCHECK_TIMEOUT_SEC, HEALTHCHECK_INTERVAL_SEC, DEPLOY_LOG_FILE
EOF
}

log() {
  local level="$1"
  shift
  local now
  now="$(date '+%Y-%m-%d %H:%M:%S')"
  printf '%s [%s] %s\n' "${now}" "${level}" "$*" | tee -a "${DEPLOY_LOG_FILE}"
}

log_info() { log "INFO" "$@"; }
log_warn() { log "WARN" "$@"; }
log_error() { log "ERROR" "$@"; }

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    log_error "Required command not found: ${cmd}"
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env)
        DEPLOY_ENV="$2"
        shift 2
        ;;
      --db-path)
        DB_PATH="$2"
        shift 2
        ;;
      --start-command)
        START_COMMAND="$2"
        shift 2
        ;;
      --health-url)
        HEALTHCHECK_URL="$2"
        shift 2
        ;;
      --rollback-only)
        ROLLBACK_ONLY="true"
        shift
        ;;
      --help)
        usage
        exit 0
        ;;
      *)
        log_error "Unknown argument: $1"
        usage
        exit 1
        ;;
    esac
  done
}

apply_env_defaults() {
  local port
  case "${DEPLOY_ENV}" in
    dev)
      port="3000"
      ;;
    test)
      port="3100"
      ;;
    prod)
      port="3000"
      ;;
    *)
      log_error "Invalid DEPLOY_ENV: ${DEPLOY_ENV}. expected dev|test|prod"
      exit 1
      ;;
  esac

  # Default values are environment-aware and can still be overridden by args/env.
  if [[ -z "${START_COMMAND}" ]]; then
    START_COMMAND="bun run ./src/index.ts"
  fi

  if [[ -z "${HEALTHCHECK_URL}" ]]; then
    HEALTHCHECK_URL="http://127.0.0.1:${port}/login"
  fi

  LATEST_BACKUP_POINTER="${BACKUP_DIR}/latest-${DEPLOY_ENV}.txt"
}

pre_deploy_validate() {
  log_info "Running pre-deploy validation"

  require_command bun
  require_command curl

  if [[ "${HEALTHCHECK_TIMEOUT_SEC}" -le 0 || "${HEALTHCHECK_INTERVAL_SEC}" -le 0 ]]; then
    log_error "HEALTHCHECK_TIMEOUT_SEC and HEALTHCHECK_INTERVAL_SEC must be positive integers"
    exit 1
  fi

  mkdir -p "${BACKUP_DIR}" "$(dirname "${DEPLOY_LOG_FILE}")"

  # Ensure database directory exists before migration/backup operations.
  mkdir -p "$(dirname "${DB_PATH}")"
  if [[ ! -f "${DB_PATH}" ]]; then
    log_warn "Database file not found, creating empty file: ${DB_PATH}"
    : > "${DB_PATH}"
  fi

  if ! bun --eval 'import { Database } from "bun:sqlite"; const db = new Database(process.env.DB_PATH, { create: true }); db.exec("SELECT 1"); db.close();' >/dev/null 2>&1; then
    log_error "Database validation failed: cannot open ${DB_PATH}"
    exit 1
  fi

  log_info "Pre-deploy validation passed"
}

create_backup() {
  local ts
  ts="$(date +%Y%m%d-%H%M%S)"
  BACKUP_PREFIX="${BACKUP_DIR}/kv-${DEPLOY_ENV}-${ts}"

  cp "${DB_PATH}" "${BACKUP_PREFIX}.db"
  [[ -f "${DB_PATH}-wal" ]] && cp "${DB_PATH}-wal" "${BACKUP_PREFIX}.db-wal"
  [[ -f "${DB_PATH}-shm" ]] && cp "${DB_PATH}-shm" "${BACKUP_PREFIX}.db-shm"

  printf '%s\n' "${BACKUP_PREFIX}" > "${LATEST_BACKUP_POINTER}"
  log_info "Backup created: ${BACKUP_PREFIX}.db"
}

run_migration() {
  log_info "Running database migration for score column/index"

  DB_PATH="${DB_PATH}" bun --eval '
    import { Database } from "bun:sqlite";

    const dbPath = process.env.DB_PATH;
    if (!dbPath) throw new Error("DB_PATH is required");
    const db = new Database(dbPath, { create: true });

    try {
      const table = db
        .query("SELECT name FROM sqlite_master WHERE type = ? AND name = ?")
        .get("table", "memories");
      if (!table) {
        throw new Error("memories table is missing");
      }

      const columns = db.query("PRAGMA table_info(memories)").all();
      const hasScore = columns.some((column) => column.name === "score");
      if (!hasScore) {
        db.exec("ALTER TABLE memories ADD COLUMN score INTEGER DEFAULT 50 CHECK (score >= 0 AND score <= 100)");
        console.log("[migration] added score column");
      } else {
        console.log("[migration] score column already exists");
      }

      db.exec("CREATE INDEX IF NOT EXISTS idx_memories_score ON memories(score)");
      console.log("[migration] ensured idx_memories_score index");

      const result = db.query("UPDATE memories SET score = 50 WHERE score IS NULL").run();
      console.log(`[migration] initialized score=50 rows=${result.changes}`);
    } finally {
      db.close();
    }
  ' | tee -a "${DEPLOY_LOG_FILE}"

  log_info "Database migration completed"
}

is_healthy() {
  curl -fsS "${HEALTHCHECK_URL}" >/dev/null 2>&1
}

wait_for_health() {
  local elapsed=0
  local timeout="${HEALTHCHECK_TIMEOUT_SEC}"

  while [[ "${elapsed}" -lt "${timeout}" ]]; do
    if is_healthy; then
      log_info "Health check passed: ${HEALTHCHECK_URL}"
      return 0
    fi

    # Debug focus: if health never becomes ready, inspect app log and startup command first.
    if [[ -n "${SERVICE_PID}" ]] && ! kill -0 "${SERVICE_PID}" >/dev/null 2>&1; then
      log_error "Service process exited before health check passed (pid=${SERVICE_PID})"
      return 1
    fi

    sleep "${HEALTHCHECK_INTERVAL_SEC}"
    elapsed=$((elapsed + HEALTHCHECK_INTERVAL_SEC))
  done

  log_error "Health check timeout after ${timeout}s: ${HEALTHCHECK_URL}"
  return 1
}

start_and_monitor_service() {
  if is_healthy; then
    log_info "Service already healthy, skip starting new process"
    return 0
  fi

  log_info "Starting service with command: ${START_COMMAND}"
  bash -lc "${START_COMMAND}" >> "${DEPLOY_LOG_FILE}" 2>&1 &
  SERVICE_PID="$!"
  STARTED_SERVICE="true"
  log_info "Service started (pid=${SERVICE_PID})"

  wait_for_health
}

stop_started_service() {
  if [[ "${STARTED_SERVICE}" != "true" || -z "${SERVICE_PID}" ]]; then
    return 0
  fi

  if kill -0 "${SERVICE_PID}" >/dev/null 2>&1; then
    log_warn "Stopping started service process (pid=${SERVICE_PID})"
    kill "${SERVICE_PID}" >/dev/null 2>&1 || true
  fi
}

rollback_from_latest() {
  local backup_prefix

  if [[ ! -f "${LATEST_BACKUP_POINTER}" ]]; then
    log_error "Rollback failed: latest backup pointer not found: ${LATEST_BACKUP_POINTER}"
    return 1
  fi

  backup_prefix="$(cat "${LATEST_BACKUP_POINTER}")"
  if [[ -z "${backup_prefix}" || ! -f "${backup_prefix}.db" ]]; then
    log_error "Rollback failed: invalid backup record: ${backup_prefix}"
    return 1
  fi

  log_warn "Restoring database from backup: ${backup_prefix}.db"
  cp "${backup_prefix}.db" "${DB_PATH}"

  if [[ -f "${backup_prefix}.db-wal" ]]; then
    cp "${backup_prefix}.db-wal" "${DB_PATH}-wal"
  else
    rm -f "${DB_PATH}-wal"
  fi

  if [[ -f "${backup_prefix}.db-shm" ]]; then
    cp "${backup_prefix}.db-shm" "${DB_PATH}-shm"
  else
    rm -f "${DB_PATH}-shm"
  fi

  log_info "Rollback completed"
}

handle_failure() {
  local exit_code="$1"
  local line_no="$2"

  log_error "Deployment failed at line ${line_no} (exit=${exit_code})"
  stop_started_service

  # Rollback is safe to retry because it always restores from immutable backup snapshot.
  if ! rollback_from_latest; then
    log_error "Automatic rollback failed, manual recovery is required"
  fi

  exit "${exit_code}"
}

main() {
  parse_args "$@"
  apply_env_defaults
  pre_deploy_validate

  if [[ "${ROLLBACK_ONLY}" == "true" ]]; then
    log_warn "Rollback-only mode enabled"
    rollback_from_latest
    log_info "Rollback-only workflow completed"
    return 0
  fi

  create_backup
  run_migration
  start_and_monitor_service

  log_info "Deployment completed successfully"
}

trap 'handle_failure "$?" "$LINENO"' ERR
main "$@"
