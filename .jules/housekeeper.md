## 2025-12-22 - Loose Typing in Configuration Interfaces
**Observation:** Configuration interfaces (like `EntityConfig`) often use `any` for nested objects (like `packet_parameters`) even when specific types (like `PacketDefaults`) exist in the codebase. This reduces the effectiveness of TypeScript for config validation.
**Action:** When touching configuration files, check if `any` fields correspond to existing types in `protocol/types.ts` or similar files and tighten the definition.
