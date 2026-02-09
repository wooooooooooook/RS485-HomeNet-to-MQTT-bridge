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
# Use turbo build as requested (dev addon does not support armv7)
RUN pnpm turbo build --filter=@rs485-homenet/core

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

# s6-overlay environment variables
ENV \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_CMD_WAIT_FOR_SERVICES=1

WORKDIR /app

# Install runtime dependencies
# bash: for run.sh script
# jq: for parsing options.json
# gcompat: provides glibc compatibility for native modules (like serialport) built in the debian stage
# curl, xz: for downloading and extracting s6-overlay and bashio
RUN apk add --no-cache bash jq gcompat curl xz

# Install s6-overlay and bashio
ARG BUILD_ARCH=amd64
ARG S6_OVERLAY_VERSION="3.2.2.0"
ARG BASHIO_VERSION="v0.17.5"
RUN set -o pipefail \
    # Determine s6 architecture
    && S6_ARCH="${BUILD_ARCH}" \
    && if [ "${BUILD_ARCH}" = "amd64" ]; then S6_ARCH="x86_64"; fi \
    && if [ "${BUILD_ARCH}" = "aarch64" ]; then S6_ARCH="aarch64"; fi \
    # Download and install s6-overlay
    && curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" \
        | tar -C / -Jxpf - \
    && curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" \
        | tar -C / -Jxpf - \
    && curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-symlinks-noarch.tar.xz" \
        | tar -C / -Jxpf - \
    && curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-symlinks-arch.tar.xz" \
        | tar -C / -Jxpf - \
    # Download and install bashio
    && curl -J -L -o /tmp/bashio.tar.gz \
        "https://github.com/hassio-addons/bashio/archive/${BASHIO_VERSION}.tar.gz" \
    && mkdir -p /tmp/bashio \
    && tar zxvf /tmp/bashio.tar.gz --strip 1 -C /tmp/bashio \
    && mv /tmp/bashio/lib /usr/lib/bashio \
    && ln -s /usr/lib/bashio/bashio /usr/bin/bashio \
    && rm -rf /tmp/*

# Copy application from builder
# This copies everything including node_modules and built dist folders
COPY --from=builder /app /app

# Environment setup
ENV NODE_ENV=production

# Inject Log Collector API Key
ARG LOG_COLLECTOR_API_KEY
ENV LOG_COLLECTOR_API_KEY=$LOG_COLLECTOR_API_KEY

# Setup run script
COPY hassio-addon-dev/run.sh /run.sh
RUN chmod +x /run.sh

ENTRYPOINT [ "/init" ]
CMD [ "/run.sh" ]
