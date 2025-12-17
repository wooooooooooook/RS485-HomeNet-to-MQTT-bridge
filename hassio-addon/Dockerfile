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
COPY packages/simulator/package.json packages/simulator/

# Install dependencies
# We use network-concurrency 1 just in case, though slim is more stable than alpine
RUN pnpm install --frozen-lockfile --network-concurrency 1 --filter "!@rs485-homenet/simulator"

# Copy source code
COPY . .

# Build packages (core, ui, service)
RUN pnpm --filter "!@rs485-homenet/simulator" build

# Remove simulator source code to prevent it from ending up in the final image
RUN rm -rf packages/simulator

# Remove development dependencies to reduce size of node_modules
# We use 'install --prod' instead of 'prune --prod' because the latter can incorrectly remove workspace dependencies
RUN pnpm install --prod --frozen-lockfile

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

# Setup run script
COPY hassio-addon/run.sh /run.sh
RUN chmod +x /run.sh

CMD [ "/run.sh" ]
