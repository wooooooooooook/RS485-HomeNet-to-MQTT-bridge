## 2026-01-08 - CEL Execution in Hot Paths
**Learning:** In protocol parsing loops (specifically checksum sweeps), stateless script executors like `cel-js` can become a bottleneck due to repeated Map lookups and context object creation. Caching the "prepared" script execution logic that closes over the static analysis (like `usesData`) significantly reduces overhead in O(N^2) algorithms.
**Action:** When integrating expression languages in tight loops, always look for a "prepare/compile" phase that moves static analysis out of the execution path.

## 2026-01-12 - Buffer.subarray vs Full Scan
**Learning:** Creating `Buffer.subarray` views to limit search range is surprisingly more expensive than just letting `Buffer.indexOf` scan a larger (16KB) dirty buffer in Node.js, likely due to V8 object allocation overhead vs heavily optimized C++ SIMD scanning.
**Action:** Do not use `subarray` just to enforce search bounds on small loops unless the buffer is huge (>MBs) or the search pattern causes frequent partial matches (worst-case).

## 2026-01-18 - Set.has vs Uint8Array Lookup for Bytes
**Learning:** In hot loops processing raw binary streams (like packet headers), `Set.has(byte)` adds significant overhead due to hashing and function calls compared to direct array access. Using a `Uint8Array` as a boolean lookup table (1 or 0) for checking valid byte values provided a ~4x speedup in scanning throughput.
**Action:** For byte-level validation sets (0-255), always prefer `Uint8Array` or `Boolean[]` lookup tables over `Set<number>`.

## 2026-01-23 - Reusable Context for CEL Execution
**Learning:** In high-frequency CEL execution (e.g., per-packet parsing), creating safe context objects (allocating new Objects and Proxies) dominates CPU time. Manually managing a reusable context object with pre-validated types (BigInts) and bypassing safety checks via `executeRaw` reduced parsing overhead by ~17% in hot paths.
**Action:** For frequent script execution, use `executeRaw` with a persistent context object and handle type conversion (number -> BigInt) manually or once, rather than relying on auto-boxing.

## 2026-01-26 - Allocation Optimization vs Algorithmic Win
**Learning:** Attempting to optimize `calculateChecksum2` by passing an optional output array (to avoid `[number, number]` allocation) actually SLOWED down the benchmark by ~35%. This is likely due to the overhead of polymorphic function calls, optional checks in tight loops, or V8 deoptimizations.
**Action:** Be wary of "allocation removal" optimizations in V8 for small, short-lived objects (like 2-element arrays) unless confirmed by profiling. Algorithmic improvements (like changing O(N^2) to O(N) via incremental checksumming) are far more reliable and effective (20x speedup in this case).

## 2026-01-29 - Extending Reusable Context to Packet Matching
**Learning:** Packet matching logic (`matchesPacket`) often runs for every device on every packet. When `guard` expressions are used (CEL), the overhead of creating safe context objects (Proxies) for every match attempt becomes significant. Promoting `ReusableBufferView` and `reusableContext` to the base `Device` class allows all devices to share zero-allocation script execution for packet guards.
**Action:** Identify repetitive script executions in "router" or "dispatcher" patterns (like matching logic) and lift the context management to the long-lived objects (e.g., Device instances) to amortize allocation costs.

## 2026-01-30 - Pre-resolved Dispatch vs Switch
**Learning:** In hot parsing loops, even a simple `switch` statement inside a helper function (like `verifyChecksum2FromBuffer`) adds measurable overhead (~13%) compared to calling a pre-resolved function reference directly. V8's monomorphic call optimization works best when the target function is stable and known ahead of time.
**Action:** For high-frequency operations configured at startup (like checksum algorithms), pre-resolve the specific implementation function into a class property instead of passing the type string to a generic dispatcher function repeatedly.

## 2026-02-03 - Loop Unswitching in Packet Matching
**Learning:** In hot loops (like packet byte matching), checking `mask !== undefined` or `Array.isArray(mask)` inside the loop adds significant overhead (27% slowdown for scalar masks). V8 optimizes much better when the loop body is monomorphic and simple.
**Action:** Unswitch loops based on configuration (No Mask, Scalar Mask, Array Mask) to create specialized, simple loop bodies for each case.
