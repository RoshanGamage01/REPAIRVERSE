#!/bin/bash
# Runs once when the database volume is first created: install PostGIS next to pgvector.
set -e
apt-get update -qq && apt-get install -y -qq postgresql-16-postgis-3 >/dev/null
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;"
