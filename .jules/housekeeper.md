## 2025-05-23 - Missing Linter for Unused Imports
**Observation:** The `pnpm lint` command runs `tsc --noEmit`, which doesn't flag unused imports because `noUnusedLocals` is disabled in `tsconfig.json`. There is no ESLint configuration.
**Action:** Relied on manual inspection. Future upkeep should verify if `noUnusedLocals` can be safely enabled or if ESLint should be introduced.

## 2025-05-23 - Broken Build in Simulator
**Observation:** `packages/simulator` failed to build because `src/packets_from_userdata.ts` was in `.gitignore` but imported by `src/index.ts`. This meant fresh clones could not build the project.
**Action:** Removed the file from `.gitignore` and added it with an empty export to ensure the project builds out of the box.

## 2025-05-23 - Broken Test Script in Simulator
**Observation:** `packages/simulator/package.json` contains a test script pointing to `packages/simulator/test/simulator.test.ts`, which does not exist.
**Action:** Created `packages/simulator/test/simulator.test.ts` with a placeholder test and updated `package.json` to use standard `vitest` invocation.

## 2025-05-23 - Simulator Excluded from Root Lint
**Observation:** The root `pnpm lint` script explicitly excludes `packages/simulator` (`--filter '!@rs485-homenet/simulator'`).
**Action:** Manually verified `packages/simulator` linting. It should be integrated back into the main lint workflow in the future.

## 2025-05-23 - Use tsc to Find Unused Code
**Observation:** Since `tsconfig.json` disables `noUnusedLocals`, many unused imports accumulate.
**Action:** Run `pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters` to uncover them. Note that `_decodeValue` in `command.generator.ts` is intentionally unused (deprecated but preserved).

## 2025-05-23 - Global Linting Enabled
**Observation:** The `lint` script in `package.json` was restricted to `service` and its dependencies, excluding `simulator` and `ui`.
**Action:** Updated `package.json` to use `turbo lint` without filters, ensuring all packages are linted in the standard workflow. This resolves the previous observation "Simulator Excluded from Root Lint".

## 2026-02-04 - Unused CommandGenerator Class
**Observation:** The `CommandGenerator` class in `packages/core` appears to be unused in production code, only referenced in tests and exported in `index.ts`. It contains logic superseded by `PacketProcessor` and `Device` classes.
**Action:** Removed unused `stateProvider` parameter to reduce noise. Future cleanup should investigate if the entire class can be deprecated or removed.

## 2026-02-04 - Deprecated CommandGenerator
**Observation:** `CommandGenerator` is verified to be unused in production code (replaced by `PacketProcessor` and `Device`).
**Action:** Marked the class with `@deprecated` to warn developers and signal future removal.

## 2026-02-04 - Optimize CommandGenerator
**Observation:** `CommandGenerator` created new `Set` instances for checksum types in every constructor call, and had an unused `_decodeValue` method flagged by strict linters.
**Action:** Converted Sets to `static readonly` to reduce memory allocation. Removed the unused `_decodeValue` method entirely as requested in code review.
