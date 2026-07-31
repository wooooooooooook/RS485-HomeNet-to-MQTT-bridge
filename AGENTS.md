Always respond in Korean.

Monorepo (pnpm).

core: RS485 → MQTT
service: API + serves built UI
simulator: debugging-only RS485 endpoint
ui: Svelte (built and served by service)
gallery: per-vendor device YAML preset collection. list.json/list_new.json are auto-generated on deploy; no manual run needed.
docs: VitePress documentation site.

TypeScript (ESM, 2-space).
No hardcoded config.
Inject typed options.
Test with Vitest.
Only after modifying code, run `pnpm format` to format all packages.
