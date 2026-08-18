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

# Luna Chat Coder entry point

When substantial repository development is performed from a chat surface with a disposable or sandboxed code-execution environment, read `.agents/skills/luna-chat-coder/SKILL.md` before making substantial changes.

Loading the skill is a readiness step, not a reason to use GitHub Actions. Normal engineering work should stay in the chat sandbox work container when it is available and sufficient.

The repository itself defines its runtimes, services, dependencies, architecture, build system, and verification requirements. Luna Chat Coder supplies continuity and missing execution capability; it does not introduce a development methodology or substitute technologies merely because they are easier to run.

Treat exact GitHub commit and PR state as durable source truth, preserve unrelated work, and do not make access to the user's computer a dependency of the workflow.

When this repository is used as a template, keep this entry point and add the project's own engineering instructions alongside it.