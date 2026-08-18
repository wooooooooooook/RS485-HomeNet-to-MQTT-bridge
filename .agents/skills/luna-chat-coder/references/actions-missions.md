# Actions Missions

Use an Actions mission when the normal sandbox or connected GitHub path cannot safely or efficiently provide a capability, exact transport, or bounded execution step required by the repository task.

A useful mental model is an unmanned probe: dispatch it with an exact target, payload, and return contract; let it operate independently; then inspect its logs, artifacts, checks, or durable Git result after it terminates. Do not treat GitHub Actions as a live shell connected to the chat.

## Choose the mission for the actual gap

Common mission types are:

- **supply mission**: obtain or prepare an external input the sandbox cannot obtain directly;
- **transport mission**: carry an exact patch, bundle, archive, or other deterministic payload when direct GitHub writes are inefficient, constrained, or unreliable;
- **degraded execution mission**: perform a bounded edit/build/test/verification step while the sandbox itself is unavailable or insufficient.

These are roles, not separate infrastructure. Keep each mission as small as practical.

## Mission contract

Before dispatch, define the smallest sufficient mission:

- **source identity**: repository plus expected commit or PR-head SHA;
- **purpose**: the capability gap, transport need, or bounded execution step being handled;
- **inputs**: exact files, patch/bundle, lockfiles, versions, parameters, or other required state;
- **operations**: explicit commands or workflow steps;
- **outputs**: artifact, logs, checksum, generated input, test result, commit, or other durable result expected back;
- **integrity**: checksums and provenance when bytes cross the sandbox/runner boundary;
- **permissions**: minimum workflow and repository permissions required;
- **terminal state**: what makes the mission complete and what temporary state can eventually be removed.

If the expected source SHA no longer matches, stop that mission path and deliberately recover/rebase rather than applying an exact payload to the wrong source.

## Supply mission

Use a supply mission when the sandbox can do the engineering work but cannot obtain a required external input.

A supply mission should:

1. check out the expected repository commit when repository context is required;
2. read the repository's lockfiles, runtime/toolchain declarations, and relevant configuration;
3. obtain only the required dependency, runtime, SDK, compiler, native input, generated data, cache, vendor tree, archive, or similar input;
4. prefer the ecosystem's normal pinned/offline-compatible form;
5. record provenance including source, repository SHA, runner OS/architecture, relevant tool/runtime versions, and production commands;
6. checksum the returned payload;
7. upload only the required result with a bounded retention period;
8. verify provenance, checksum, and platform compatibility before consuming it in the sandbox.

Native or compiled payloads are platform-specific unless compatibility has been established.

After supply, return to the sandbox work container for editing, building, testing, and debugging whenever possible.

## Exact source transport mission

A patch or bundle mission is not reserved only for complete failure of the GitHub API. It can be the better transport when one deterministic payload is safer or cheaper than many independent writes.

Consider it when:

- a verified change spans enough files that repeated complete-file writes create unnecessary round trips or partial-update risk;
- connected write operations return repeated or structurally relevant errors after those errors have been inspected;
- payload or operation limits make direct publication brittle;
- binary changes, renames, executable-bit/mode changes, or Git object/history semantics should be preserved exactly;
- a single checksummed payload materially simplifies recovery or handoff.

Do not switch transports merely because one API call failed. Inspect the returned error first. Retry an unchanged operation only when the evidence supports a transient failure and a retry is safe. If the same path remains unreliable, switch deliberately rather than repeating it blindly.

Create an exact binary-safe patch and checksum it, for example:

```bash
git diff --binary > change.patch
sha256sum change.patch
```

Bind the payload to the expected base SHA. The remote side should:

```text
verify remote base == expected SHA
verify patch checksum
git apply --check change.patch
git apply change.patch
run repository-defined checks
inspect the resulting diff
git diff --check
commit to the task branch
```

Use a Git bundle when preserving Git objects or history is more useful than a patch or source archive. Before choosing artifact transport, consider current payload-size, upload/download, and retention limits exposed by the integration or platform. Do not recreate a substantial change from prose or ad-hoc string replacements when an exact payload exists.

## Degraded remote mode

Enter degraded remote mode only when the sandbox work container itself is unavailable or cannot sustain the requested work because of a hard platform constraint such as usage, duration, resource, or execution limits.

In this mode, continue through a sequence of bounded missions rather than pretending the runner is a persistent interactive workstation:

1. establish or recover the exact durable repository base;
2. dispatch a mission for the next bounded edit/build/test/verification step;
3. persist reusable progress as an exact commit, task branch, patch, bundle, or immutable artifact;
4. inspect the returned logs/results before deciding the next mission;
5. repeat only while the sandbox remains unavailable and the task still benefits from remote execution;
6. return to the sandbox path if it becomes available and doing so is cheaper or clearer.

Tell the user that degraded remote mode was used because the sandbox execution environment was unavailable or insufficient. Report the actual remote checks performed. Do not claim interactive sandbox verification when only Actions verification occurred.

## Diagnose failures before retrying

A failed mission is evidence to inspect, not a prompt to guess.

Before changing source or re-running the mission:

1. inspect the run conclusion and the jobs/steps that actually failed;
2. read the available error output and job logs around the first relevant failure;
3. inspect any produced artifacts, commits, refs, or partial results so a retry does not overwrite useful state;
4. distinguish at least these classes when possible: repository/test failure, mission/workflow defect, permission/authentication failure, quota/platform limit, stale source identity, and transient runner/service failure;
5. state uncertainty explicitly when logs or results are unavailable.

Do not modify application source merely because an Actions run is red. Do not re-run an unchanged failed mission unless the evidence supports a transient or flaky failure. Without new evidence, one unchanged retry is the maximum; another identical failure should trigger diagnosis, a changed mission, a different transport, or an explicit blocker report.

Keep a failed mission's logs and task-owned state while they still have debugging or recovery value.

## Task ownership and collision-resistant names

Temporary remote state must be task-owned and bounded. Give independent missions distinct names when they can overlap. Prefer a short readable purpose plus a collision-resistant suffix, for example:

```text
mission-deps-a7f3c2d1
mission/patch-a7f3c2d1
mission-export-a7f3c2d1.yml
```

When a sandbox with Python is available, a cheap preferred attempt is:

```bash
python -c "import secrets; print(secrets.token_hex(4))"
```

If Python or randomness is unavailable, use another reasonable UUID/random mechanism or a sufficiently unique task-derived suffix. Suffix generation is a collision-reduction aid, not a reason to block the task.

Names coordinate ownership; immutable identity still comes from commit SHAs and payload checksums. Keep unrelated tasks out of shared scratch branches, artifact names, workflow payloads, and mutable transport files.

## Durable lifecycle and cleanup

Cleanup must remain safe even if the chat, sandbox, or conversational context disappears unexpectedly. Do not rely on conversation memory as the only record of remote-state ownership.

A task branch or other mission-owned object should remain while it still has active publication, PR review, debugging, handoff, or recovery value. After merge or deliberate abandonment, remove it when task ownership and terminal state are clear. Do not delete an unfamiliar branch or mission object merely because it is old, and do not use ancestry alone as proof that cleanup is safe.

After successful transfer, publication, deliberate abandonment, or replacement, inspect the task-owned temporary state:

```text
temporary branch or ref
mission workflow definition
transport or supply artifact
mission-only repository file
workflow run retained for diagnostics
```

Artifacts should be as small and short-lived as practical, but do not remove the only exact recovery payload before its result has been consumed or replaced by durable repository state. Workflow runs may retain useful diagnostics; bounded growth matters more than an exact run count. Treat workflow definitions, historical runs, branches/refs, and artifacts as separate lifecycle objects.

Control growth before it becomes a cleanup emergency. Prefer one task branch over a new branch for every retry when the same branch can safely carry the durable task state. Avoid duplicate transport/supply artifacts when an existing artifact is still the intended exact payload; when a newer durable result supersedes an older temporary payload, shorten retention or remove the obsolete copy when safe. During mission-heavy work, periodically inspect the count, size, age, and ownership of task branches, temporary workflows, recent runs, and artifacts. If growth is surprising or ownership is unclear, stop creating more temporary state until the existing state is understood. Respect repository/organization retention, storage, quota, and budget controls when they are observable.

Keep a failed mission while it has debugging or recovery value. When a better durable path supersedes it, remove its task-owned temporary objects when safe. During mission-heavy work, occasionally audit task branches/refs, temporary workflow definitions, recent mission runs, and artifact storage so remote state tracks active work rather than forgotten attempts.

If context is lost, reconstruct ownership and terminal state from durable GitHub evidence before cleanup. Preserve anything unfamiliar until that reconstruction is sufficient.

Prefer existing trusted reusable workflows when they express the mission safely. If a temporary workflow is necessary, use narrow triggers, minimum permissions, task-owned names, isolated temporary state, and remove the definition from final source unless the project deliberately adopts it as maintained infrastructure. If concurrency controls are used, derive their group from task identity so unrelated missions cannot cancel or overwrite one another.

Cleanup should be idempotent: an object that is already absent is already clean.

## Security

- Keep credentials, signing material, and unrelated runner state out of artifacts.
- Use minimum workflow permissions.
- Verify the provenance of downloaded executables and native inputs; an Actions artifact is transport, not automatic trust.
- Keep large caches, SDKs, and toolchains out of normal source history unless the repository explicitly adopts them there.
- Do not expose or weaken the user's host computer to avoid using a mission.
