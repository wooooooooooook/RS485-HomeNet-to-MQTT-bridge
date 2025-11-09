# Repository Guidelines

Always respond with 한국어

## Project Structure & Module Organization
The monorepo lives under `packages/` with four workspaces: `core` (RS485⇢MQTT logic), `service` (Express API + UI proxy), `simulator` (virtual RS485 PTY), and `ui` (Svelte SPA). Shared configs sit at the root (`tsconfig.base.json`, `vitest.config.ts`, `pnpm-workspace.yaml`). Docker and add-on assets live in `deploy/docker/`. Keep env files (`.env`, options.json) out of version control.

## Build, Test, and Development Commands
Use `pnpm` (preferred) or `npm run` from the repo root:
- `pnpm core:dev | service:dev | ui:dev` – start package-specific watch modes.
- `pnpm build` – compile all workspaces (TypeScript → `dist/`, Vite bundle for UI).
- `pnpm lint` – type-checks every package (`tsc --noEmit`, `svelte-check`).
- `pnpm test` – runs Vitest via `vitest.config.ts`; add package-level scripts for focused suites (e.g., `pnpm --filter @rs485-homenet/core test`).

## Coding Style & Naming Conventions
TypeScript, ES modules, and 2-space indentation. Prefer `const`, arrow callbacks, and single quotes as in `packages/core/src/index.ts`. Export factories/classes instead of instantiating singletons to aid testing. Name files after their default export (`homeNetBridge.test.ts`, `server.ts`). UI components follow PascalCase `.svelte`; helper modules use camelCase.

## Testing Guidelines
Vitest is the default harness. Mirror `packages/core/test/homeNetBridge.test.ts` by mocking serial/MQTT layers and asserting MQTT payloads. Put tests under `test/` or `src/__tests__/` next to the code. Simulator tests should emit fake RS485 frames; UI currently lacks tests—add `@testing-library/svelte` when behavior stabilizes. Run `pnpm test` before every PR and ensure new logic has deterministic coverage; document skipped tests with a TODO referencing an issue.

## Commit & Pull Request Guidelines
Commits follow imperative, sentence-style summaries (“Add RS485 PTY simulator package”). Scope changes narrowly and keep workspaces in sync. PRs should include: purpose, key changes, how to reproduce/test (commands + env vars), and screenshots for UI tweaks. Link related issues or Home Assistant tickets, note env or schema changes, and call out any simulator-only shortcuts.

## Configuration & Security Notes
Load runtime settings via `.env` (`SERIAL_PORT`, `BAUD_RATE`, `MQTT_*`, topic prefixes). Never hardcode credentials or MQTT topics—thread them through options and document defaults in README. When adding serial features, guard against blocking I/O by using timeouts and validating payload lengths before publishing to `homeassistant/*` topics.
