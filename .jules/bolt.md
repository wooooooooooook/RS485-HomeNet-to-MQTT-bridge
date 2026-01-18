## 2026-01-08 - CEL Execution in Hot Paths
**Learning:** In protocol parsing loops (specifically checksum sweeps), stateless script executors like `cel-js` can become a bottleneck due to repeated Map lookups and context object creation. Caching the "prepared" script execution logic that closes over the static analysis (like `usesData`) significantly reduces overhead in O(N^2) algorithms.
**Action:** When integrating expression languages in tight loops, always look for a "prepare/compile" phase that moves static analysis out of the execution path.

## 2026-01-12 - Buffer.subarray vs Full Scan
**Learning:** Creating `Buffer.subarray` views to limit search range is surprisingly more expensive than just letting `Buffer.indexOf` scan a larger (16KB) dirty buffer in Node.js, likely due to V8 object allocation overhead vs heavily optimized C++ SIMD scanning.
**Action:** Do not use `subarray` just to enforce search bounds on small loops unless the buffer is huge (>MBs) or the search pattern causes frequent partial matches (worst-case).

## 2026-01-18 - Set.has vs Uint8Array Lookup for Bytes
**Learning:** In hot loops processing raw binary streams (like packet headers), `Set.has(byte)` adds significant overhead due to hashing and function calls compared to direct array access. Using a `Uint8Array` as a boolean lookup table (1 or 0) for checking valid byte values provided a ~4x speedup in scanning throughput.
**Action:** For byte-level validation sets (0-255), always prefer `Uint8Array` or `Boolean[]` lookup tables over `Set<number>`.
