## 2025-05-23 - Missing Linter for Unused Imports
**Observation:** The `pnpm lint` command runs `tsc --noEmit`, which doesn't flag unused imports because `noUnusedLocals` is disabled in `tsconfig.json`. There is no ESLint configuration.
**Action:** Relied on manual inspection. Future upkeep should verify if `noUnusedLocals` can be safely enabled or if ESLint should be introduced.
