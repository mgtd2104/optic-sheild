#!/bin/bash
# =============================================================================
# IBVAP Backend - Entrypoint Script
# Handles initialization, migrations, and service startup
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# Signal handling for graceful shutdown
NGINX_PID=""
UVICORN_PID=""

cleanup() {
    log_info "Shutting down gracefully..."
    if [ -n "$UVICORN_PID" ] && kill -0 "$UVICORN_PID" 2>/dev/null; then
        kill -TERM "$UVICORN_PID"
        wait "$UVICORN_PID" 2>/dev/null || true
    fi
    if [ -n "$NGINX_PID" ] && kill -0 "$NGINX_PID" 2>/dev/null; then
        kill -TERM "$NGINX_PID"
        wait "$NGINX_PID" 2>/dev/null || true
    fi
    exit 0
}

trap cleanup SIGTERM SIGINT

log_info "🚀 Starting IBVAP Backend Container..."

# Wait for database if using PostgreSQL
if [ -n "$DATABASE_URL" ]; then
    log_info "⏳ Waiting for PostgreSQL..."
    
    # Robust DATABASE_URL parsing using Python
    DB_INFO=$(python3 -c "
import os, urllib.parse
url = os.environ.get('DATABASE_URL', '')
try:
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or ''
    port = parsed.port or (5432 if parsed.scheme == 'postgresql' else 3306)
    print(f'{host} {port}')
except Exception as e:
    print(f'ERROR: {e}')
    exit(1)
")
    
    if [[ $DB_INFO == ERROR* ]]; then
        log_warn "Failed to parse DATABASE_URL, skipping database wait"
    else
        DB_HOST=$(echo "$DB_INFO" | awk '{print $1}')
        DB_PORT=$(echo "$DB_INFO" | awk '{print $2}')
        
        if [ -n "$DB_HOST" ] && [ -n "$DB_PORT" ]; then
            until nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; do
                log_info "Waiting for database at $DB_HOST:$DB_PORT..."
                sleep 2
            done
            log_info "✅ Database is ready!"
        fi
    fi
fi

# Wait for Redis if configured
if [ -n "$REDIS_URL" ]; then
    log_info "⏳ Waiting for Redis..."
    
    REDIS_INFO=$(python3 -c "
import os, urllib.parse
url = os.environ.get('REDIS_URL', '')
try:
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or ''
    port = parsed.port or 6379
    print(f'{host} {port}')
except Exception as e:
    print(f'ERROR: {e}')
    exit(1)
")
    
    if [[ $REDIS_INFO == ERROR* ]]; then
        log_warn "Failed to parse REDIS_URL, skipping Redis wait"
    else
        REDIS_HOST=$(echo "$REDIS_INFO" | awk '{print $1}')
        REDIS_PORT=$(echo "$REDIS_INFO" | awk '{print $2}')
        
        if [ -n "$REDIS_HOST" ] && [ -n "$REDIS_PORT" ]; then
            until nc -z "$REDIS_HOST" "$REDIS_PORT" 2>/dev/null; do
                log_info "Waiting for Redis at $REDIS_HOST:$REDIS_PORT..."
                sleep 2
            done
            log_info "✅ Redis is ready!"
        fi
    fi
fi

# Run database migrations if alembic is configured
if [ -f "alembic.ini" ]; then
    log_info "🔄 Running database migrations..."
    alembic upgrade head
    log_info "✅ Migrations complete!"
fi

# Model download with checksum verification
MODEL_DIR="/app/models"
mkdir -p "$MODEL_DIR"

# Expected SHA256 checksums (update when models are updated)
# These are placeholder - replace with actual checksums from official sources
declare -A MODEL_CHECKSUMS=(
    ["yolov8n.pt"]="a1b2c3d4e5f6..."  # Replace with actual SHA256
    ["osnet_x0_25_msmt17.pt"]="f6e5d4c3b2a1..."  # Replace with actual SHA256
)

verify_checksum() {
    local file="$1"
    local expected="$2"
    if [ "$expected" = "a1b2c3d4e5f6..." ] || [ "$expected" = "f6e5d4c3b2a1..." ]; then
        log_warn "Checksum not configured for $file, skipping verification"
        return 0
    fi
    local actual=$(sha256sum "$file" | awk '{print $1}')
    if [ "$actual" = "$expected" ]; then
        return 0
    else
        log_error "Checksum mismatch for $file: expected $expected, got $actual"
        return 1
    fi
}

download_model() {
    local model_name="$1"
    local model_path="$MODEL_DIR/$model_name"
    local expected_checksum="${MODEL_CHECKSUMS[$model_name]}"
    
    if [ -f "$model_path" ]; then
        if verify_checksum "$model_path" "$expected_checksum"; then
            log_info "✅ $model_name already present and verified"
            return 0
        else
            log_warn "Existing $model_name failed verification, re-downloading"
            rm -f "$model_path"
        fi
    fi
    
    log_info "📥 Downloading $model_name..."
    case "$model_name" in
        "yolov8n.pt")
            python3 -c "from ultralytics import YOLO; YOLO('$model_name')" 2>&1 | tail -5
            # Move from current dir to models dir if needed
            if [ -f "$model_name" ] && [ ! -f "$model_path" ]; then
                mv "$model_name" "$model_path"
            fi
            ;;
        "osnet_x0_25_msmt17.pt")
            python3 -c "from boxmot.trackers.registry import create_tracker; create_tracker('botsort', '$model_name', 'cuda:0')" 2>&1 | tail -5
            if [ -f "$model_name" ] && [ ! -f "$model_path" ]; then
                mv "$model_name" "$model_path"
            fi
            ;;
        *)
            log_error "Unknown model: $model_name"
            return 1
            ;;
    esac
    
    if [ -f "$model_path" ]; then
        if verify_checksum "$model_path" "$expected_checksum"; then
            log_info "✅ $model_name downloaded and verified"
        else
            log_error "❌ $model_name download verification failed"
            rm -f "$model_path"
            return 1
        fi
    else
        log_error "❌ $model_name download failed"
        return 1
    fi
}

# Download required models
download_model "yolov8n.pt" || log_warn "YOLO model download failed, will attempt auto-download at runtime"
download_model "osnet_x0_25_msmt17.pt" || log_warn "Re-ID model download failed, will attempt auto-download at runtime"

# Start Nginx in background for TLS termination (if certs exist)
if [ -f "/etc/ssl/certs/ibvap.crt" ] && [ -f "/etc/ssl/private/ibvap.key" ]; then
    log_info "🔒 Starting Nginx for TLS termination..."
    
    # Use authbind to allow non-root binding to ports 80/443
    authbind --deep nginx -g "daemon off;" &
    NGINX_PID=$!
    
    # Verify nginx started
    sleep 2
    if kill -0 "$NGINX_PID" 2>/dev/null; then
        log_info "✅ Nginx started (PID: $NGINX_PID)"
    else
        log_error "❌ Nginx failed to start"
        NGINX_PID=""
    fi
else
    log_warn "⚠️  SSL certificates not found, skipping Nginx TLS termination"
fi

# Start the FastAPI application
log_info "🚀 Starting FastAPI application on port 8000..."
exec "$@" &
UVICORN_PID=$!

# Wait for uvicorn
wait $UVICORN_PID