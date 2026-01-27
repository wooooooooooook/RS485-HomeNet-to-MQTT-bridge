# Stage 1: Builder
# node:20-slim (Debian based) is used to avoid QEMU hangs during pnpm install/build on ARM64
FROM node:20-slim AS builder

# Set CI=true to prevent pnpm from requiring a TTY for commands like prune
ENV CI=true

WORKDIR /app

# Install pnpm via corepack
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN corepack enable \
  && npm config set registry "$NPM_REGISTRY" \
  && corepack prepare pnpm@latest --activate

# Copy workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/service/package.json packages/service/
COPY packages/ui/package.json packages/ui/


# Install dependencies
# We use network-concurrency 1 just in case, though slim is more stable than alpine
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --network-concurrency 1

# Copy source code
COPY . .

# Build packages (core, ui, service)
ARG TARGETARCH
ARG TARGETVARIANT
RUN --mount=type=cache,target=/app/.turbo \
    if [ "$TARGETARCH" = "arm" ] && [ "$TARGETVARIANT" = "v7" ]; then \
      pnpm build; \
    else \
      pnpm turbo build --filter=@rs485-homenet/service...; \
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

# Stage 2: Runner
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
