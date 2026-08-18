---
name: luna-chat-coder
description: Keep repository development reliable from chat by using the sandbox work container first, recovering exact GitHub state, and using bounded Actions missions when normal sandbox or GitHub paths are insufficient.
license: MIT
compatibility: Requires access to durable repository state. The fully specified ChatGPT Web path requires both the GitHub Plugin and the ChatGPT Codex Connector GitHub App for the target repository. GitHub Actions access is required only when an Actions mission is needed. Other Agent Skills hosts may use the core policy only to the extent that equivalent capabilities actually exist.
metadata:
  version: "0.1.0"
---

# Luna Chat Coder

Luna Chat Coder is a repository-development continuity and fallback policy for ordinary chat. Discover it early, keep it quiet on the normal path, and activate fallback mechanisms only when the normal sandbox or connected GitHub path becomes insufficient.

## Canonical terms

Use these terms consistently:

- **sandbox work container**: the isolated, disposable code-execution container attached to the current chat surface. In ChatGPT Web, this means the ChatGPT sandbox work container. Treat it as the primary development workstation, not as the user's computer.
- **durable repository state**: exact GitHub state such as a commit, PR head, branch/ref plus its resolved commit SHA, or an immutable repository/Actions artifact.
- **Actions mission**: a bounded GitHub Actions execution used when the normal sandbox or connected GitHub path cannot safely or efficiently provide a required capability, exact transport, or execution step. It has explicit inputs, expected source identity, defined outputs, and a terminal lifecycle. It is not an interactive remote shell.
- **degraded remote mode**: the exceptional case where the sandbox work container itself cannot sustain the requested engineering work and a sequence of bounded Actions missions temporarily performs edit/build/test execution instead.

Do not use `local container`, `local environment`, or `bridge` for these concepts.

## Core invariants

1. **Discover early, activate late.** Load this policy before substantial repository work, but do not use Actions merely because the skill is present.
2. **Materialize exact source before editing.** When a target GitHub repository is given, resolve the intended commit or PR-head SHA and establish a complete working tree for that exact state inside the sandbox before source edits, builds, tests, or iterative debugging. Inspect surviving sandbox work before replacing it. Prefer normal Git clone/fetch/checkout when the sandbox can reach the repository; otherwise use another exact repository read/archive transport that preserves the required files and identity. Verify the materialized state corresponds to the expected SHA before modifying it.
3. **Sandbox first.** Prefer the sandbox work container for source inspection, editing, building, testing, linting, formatting, running services, and iterative debugging once the exact target source has been materialized there.
4. **Inventory before acquiring.** Inspect capabilities already present in the sandbox before installing, downloading, or dispatching a mission.
5. **The repository defines the engineering method.** Infer required runtimes, services, databases, browsers, compilers, test tools, and versions from repository declarations and task requirements. Do not introduce substitutes or a new methodology on Luna's behalf.
6. **GitHub holds exact durable truth.** Chat is useful for intent; conversation reconstruction is not a substitute for exact source when durable source exists. Keep observed repository facts distinct from material assumptions.
7. **Durable handoff is task-owned.** Use a branch, PR, issue, commit, or task-owned artifact when losing state would make recovery expensive or ambiguous; keep cheap intermediate reasoning in chat.
8. **Assume concurrent actors.** Other chats, agents, CI, or humans may create or move branches, refs, commits, workflows, and artifacts while this task is active. Resolve mutable names to current immutable identity before writes, publication, or cleanup; preserve unfamiliar state and never infer ownership from age or naming alone.
9. **Choose the simplest reliable exact path.** File writes, native Git object operations, and patch/bundle missions are transport choices, not a rigid hierarchy. Select using exactness, payload shape, file count, round trips, integration limits, and observed reliability.
10. **Diagnose before retrying.** Inspect returned errors or Actions logs/results before changing source or repeating an operation. Do not guess a root cause from failure status alone.
11. **The user's host computer is outside the workflow.** Do not require direct access to it or ask the user to weaken host isolation merely to unblock ordinary repository development.
12. **Evidence bounds completion claims.** Report only operations and checks that actually ran against the relevant state.

## Silent readiness preflight

Before substantial work, perform the smallest useful preflight without making the user operate a checklist:

1. identify the repository, task/PR if any, and expected commit SHA when available;
2. inspect any surviving sandbox workspace before replacing or merging it;
3. resolve the intended mutable branch/PR name to its current immutable commit SHA;
4. materialize that exact repository state as a complete sandbox working tree and verify it matches the expected SHA before editing;
5. read the repository declarations needed to understand runtime, dependency, service, build, and test requirements;
6. inventory the sandbox capabilities already available;
7. determine which connected repository read/write and Git object operations are available;
8. determine whether Actions/workflow/log/artifact operations are available if a fallback later becomes necessary.

When the normal path is healthy, do not narrate this preflight to the user.

## Work in the sandbox first

Treat the sandbox work container as a disposable development workstation. For a repository task, first recover or materialize the exact target commit/PR-head source into a complete working tree there, verify its identity, and only then perform source edits or the engineering loop. A handful of repository API reads is not a substitute for establishing the working tree when the task requires editing, building, testing, or inspecting repository-wide behavior.

When ordinary Git network access is available, clone/fetch and check out the resolved target state. If the sandbox cannot reach GitHub directly but connected repository reads or an exact archive/transport are available, use those to reconstruct the complete target tree without inventing bytes. If no exact source path can establish the required working tree, treat that as a capability/transport gap rather than editing an incomplete reconstruction.

When the repository requires a capability that is absent, first try a safe and faithful sandbox setup if the environment permits it. Installation and configuration choices that are purely disposable development details can be resolved autonomously when the requested outcome is clear.

Do not silently weaken verification because setup is inconvenient. If the repository requires a real integration for the behavior under test, prefer that integration over an easier substitute.

## Use Actions missions when they reduce real risk or cost

An Actions mission is appropriate when at least one of these is true:

- the sandbox cannot obtain or execute a repository-required capability;
- the sandbox itself is unavailable or cannot sustain the task;
- a substantial exact patch/bundle is safer or more efficient than repeated per-file writes;
- the connected GitHub write path is constrained by payload/operation limits or is observably unstable after its returned errors have been inspected;
- binary changes, renames, mode changes, Git history, or another payload property is better preserved as one deterministic transport unit.

Do not dispatch a mission merely because Actions exists. Do not abandon a connected GitHub path after one unexplained failure: inspect the error first. A clearly transient operation may be retried once when safe; repeated or structurally brittle failures are a reason to choose a different exact transport.

The common capability case is a **supply mission**: a networked runner obtains or prepares a required dependency, runtime, SDK, compiler, native library, generated input, cache, archive, or other external build input and returns a verified artifact. After the missing capability is supplied, return to the sandbox engineering loop.

### Distinguish acquisition gaps from execution gaps

If the sandbox can faithfully execute a required capability once the necessary bytes are available, prefer a supply mission that obtains or prepares those bytes and returns them to the sandbox. Do not move the engineering loop to Actions merely because the sandbox cannot download or initially install a required tool or service.

For example, if the repository requires PostgreSQL and the sandbox can run PostgreSQL but cannot obtain the required packages or distribution, use a supply mission to acquire a compatible PostgreSQL distribution or installation payload, verify it in the sandbox, install and start PostgreSQL there, and continue migrations, application execution, tests, and debugging in the sandbox.

Use remote execution only when the sandbox cannot faithfully execute the required capability even after the necessary inputs have been supplied, or when the sandbox itself cannot sustain the task.

If the sandbox work container itself is unavailable or cannot sustain the task because of platform usage limits, execution-duration limits, resource limits, missing execution capability, or another hard environment constraint, enter **degraded remote mode**. Continue with bounded Actions missions that perform only the necessary editing, build, test, packaging, or verification steps, using GitHub commits/branches/artifacts as durable state between missions.

Degraded remote mode is a fallback, not the preferred environment. Tell the user in the next meaningful user-visible update or final report that sandbox execution was unavailable or insufficient and that the work continued through GitHub Actions. Do not speculate about billing. If an operation would require an explicitly paid or materially costly resource beyond ordinary configured Actions use, obtain the user's approval before creating that cost.

Read [`references/actions-missions.md`](references/actions-missions.md) before dispatching an Actions mission.

## Publish exact changes

Choose the lowest-overhead path that remains exact and reliable for the observed task:

- connected repository file operations are usually efficient for small textual changes;
- native Git blob/tree/commit/ref operations can efficiently publish substantial multi-file state when exposed by the integration;
- an exact patch or bundle carried by an Actions mission can be preferable for large or complex diffs, repeated-write overhead, binary/mode/rename semantics, connector limits, or persistent API instability.

Capture the expected base SHA before substantial publication work. If the base moved, recover the new durable state and deliberately rebase, merge, or recreate the payload. Do not reconstruct a substantial verified change from prose when exact source bytes can be transported.

Model-mediated reconstruction or serialization of publication payloads can introduce unintended byte-level drift even when the intended source is unchanged. When a published file or object differs from the verified source, consider the publication path itself as a possible cause before assuming the source or overall publication strategy is wrong.

If the strategy still appears appropriate, a limited retry of only the failed payload may be reasonable. Preserve the verified source rather than reconstructing it unnecessarily, avoid disturbing outputs that are already known to be correct, and use available integrity evidence to confirm the result when practical. If the failure persists, reassess the transport or report the blocker rather than repeating the same operation blindly.

## Recovery

After a chat reset, sandbox loss, or source-identity ambiguity, read [`references/recovery.md`](references/recovery.md).

Prefer recovery in this order:

```text
commit / PR head
    > immutable Git or Actions artifact
    > surviving sandbox working tree
    > conversation reconstruction
```

Preserve unfamiliar surviving work and mission state until ownership and terminal status are understood.

## Completion and reporting

Source edits alone are not completion when executable behavior is part of the task. Run the applicable application/services, setup or migrations, build, tests, integration checks, and end-to-end checks required by the repository and task.

At completion, report:

- what exact state was changed or published;
- what checks actually ran and their results;
- any check that could not run and the exact blocker;
- whether degraded remote mode was used because the sandbox work container was unavailable or insufficient.

Do not burden the user with Luna-specific mechanics on a healthy normal path.

## Portability boundary

The skill uses the Agent Skills structure and keeps its core policy host-neutral. The repository documents and validates the ChatGPT Web GitHub path explicitly because that path has known GitHub prerequisites.

On another Agent Skills host, use the host's analogous sandboxed code-execution environment and only the repository/Actions capabilities that actually exist and are authorized. Do not infer full support merely because the host can parse `SKILL.md`, and do not invent GitHub write, workflow, log, artifact, or credential access that is not present.

## Maintaining Luna itself

When the task is to modify, review, or redesign Luna Chat Coder rather than merely use it for another repository task, read [`references/design-rationale.md`](references/design-rationale.md) before changing policy. That document is maintainer memory, not runtime policy; if it conflicts with this `SKILL.md`, reconcile the inconsistency rather than silently treating historical rationale as a current instruction.
