#!/bin/bash
# Database migration runner
# Usage: npx ts-node scripts/migrate.ts [up|down|status]

set -e

DB_PATH="${DB_PATH:-./notifications.db}"
MIGRATIONS_DIR="$(dirname "$0")/../migrations"

# Ensure migrations directory exists
mkdir -p "$MIGRATIONS_DIR"

run_migration() {
  local migration_file="$1"
  local direction="$2"
  local migration_name=$(basename "$migration_file" .sql)

  echo "[$direction] $migration_name"

  if [ "$direction" = "up" ]; then
    # Extract UP block and execute
    awk '/-- UP BEGIN/,/-- UP END/' "$migration_file" | grep -v '-- UP BEGIN' | grep -v '-- UP END' | grep -v '^--' | grep -v '^$' | sqlite3 "$DB_PATH"
  else
    # Extract DOWN block and execute
    awk '/-- DOWN BEGIN/,/-- DOWN END/' "$migration_file" | grep -v '-- DOWN BEGIN' | grep -v '-- DOWN END' | grep -v '^--' | grep -v '^$' | sqlite3 "$DB_PATH"
  fi

  # Update migrations tracking table
  if [ "$direction" = "up" ]; then
    sqlite3 "$DB_PATH" "INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES ('$migration_name', datetime('now'));"
  else
    sqlite3 "$DB_PATH" "DELETE FROM schema_migrations WHERE name = '$migration_name';"
  fi

  echo "[$direction] $migration_name - done"
}

create_migration_table() {
  sqlite3 "$DB_PATH" "CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );"
}

get_applied_migrations() {
  sqlite3 "$DB_PATH" "SELECT name FROM schema_migrations ORDER BY applied_at ASC;" 2>/dev/null || echo ""
}

get_pending_migrations() {
  local applied="$1"
  local pending=""

  for f in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
    local name=$(basename "$f" .sql)
    if echo "$applied" | grep -q "^${name}$"; then
      continue
    fi
    pending="$pending $f"
  done

  echo "$pending" | tr ' ' '\n' | grep -v '^$'
}

show_status() {
  local applied="$1"

  echo "=== Migration Status ==="
  echo ""

  echo "Applied migrations:"
  if [ -z "$applied" ]; then
    echo "  (none)"
  else
    for m in $applied; do
      echo "  ✓ $m"
    done
  fi
  echo ""

  local pending=$(get_pending_migrations "$applied")
  echo "Pending migrations:"
  if [ -z "$pending" ]; then
    echo "  (none)"
  else
    for f in $pending; do
      echo "  ✗ $(basename "$f" .sql)"
    done
  fi
  echo ""
}

# ---------- Main ----------

COMMAND="${1:-status}"

create_migration_table

if [ "$COMMAND" = "up" ]; then
  echo "Running all pending migrations..."
  applied=$(get_applied_migrations)

  pending=$(get_pending_migrations "$applied")
  if [ -z "$pending" ]; then
    echo "No pending migrations. Database is up to date."
    exit 0
  fi

  for f in $pending; do
    run_migration "$f" "up"
  done

elif [ "$COMMAND" = "down" ]; then
  echo "Rolling back last migration..."
  applied=$(get_applied_migrations)
  if [ -z "$applied" ]; then
    echo "No migrations to roll back."
    exit 0
  fi

  # Roll back the most recent migration
  latest=$(echo "$applied" | tr ' ' '\n' | tail -1)
  migration_file=$(ls "$MIGRATIONS_DIR"/${latest}.sql 2>/dev/null)

  if [ -z "$migration_file" ]; then
    echo "Migration file not found for: $latest"
    exit 1
  fi

  run_migration "$migration_file" "down"

elif [ "$COMMAND" = "status" ]; then
  applied=$(get_applied_migrations)
  show_status "$applied"

elif [ "$COMMAND" = "create" ]; then
  NAME="${2:-migration_$(date +%Y%m%d_%H%M%S)}"
  cat > "$MIGRATIONS_DIR/${NAME}.sql" << 'EOF'
-- UP BEGIN
-- Write your UP migration SQL here
-- UP END

-- DOWN BEGIN
-- Write your DOWN migration SQL here (rollback)
-- DOWN END
EOF
  echo "Created: $MIGRATIONS_DIR/${NAME}.sql"

else
  echo "Usage: $0 [up|down|status|create <name>]"
  exit 1
fi
