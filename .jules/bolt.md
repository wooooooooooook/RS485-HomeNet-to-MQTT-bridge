## 2026-01-08 - CEL Execution in Hot Paths
**Learning:** In protocol parsing loops (specifically checksum sweeps), stateless script executors like `cel-js` can become a bottleneck due to repeated Map lookups and context object creation. Caching the "prepared" script execution logic that closes over the static analysis (like `usesData`) significantly reduces overhead in O(N^2) algorithms.
**Action:** When integrating expression languages in tight loops, always look for a "prepare/compile" phase that moves static analysis out of the execution path.
