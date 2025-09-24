#!/bin/sh
set -e

# Ensure writable dirs exist (may be bind-mounted over image defaults)
mkdir -p /app/uploads /app/logs /app/database || true

if [ "$(id -u)" = "0" ]; then
  # Fix ownership for mounted volumes; ignore errors on exotic FS
  chown -R node:node /app/uploads /app/logs /app/database 2>/dev/null || true
  exec su-exec node:node "$@"
else
  exec "$@"
fi

