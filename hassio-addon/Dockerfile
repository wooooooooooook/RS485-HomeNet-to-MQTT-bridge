FROM node:20-alpine

WORKDIR /app

# Install jq for parsing options.json and bash for run.sh
RUN apk add --no-cache bash jq

# Install pnpm via corepack; custom registry 지원을 위해 NPM_REGISTRY 사용 가능
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN corepack enable \
  && npm config set registry "$NPM_REGISTRY" \
  && corepack prepare pnpm@latest --activate

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
# We need to build core and ui, then service
RUN pnpm build

# Environment variables will be set by run.sh
ENV NODE_ENV=production

COPY hassio-addon/run.sh /run.sh
RUN chmod +x /run.sh

CMD [ "/run.sh" ]
