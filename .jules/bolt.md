## 2025-12-14 - [PacketParser Allocations]
**Learning:** `PacketParser.parse` runs for every byte. Intermediate `Buffer.from()` calls for checksum validation created significant overhead (approx 50% of parsing time) in the hot path.
**Action:** Use `number[]` or generic `ByteArray` interfaces to avoid unnecessary object creation in hot paths like serial data parsing.

## 2025-12-18 - [PacketParser Footer Search]
**Learning:** `Buffer.indexOf` provides massive speedup (~7x) for scanning specific byte sequences (footers) compared to manual nested loops, but only for sequences with low probability of random occurrence (e.g. 4+ bytes). For short sequences (2 bytes) in random data, the improvement is negligible due to frequent false positive matches requiring subsequent validation.
**Action:** Prefer `Buffer.indexOf` for searching headers/footers, but be aware that its effectiveness scales with sequence uniqueness.
