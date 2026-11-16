#!/bin/sh
# First start only: the error tracker gets its own database next to ORVYN's.
set -eu
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE DATABASE glitchtip"
