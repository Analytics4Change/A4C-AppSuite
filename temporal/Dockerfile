# Temporal Worker Dockerfile
# Builds container image for A4C Temporal workers

FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --production

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Set environment variables (can be overridden)
ENV NODE_ENV=production
ENV TEMPORAL_ADDRESS=temporal-frontend.temporal.svc.cluster.local:7233
ENV TEMPORAL_NAMESPACE=default
ENV TEMPORAL_TASK_QUEUE=bootstrap

# Health check (optional, adjust as needed)
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "console.log('healthy')" || exit 1

# Run worker
CMD ["node", "dist/workers/index.js"]
