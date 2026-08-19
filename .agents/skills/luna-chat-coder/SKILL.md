---
name: luna-chat-coder
description: Keep repository development reliable from chat by using the repository's ChatGPT workspace artifact flow for PR work, with sandbox-first execution after exact source materialization and bounded Actions fallback when needed.
license: MIT
compatibility: Requires access to durable repository state. The ChatGPT Web PR path uses the GitHub Plugin and the repository's package-chat-workspace workflow. Other Agent Skills hosts may use the core policy only to the extent that equivalent capabilities exist.
metadata:
  version: "0.2.0"
---

# Luna Chat Coder

Luna Chat Coder is the repository-development policy for substantial work initiated from chat. It provides a deterministic handoff from GitHub to the chat sandbox and preserves exact source identity throughout the PR lifecycle.

## Canonical terms

- **sandbox work container**: the isolated, disposable code-execution environment attached to the chat. It is the primary editing, testing, and debugging workstation after the exact workspace has been materialized.
- **chat-workspace artifact**: the `chat-workspace` GitHub Actions artifact produced by `.github/workflows/package-chat-workspace.yml`. It is the canonical source transport for ChatGPT PR work in this repository.
- **durable repository state**: an exact commit, PR head, branch/ref resolved to a commit SHA, or immutable Actions artifact.
- **Actions mission**: a bounded GitHub Actions execution used for a specific capability, transport, or execution gap. It is not an interactive remote shell.

Do not use `local container`, `local environment`, or `bridge` for these concepts.

## Core invariants

1. **Discover early, activate late.** Read this skill before substantial repository work. Do not use unrelated Actions missions merely because this skill is present.
2. **PR work starts with the workspace workflow.** For ChatGPT-initiated PR work in this repository, create/use a task-owned branch and make the prescribed `package-chat-workspace.yml` comment change as the first PR-workflow handoff. Push that workflow change so the exact branch commit is packaged.
3. **Materialize exact source before editing.** Download the resulting `chat-workspace` artifact and reconstruct the complete repository workspace in the sandbox before source edits, builds, tests, or iterative debugging. Verify `SOURCE-IDENTITY.txt`, checksums, and manifest, and confirm the extracted source corresponds to the packaged commit SHA.
4. **Artifact source is authoritative for the editing phase.** Do not reconstruct repository source from conversation snippets, partial API reads, or remembered content once the artifact is available.
5. **Sandbox first after materialization.** Prefer the extracted workspace for editing, builds, tests, linting, formatting, services, and debugging.
6. **The repository defines the engineering method.** Follow repository runtimes, package manager, dependencies, architecture, build system, and verification requirements. Do not introduce substitutes merely for convenience.
7. **GitHub holds durable truth.** Keep exact branch, PR, and commit identity separate from chat intent. Resolve mutable refs to immutable SHAs before important writes.
8. **Preserve unrelated work.** Never overwrite or silently discard unfamiliar changes in the workspace or task branch.
9. **Diagnose before retrying.** Inspect errors, workflow logs, artifacts, and resulting state before changing source or repeating a failed operation.
10. **User host is outside the workflow.** Do not require direct access to the user's computer or ask the user to weaken host isolation.
11. **Completion claims require evidence.** Report only checks and publication steps that actually ran against the relevant state.

## Canonical ChatGPT PR workflow

Use this sequence whenever the user asks to start or perform substantial PR work from ChatGPT:

```text
1. Resolve repository + requested task/PR + current base/head identity.
2. Create or select a task-owned branch.
3. Modify only the prescribed comment in .github/workflows/package-chat-workspace.yml.
4. Push that workflow change.
5. Wait for the package-chat-workspace Actions run to complete.
6. Retrieve the chat-workspace artifact.
7. Verify SOURCE-IDENTITY.txt, SHA256SUMS, and MANIFEST.txt.
8. Extract source.tar.gz and, when useful, restore pnpm-store.tar.gz.
9. Confirm extracted source == packaged commit SHA.
10. Perform all repository edits in the extracted sandbox workspace.
11. Run formatting, tests, builds, and other repository-required checks.
12. Inspect the complete diff and verify no unrelated changes were introduced.
13. Publish the resulting exact changes back to the task branch/PR.
14. Reconcile the published branch/PR SHA with the edited workspace and report validation.
```

The initial workflow-comment change is intentional. It provides a deterministic GitHub Actions trigger and establishes a durable source package for the branch before iterative editing begins. Do not treat that comment as application functionality.

The packaging workflow excludes itself from `source.tar.gz`; therefore the extracted editing workspace contains the repository source as it existed for the triggering commit without recursively packaging the transport workflow. Preserve the workflow change separately when publishing the final PR state.

## Artifact integrity and provenance

The package workflow records repository, commit SHA, ref, workflow name, and run ID. It also emits `SHA256SUMS` and `MANIFEST.txt`. Treat these as a provenance and integrity contract, not optional documentation.

Before editing:

1. verify the artifact belongs to the expected repository and task branch;
2. verify the packaged commit SHA is the intended durable source;
3. verify archive/chunk checksums before extraction;
4. reconstruct any split archive without changing bytes;
5. inspect the resulting tree and confirm its Git identity where possible.

If the branch moved before editing or publication, stop and reconcile the new commit intentionally. Do not apply a verified change blindly to a different base.

## Publishing changes from the artifact workspace

The artifact is a source transport, not a publication authority. After editing:

- preserve exact source bytes and Git semantics whenever possible;
- use local Git or connected Git object/file operations according to the repository's available tooling;
- prefer a single exact patch/bundle or native Git tree/commit operation when many files, renames, modes, binaries, or repeated writes make per-file publication brittle;
- inspect the resulting remote diff and commit SHA after publication;
- do not recreate substantial edits from prose after a transport failure when the verified workspace or patch still exists.

If publication reveals a mismatch, consider the transport itself as a possible source of byte drift before assuming the edited workspace is wrong.

## Sandbox and dependency setup

Inventory capabilities before installing anything. If the repository requires dependencies that the sandbox cannot obtain but can execute once supplied, use a bounded supply mission or another faithful transport to obtain the missing bytes, then return to the sandbox.

For this repository, pnpm and its lockfile define the dependency model. Do not replace the package manager with npm/yarn merely to make the task easier.

Run the repository-defined checks. For this repository, code changes require formatting with `pnpm format` after modification, and Vitest is the test framework unless a narrower task explicitly defines additional checks.

## Actions missions and degraded remote mode

Use a separate Actions mission only when the sandbox cannot faithfully provide a required capability, a deterministic transport is materially safer, or the sandbox itself is unavailable/insufficient.

The normal `package-chat-workspace.yml` handoff is **not** a degraded remote mode mission. It is the repository's canonical ChatGPT PR source transport and should be used before editing even when the sandbox is healthy.

If the sandbox becomes unavailable after artifact acquisition, enter degraded remote mode only as a fallback. Use bounded missions with explicit inputs, outputs, source SHA, checksums, and terminal state. Persist progress as commits, task-owned branches, patches, bundles, or immutable artifacts.

Read `references/actions-missions.md` before dispatching a separate Actions mission.

## Recovery

After a chat reset, sandbox loss, or source-identity ambiguity, recover in this order:

```text
current PR/branch head commit
    > chat-workspace artifact and its provenance
    > surviving sandbox workspace
    > exact patch/bundle
    > conversation reconstruction
```

Preserve unfamiliar state until ownership and identity are understood.

If the original package artifact is still the correct source handoff, reuse it instead of generating duplicate transport state.

## Completion and reporting

At completion report the exact branch/PR and commit state changed, the exact artifact/source identity used for editing, checks actually run and their results, any check that could not run and the blocker, and whether an additional degraded Actions mission was required.

Do not burden the user with Luna-specific mechanics when the workflow is progressing normally, but do surface a transport or source-identity problem when it affects correctness.

## Maintaining Luna itself

When changing this skill, preserve the repository-specific ChatGPT artifact workflow as the canonical PR handoff unless the repository workflow is deliberately redesigned at the same time. Keep generic Actions fallback policy separate from the normal workspace packaging path.
