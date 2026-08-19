Always respond in Korean.

Monorepo (pnpm).

core: RS485 → MQTT
service: API + serves built UI
simulator: debugging-only RS485 endpoint
ui: Svelte (built and served by service)
gallery: per-vendor device YAML preset collection. list.json/list_new.json are auto-generated on deploy; no manual run needed.
docs: VitePress documentation site.

Addon versioning: `hassio-addon/config.yaml` and `hassio-addon/config-matter.yaml` versions are updated by the release CI/CD workflow. Do not manually change addon version fields in feature or fix PRs unless the task explicitly concerns the release/versioning workflow.

TypeScript (ESM, 2-space).
No hardcoded config.
Inject typed options.
Test with Vitest.
Only after modifying code, run `pnpm format` to format all packages.

# Luna Chat Coder entry point

When substantial repository development is performed from a chat surface, read `.agents/skills/luna-chat-coder/SKILL.md` before making substantial changes.

## Chat PR workspace transport

For PR work initiated from ChatGPT, use `.github/workflows/package-chat-workspace.yml` as the canonical source transport:

1. Start the PR work from a task-owned branch and make the required change to `package-chat-workspace.yml` that triggers the workspace packaging workflow.
2. Push that workflow change so GitHub Actions produces the `chat-workspace` artifact for the exact branch commit.
3. Download the generated artifact and reconstruct the complete repository workspace locally/sandboxed from that artifact. Treat `SOURCE-IDENTITY.txt`, `SHA256SUMS`, and `MANIFEST.txt` as the provenance and integrity contract.
4. Make the requested repository edits against that extracted workspace. Do not reconstruct source from chat snippets or partial GitHub file reads when the artifact is available.
5. Run the repository-defined formatting, tests, builds, and other checks in the extracted workspace as appropriate.
6. Upload/publish the resulting exact changes back to the task branch/PR using the most reliable exact transport available. Preserve the source commit identity and inspect the final diff before publication.

The workflow is a transport mechanism, not a remote interactive shell. Do not use it merely because it exists; for this repository's ChatGPT PR workflow it is the required handoff path between the initial PR setup and subsequent local/sandbox editing.

Treat exact GitHub commit and PR state as durable source truth, preserve unrelated work, and do not make access to the user's computer a dependency of the workflow.

When this repository is used as a template, keep this entry point and add the project's own engineering instructions alongside it.