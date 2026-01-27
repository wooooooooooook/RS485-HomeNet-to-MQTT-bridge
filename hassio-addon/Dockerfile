# Stage 1: Common Builder (Host Architecture)
# Builds UI and Service packages which are architecture independent
FROM --platform=$BUILDPLATFORM node:20-slim AS common-builder

ENV CI=true
WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org
RUN corepack enable \
  && npm config set registry "$NPM_REGISTRY" \
  && corepack prepare pnpm@latest --activate

# Copy workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/service/package.json packages/service/
COPY packages/ui/package.json packages/ui/

# Install dependencies (host arch)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --network-concurrency 1

# Copy source code
COPY . .

# Build everything (fast on host)
# core is built here too to provide types for service, but will be rebuilt in target stage
RUN --mount=type=cache,target=/app/.turbo \
    pnpm turbo build --filter=@rs485-homenet/service...


# Stage 2: Builder (Target Architecture)
# Rebuilds Core with native dependencies for the target architecture
FROM node:20-slim AS builder

ENV CI=true
WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org
RUN corepack enable \
  && npm config set registry "$NPM_REGISTRY" \
  && corepack prepare pnpm@latest --activate

# Copy workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/service/package.json packages/service/
COPY packages/ui/package.json packages/ui/

# Install dependencies (target arch)
# This compiles native modules like serialport for the target
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --network-concurrency 1

# Copy source code
COPY . .

# Copy pre-built artifacts from common-builder
COPY --from=common-builder /app/packages/ui/dist ./packages/ui/dist
COPY --from=common-builder /app/packages/service/dist ./packages/service/dist
COPY --from=common-builder /app/packages/service/static ./packages/service/static

# Build Core for Target Architecture
ARG TARGETARCH
ARG TARGETVARIANT
# Use non-turbo build for arm v7 to save resources
RUN if [ "$TARGETARCH" = "arm" ] && [ "$TARGETVARIANT" = "v7" ]; then \
      pnpm --filter @rs485-homenet/core build:simple; \
    else \
      pnpm --filter @rs485-homenet/core build; \
    fi

# Clean up source code and build artifacts not needed for runtime
# 1. packages/ui: Already built and copied to service/static
# 2. */src, */test, */tsconfig*.json: Code is compiled to dist
RUN rm -rf packages/ui \
  packages/*/src \
  packages/*/test \
  packages/*/tsconfig*.json \
  packages/*/*.md \
  scripts

# Remove development dependencies to reduce size of node_modules
# We use 'install --prod' instead of 'prune --prod' because the latter can incorrectly remove workspace dependencies
RUN pnpm install --prod --frozen-lockfile

# Final cleanup of node_modules to remove unnecessary files
# Removes: maps, TS sources, docs, licenses, C/C++ sources/headers (after build), and build artifacts
RUN find node_modules -type f \( \
  -name "*.map" -o \
  -name "*.ts" -o \
  -name "*.md" -o \
  -name "LICENSE" -o \
  -name "README.md" -o \
  -name "*.txt" -o \
  -name "*.log" -o \
  -name "*.tlog" -o \
  -name "*.obj" -o \
  -name "*.c" -o \
  -name "*.h" -o \
  -name "*.cpp" -o \
  -name "*.html" -o \
  -name "*.yml" -o \
  -name "*.yaml" \
  \) -delete

# Stage 3: Runner
# node:20-alpine is used for a smaller runtime image
FROM node:20-alpine AS runner

WORKDIR /app

# Install runtime dependencies
# bash: for run.sh script
# jq: for parsing options.json
# gcompat: provides glibc compatibility for native modules (like serialport) built in the debian stage
RUN apk add --no-cache bash jq gcompat

# Copy application from builder
# This copies everything including node_modules and built dist folders
COPY --from=builder /app /app

# Environment setup
ENV NODE_ENV=production

# Inject Log Collector API Key
ARG LOG_COLLECTOR_API_KEY
ENV LOG_COLLECTOR_API_KEY=$LOG_COLLECTOR_API_KEY

# Setup run script
COPY hassio-addon/run.sh /run.sh
RUN chmod +x /run.sh

CMD [ "/run.sh" ]
