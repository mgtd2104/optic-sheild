#!/bin/bash
# =============================================================================
# IBVAP Backend - Entrypoint Script
# Handles initialization, migrations, and service startup
# =============================================================================

set -e

echo "🚀 Starting IBVAP Backend Container..."

# Wait for database if using PostgreSQL
if [ -n "$DATABASE_URL" ]; then
    echo "⏳ Waiting for PostgreSQL..."
    # Extract host and port from DATABASE_URL
    DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
    DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
    
    if [ -n "$DB_HOST" ] && [ -n "$DB_PORT" ]; then
        until nc -z "$DB_HOST" "$DB_PORT"; do
            echo "Waiting for database at $DB_HOST:$DB_PORT..."
            sleep 2
        done
        echo "✅ Database is ready!"
    fi
fi

# Wait for Redis if configured
if [ -n "$REDIS_URL" ]; then
    echo "⏳ Waiting for Redis..."
    REDIS_HOST=$(echo $REDIS_URL | sed -n 's/.*\/\/\([^:]*\):.*/\1/p')
    REDIS_PORT=$(echo $REDIS_URL | sed -n 's/.*:\([0-9]*\).*/\1/p')
    
    if [ -n "$REDIS_HOST" ] && [ -n "$REDIS_PORT" ]; then
        until nc -z "$REDIS_HOST" "$REDIS_PORT"; do
            echo "Waiting for Redis at $REDIS_HOST:$REDIS_PORT..."
            sleep 2
        done
        echo "✅ Redis is ready!"
    fi
fi

# Run database migrations if alembic is configured
if [ -f "alembic.ini" ]; then
    echo "🔄 Running database migrations..."
    alembic upgrade head
    echo "✅ Migrations complete!"
fi

# Download model weights if not present
if [ ! -f "/app/models/yolov8n.pt" ] && [ ! -f "/app/yolov8n.pt" ]; then
    echo "📥 Downloading YOLOv8n weights..."
    python3 -c "from ultralytics import YOLO; YOLO('yolov8n.pt')" 2>/dev/null || true
fi

if [ ! -f "/app/models/osnet_x0_25_msmt17.pt" ]; then
    echo "📥 Downloading OSNet Re-ID weights..."
    python3 -c "from boxmot.trackers.registry import create_tracker; create_tracker('botsort', 'osnet_x0_25_msmt17.pt', 'cuda:0')" 2>/dev/null || true
fi

# Start Nginx in background for TLS termination (if certs exist)
if [ -f "/etc/ssl/certs/ibvap.crt" ] && [ -f "/etc/ssl/private/ibvap.key" ]; then
    echo "🔒 Starting Nginx for TLS termination..."
    nginx -g "daemon off;" &
    NGINX_PID=$!
    echo "✅ Nginx started (PID: $NGINX_PID)"
else
    echo "⚠️  SSL certificates not found, skipping Nginx TLS termination"
fi

# Start the FastAPI application
echo "🚀 Starting FastAPI application on port 8000..."
exec "$@"