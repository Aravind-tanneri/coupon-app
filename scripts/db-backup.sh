#!/usr/bin/env bash
# =============================================================================
# Campus Mess System — Production Database Backup & Retention Script (§25.8)
# =============================================================================
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date +'%Y%m%d_%H%M%S')"
BACKUP_FILE="${BACKUP_DIR}/campus_mess_${TIMESTAMP}.sql.gz"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ Error: DATABASE_URL environment variable is not set." >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

echo "📦 [$(date)] Backing up database to ${BACKUP_FILE}..."
pg_dump "${DATABASE_URL}" --format=plain --no-owner --no-privileges | gzip -9 > "${BACKUP_FILE}"

FILE_SIZE="$(du -h "${BACKUP_FILE}" | cut -f1)"
echo "✅ [$(date)] Backup completed successfully (${FILE_SIZE})."

# Retention: Delete snapshots older than RETENTION_DAYS
echo "🧹 Cleaning up backups older than ${RETENTION_DAYS} days in ${BACKUP_DIR}..."
find "${BACKUP_DIR}" -type f -name "campus_mess_*.sql.gz" -mtime +"${RETENTION_DAYS}" -exec rm -f {} +

echo "🎉 Database backup and retention cycle complete."

