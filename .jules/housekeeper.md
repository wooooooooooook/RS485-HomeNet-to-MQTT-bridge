# Housekeeper's Journal

## 2025-05-21 - [Untyped Event Bus]
**Observation:** The global `eventBus` (EventEmitter) was untyped, leading to implicit `any` in consumers and causing bugs (e.g., `mqtt-message` having `payload` vs `message` mismatch).
**Action:** Defined explicit interfaces (`StateChangedEvent`, `MqttMessageEvent`) in `core` and typed the consumers to enforce correctness.

## 2025-12-19 - Dead Code Confusion
**Observation:** Found a `packages/core/src/protocol/parsers` directory containing a `PacketParser` class that mirrored the active `packages/core/src/protocol/packet-parser.ts`. This duplication creates ambiguity for maintenance.
**Action:** When performing major refactors (like the move to `ProtocolManager`), strictly delete or explicitly archive legacy files to prevent "zombie code".
