FROM node:18-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy built JS from dist (or build from source)
COPY dist/ ./dist/

# Copy migrations and docs
COPY migrations/ ./migrations/
COPY docs/openapi.yaml ./

# Runtime dependencies only
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/notifications.db

# Create data directory for SQLite
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Run with PM2 for production
CMD ["node", "dist/server.js"]
