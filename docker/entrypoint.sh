#!/bin/sh
set -eu

image_provider=$(cat /app/.image-db-provider)
runtime_provider=${DATABASE_PROVIDER:-postgresql}
if [ "$runtime_provider" != "$image_provider" ]; then
  echo "Image was built for $image_provider; DATABASE_PROVIDER=$runtime_provider requires a matching image." >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo 'DATABASE_URL is required at runtime.' >&2
  exit 1
fi

case "$runtime_provider:$DATABASE_URL" in
  sqlite:file:/*)
    node /app/scripts/sqlite-init.mjs
    ;;
  postgresql:postgresql://*|postgresql:postgres://*)
    # PostgreSQL migrations are a reviewed deployment step, never run on boot.
    ;;
  *)
    echo "DATABASE_URL scheme does not match the $runtime_provider image (SQLite requires an absolute file: URL)." >&2
    exit 1
    ;;
esac

exec "$@"
