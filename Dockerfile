# Multi-stage lightweight production Dockerfile
FROM python:3.12-slim AS builder

WORKDIR /build

# Install build dependencies and libgomp for LightGBM OpenMP support
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Final runtime image
FROM python:3.12-slim

WORKDIR /app

# Install runtime OpenMP shared library required by LightGBM
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home appuser

# Copy installed wheels from builder
COPY --from=builder /root/.local /home/appuser/.local
ENV PATH=/home/appuser/.local/bin:$PATH

# Copy application code and model artifacts
COPY --chown=appuser:appuser . .

USER appuser

# Environment configuration
ENV HOST=0.0.0.0
ENV PORT=5002
ENV PYTHONUNBUFFERED=1

EXPOSE 5002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5002/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5002"]
