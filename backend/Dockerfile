# =============================================================================
# IBVAP Backend - Production Dockerfile
# Uses NVIDIA CUDA 12.1 runtime on Ubuntu 22.04 with Python 3.11
# =============================================================================

# ---- Build Stage ------------------------------------------------------------
FROM nvidia/cuda:12.1-runtime-ubuntu22.04 AS builder

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3.11-dev \
    build-essential \
    cmake \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1-mesa-glx \
    libgomp1 \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python3.11 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Upgrade pip and install build dependencies
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Copy requirements first for better caching
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
    --extra-index-url https://download.pytorch.org/whl/cu121

# ---- Runtime Stage ----------------------------------------------------------
FROM nvidia/cuda:12.1-runtime-ubuntu22.04 AS runtime

# Install runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1-mesa-glx \
    libgomp1 \
    nginx \
    curl \
    netcat-openbsd \
    ca-certificates \
    authbind \
    && rm -rf /var/lib/apt/lists/*

# Configure authbind for nginx to bind to ports 80/443 as non-root
RUN echo "0.0.0.0/0,80" > /etc/authbind/byport/80 && \
    echo "0.0.0.0/0,443" > /etc/authbind/byport/443 && \
    chmod 755 /etc/authbind/byport/80 /etc/authbind/byport/443

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

# Set working directory
WORKDIR /app

# Copy application code
COPY --chown=appuser:appuser . /app

# Create directories for models, logs, and temp files
RUN mkdir -p /app/models /app/logs /app/temp /app/uploads && \
    chown -R appuser:appuser /app

# Copy Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy entrypoint script
COPY --chown=appuser:appuser entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Switch to non-root user
USER appuser

# Expose ports (nginx will bind via authbind)
EXPOSE 8000 80 443

# Health check - curl is installed in runtime stage
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    CUDA_VISIBLE_DEVICES=0 \
    PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:512

ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]