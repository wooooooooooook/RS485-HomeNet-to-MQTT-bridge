## 2026-01-04 - PacketParser Strategy C Optimization
**Learning:** Packet parsing with unknown length (Strategy C) is O(N^2) by default because it re-calculates the checksum for every possible length. For standard checksums (like `xor_add`), commutative properties allow O(N) incremental updates.
**Action:** Always look for incremental calculation opportunities in sliding window or variable-length scanning algorithms.

## 2026-01-04 - PacketParser Optimization Regression
**Learning:** When optimizing a specific path (e.g., 2-byte checksums), ensure the optimization doesn't inadvertently bypass other required checks (e.g., a simultaneous 1-byte checksum) that were handled by the generic fallback logic.
**Action:** Always check for compound configurations (e.g., both checksums active) when creating "fast paths".
