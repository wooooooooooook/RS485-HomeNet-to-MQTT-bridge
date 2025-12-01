# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache jq python3 make g++

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/service/package.json packages/service/
COPY packages/ui/package.json packages/ui/
COPY packages/simulator/package.json packages/simulator/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build packages
RUN pnpm build

# Prune dev dependencies for production
RUN CI=true pnpm install --prod --frozen-lockfile

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Install only runtime dependencies
RUN apk add --no-cache jq

# Install pnpm (needed for running scripts)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy built files and production dependencies from builder
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/service/dist ./packages/service/dist
COPY --from=builder /app/packages/service/static ./packages/service/static
COPY --from=builder /app/packages/service/package.json ./packages/service/
COPY --from=builder /app/packages/core/config ./packages/core/config
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Environment variables will be set by run.sh
ENV NODE_ENV=production

COPY hassio-addon/run.sh /run.sh
RUN chmod +x /run.sh

CMD [ "/run.sh" ]
