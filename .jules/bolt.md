## 2025-12-14 - [PacketParser Allocations]
**Learning:** `PacketParser.parse` runs for every byte. Intermediate `Buffer.from()` calls for checksum validation created significant overhead (approx 50% of parsing time) in the hot path.
**Action:** Use `number[]` or generic `ByteArray` interfaces to avoid unnecessary object creation in hot paths like serial data parsing.

## 2025-12-18 - [PacketParser Footer Search]
**Learning:** `Buffer.indexOf` provides massive speedup (~7x) for scanning specific byte sequences (footers) compared to manual nested loops, but only for sequences with low probability of random occurrence (e.g. 4+ bytes). For short sequences (2 bytes) in random data, the improvement is negligible due to frequent false positive matches requiring subsequent validation.
**Action:** Prefer `Buffer.indexOf` for searching headers/footers, but be aware that its effectiveness scales with sequence uniqueness.

## 2025-12-20 - [PacketParser Checksum Sweep]
**Learning:** `PacketParser` Strategy C (variable length sweep) was O(N²) because it recalculated the full checksum for every candidate length. For standard checksums (add/xor), this can be O(N) using incremental updates.
**Action:** When scanning data streams for variable length packets, always look for rolling/incremental checksum opportunities to avoid O(N²) complexity.

## 2024-12-21 - [Singleton Pattern for Heavy Stateless Components]
**Learning:** `CelExecutor` relies on `cel-js` which has a high initialization cost (creating `Environment`). Since CEL execution is context-driven (stateless per execution), creating an instance per device (N=50+) is wasteful.
**Action:** Use a Singleton pattern (shared static instance) for heavy, stateless utility classes instead of instantiating them per consumer, especially when the utility is used pervasively across the system. This provides O(1) memory usage regardless of N consumers.

## 2025-12-22 - [StateManager Redundant Updates]
**Learning:** `StateManager.handleStateUpdate` was serializing every state update to JSON (`JSON.stringify`) to compare against a cache, even when the update contained identical values (e.g. steady sensor readings). This created unnecessary CPU overhead in the hot path.
**Action:** Implement a shallow equality check for incoming partial updates against the current state before attempting serialization. This serves as a fast path for the 99% case of steady-state updates, while preserving correctness for reference types.
