#!/usr/bin/env bash
set -euo pipefail
: "${MONGODB_URI:?Falta MONGODB_URI}"
BACKUP_ROOT="${BACKUP_DIR:-/var/backups/pinos}"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
TARGET="$BACKUP_ROOT/$STAMP"
mkdir -p "$TARGET"
mongodump --uri="$MONGODB_URI" --archive="$TARGET/mongodb.archive.gz" --gzip
if [ -d "${UPLOAD_DIR:-/var/lib/pinos/uploads}" ]; then
  tar -czf "$TARGET/uploads.tar.gz" -C "${UPLOAD_DIR:-/var/lib/pinos}" uploads
fi
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf -- {} +
echo "Backup creado en $TARGET"
