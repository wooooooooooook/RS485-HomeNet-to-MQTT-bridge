# Scribe's Journal

## 2024-05-24 - Initial Journal Creation
**Learning:** The journal file was missing.
**Action:** Created the journal to track critical documentation learnings.

## 2024-05-24 - Checksum Context Inconsistency
**Learning:** CEL execution contexts for `rx_checksum` and `tx_checksum` differ significantly despite looking similar. Rx context (PacketParser) lacks access to `state`/`states` variables, while Tx context (CommandGenerator) provides them.
**Action:** Always verify the exact arguments passed to `CelExecutor.execute` in the source code before documenting available variables for a feature.
