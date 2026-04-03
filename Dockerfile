FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# ─── Production stage ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Install runtime dependencies for TEE attestation tooling
RUN apk add --no-cache \
    tpm2-tools \
    openssl \
    ca-certificates \
    curl

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Create non-root user
RUN addgroup -S enclave && adduser -S enclave -G enclave
USER enclave

# Expose Chroma port (if running embedded)
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/api/v1/heartbeat || exit 1

CMD ["node", "dist/main.js"]


