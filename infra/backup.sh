#!/bin/sh
# Daily logical backup of the REPAIRVERSE database with retention.
# Restore: pg_restore -h db -U postgres -d repairverse --clean --if-exists /backups/<file>.dump
set -eu
TS=$(date -u +%Y%m%dT%H%M%SZ)
FILE="/backups/repairverse-$TS.dump"
pg_dump -h "${PGHOST:-db}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-repairverse}" -Fc -f "$FILE.partial"
mv "$FILE.partial" "$FILE"
# Retention: prune dumps older than RETENTION_DAYS.
find /backups -name 'repairverse-*.dump' -mtime +"${RETENTION_DAYS:-14}" -exec unlink {} \;
echo "backup written: $FILE"
