#!/usr/bin/env bash
set -euo pipefail
: "${MONGODB_URI:?Falta MONGODB_URI}"
TARGET="${1:?Uso: restore.sh /ruta/al/backup}"
test -f "$TARGET/mongodb.archive.gz"
mongorestore --uri="$MONGODB_URI" --archive="$TARGET/mongodb.archive.gz" --gzip --drop
if [ -f "$TARGET/uploads.tar.gz" ]; then
  mkdir -p "${UPLOAD_DIR:-/var/lib/pinos}"
  tar -xzf "$TARGET/uploads.tar.gz" -C "${UPLOAD_DIR:-/var/lib/pinos}"
fi
echo "Restauración completa desde $TARGET"
