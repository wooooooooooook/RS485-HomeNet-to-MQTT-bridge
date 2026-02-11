FROM node:22-slim

ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/simulator/package.json packages/simulator/package.json
COPY packages/simulator/tsconfig.json packages/simulator/tsconfig.json
COPY packages/simulator/src packages/simulator/src
COPY scripts/run-simulator.mjs scripts/run-simulator.mjs

RUN pnpm install --filter @rs485-homenet/simulator... --no-frozen-lockfile
RUN pnpm --filter @rs485-homenet/simulator build

CMD ["node", "scripts/run-simulator.mjs"]
