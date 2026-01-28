FROM node:20-slim AS base

ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

FROM base AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages packages
COPY scripts scripts

RUN pnpm install --recursive --no-frozen-lockfile
RUN pnpm build

FROM base AS runner

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/service/package.json packages/service/package.json
COPY scripts scripts

RUN pnpm install --filter @rs485-homenet/service... --prod

COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/service/dist packages/service/dist
COPY --from=builder /app/packages/service/static packages/service/static

CMD ["node", "packages/service/dist/server.js"]
