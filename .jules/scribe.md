# Scribe's Journal

## 2024-05-24 - Initial Journal Creation
**Learning:** The journal file was missing.
**Action:** Created the journal to track critical documentation learnings.

## 2024-05-24 - Checksum Algorithm Documentation Gaps
**Learning:** The 'xor_add' checksum algorithm implies a simple combination of XOR and ADD checksums, but the implementation actually adds the XOR result to the arithmetic sum. Similarly, 'samsung_rx' has a conditional magic byte modification.
**Action:** Explicitly document the mathematical operations for custom/complex algorithms in config-schema docs to aid debugging and 3rd party implementation.
