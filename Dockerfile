# Sim2Real Production Dockerfile
# Multi-stage build for minimal attack surface

# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production --ignore-scripts

# Copy application source
COPY server.js ./
COPY *.html ./
COPY css/ ./css/
COPY js/ ./js/
COPY assets/ ./assets/

# ── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Security: Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy built artifacts from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server.js ./
COPY --from=builder /app/*.html ./
COPY --from=builder /app/css/ ./css/
COPY --from=builder /app/js/ ./js/
COPY --from=builder /app/assets/ ./assets/
COPY --from=builder /app/package.json ./

# Set ownership to non-root user
RUN chown -R nodejs:nodejs /app

USER nodejs

# Expose port (Railway overrides this)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the application
CMD ["node", "server.js"]
