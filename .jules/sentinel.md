## 2024-05-24 - [Memory Leak in Packet Dictionary]
**Vulnerability:** The `LogRetentionService` and `server.ts` maintained a `packetDictionary` map that grew indefinitely with every unique packet payload received. In a long-running service, especially with devices sending timestamped or encrypted data, this would lead to an Out-Of-Memory (OOM) crash (Denial of Service).
**Learning:** Shared mutable state (like the `packetDictionary` Map) passed between modules can obscure ownership and make cleanup logic difficult to implement safely. Specifically, `server.ts` owned the map but `LogRetentionService` populated it, and neither took responsibility for pruning it.
**Prevention:**
1.  **Clear Ownership:** Assign ownership of data structures to the service that primarily manages them (`LogRetentionService`).
2.  **Lifecycle Management:** Implement pruning/cleanup logic for any unbounded collection (Map/Set/Array) that receives external input.
3.  **Monotonic Counters:** When generating IDs for items that might be pruned, use a monotonic counter instead of `size + 1` to avoid ID collisions if items are removed.

## 2025-12-27 - [Hardcoded API Key Fallback]
**Vulnerability:** A hardcoded string `'h2m-log-collector-is-cool'` was used as a fallback for the `LOG_COLLECTOR_API_KEY` environment variable. This meant that if the environment variable was missing, the service would default to using this insecure, publicly visible string as an API key.
**Learning:** Fallback values for security credentials can silently downgrade security. Developers might assume a secure environment variable is being used, while the system is actually running with a compromised default.
**Prevention:**
1.  **Fail Securely:** Do not provide default values for secrets. If a required secret is missing, the feature should explicitly fail or disable itself with a warning.
2.  **Explicit Configuration:** Force the user/administrator to provide credentials explicitly via environment variables or secure configuration stores.

## 2025-12-28 - [Directory Prefix Path Traversal]
**Vulnerability:** The log download endpoints (`/api/logs/packet/download/:filename` etc.) validated file paths using `startsWith` without a trailing path separator (e.g., `path.startsWith('/config/logs')`). This allowed attackers to access files in sibling directories that shared the same prefix (e.g., `/config/logs_secret.txt`).
**Learning:** `startsWith` is a string comparison, not a path structure comparison. When validating directory containment, simply checking if path A starts with path B is insufficient because it ignores path boundaries.
**Prevention:**
1.  **Trailing Separator:** Always append `path.sep` to the allowed directory path when using `startsWith` for validation (e.g., `allowedPath + path.sep`).
2.  **Path Normalization:** Use `path.resolve` or `path.normalize` on both the target and allowed paths before comparison to handle `..` and redundant separators.
3.  **Relative Path Check:** Alternatively, check if `path.relative(allowed, target)` starts with `..` or is absolute, which explicitly checks hierarchy.
