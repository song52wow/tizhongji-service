# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --include=dev

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist/ ./dist/

# Copy config files
COPY tsconfig.json ./

# Create data directory for SQLite
RUN mkdir -p /app/data

# Environment defaults (can be overridden at runtime)
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/notifications.db
ENV LOG_LEVEL=info

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Run server
CMD ["node", "dist/server.js"]