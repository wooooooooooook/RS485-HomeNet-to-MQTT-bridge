ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.22

# Stage 1: Builder
FROM node:22-slim AS builder

ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY packages packages
COPY scripts scripts

RUN pnpm install --recursive --no-frozen-lockfile
RUN pnpm build

# Remove development dependencies to reduce size of node_modules
# We must do this BEFORE removing workspace packages that are in 'dependencies'
RUN pnpm install --prod --no-frozen-lockfile

# Now remove source code and unneeded packages
RUN rm -rf packages/ui \
  packages/*/src \
  packages/*/test \
  packages/*/tsconfig*.json \
  packages/*/*.md \
  scripts

# Stage 2: Runner (Home Assistant Base Image)
ARG BUILD_FROM
FROM ${BUILD_FROM} AS runner

WORKDIR /app

# Install runtime dependencies
# nodejs: HA base image doesn't include Node.js
# tini: lightweight init for PID 1
# socat: for serial port bridging in dev/test environments
RUN apk add --no-cache nodejs tini gcompat socat

# Copy application from builder
COPY --from=builder /app /app

ENV NODE_ENV=production

# Setup run script
COPY hassio-addon-dev/run.sh /run.sh
RUN chmod +x /run.sh

ENTRYPOINT [ "/sbin/tini", "--", "/run.sh" ]
