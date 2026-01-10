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

## 2025-12-31 - [Unprotected Resource Allocation]
**Vulnerability:** The `/api/system/restart/token` endpoint generated a UUID and stored it in a memory set with a timeout for every request, without any rate limiting. An attacker could flood this endpoint to exhaust server memory or create excessive timer objects (DoS).
**Learning:** Even "lightweight" operations (like generating a token) can become Denial of Service vectors if they allocate resources (memory, timers, file handles) based on unauthenticated or unlimited user input.
**Prevention:**
1.  **Rate Limiting:** Apply rate limiting to all public endpoints, especially those that trigger resource allocation.
2.  **Resource Limits:** Set hard limits on the size of collections (e.g., max 1000 active tokens) even if they have TTL cleanup.

## 2026-01-01 - [Credential Leakage in Configuration API]
**Vulnerability:** The `/api/bridge/info` endpoint was exposing the raw `MQTT_URL` environment variable directly to the frontend. Since standard MQTT connection strings can include credentials (e.g., `mqtt://user:password@host`), this configuration pattern would leak the password to any user with access to the dashboard.
**Learning:** Configuration variables that *can* contain secrets (even if they don't *always* contain secrets) must be treated as sensitive. Assuming a specific usage pattern (e.g., "users will use separate user/pass env vars") is dangerous because valid standard formats often violate that assumption.
**Prevention:**
1.  **Mask by Default:** Identify any configuration value that accepts a URL or connection string and apply masking logic to the password component before exposing it via API.
2.  **Defense in Depth:** Even if separate `MQTT_USER`/`MQTT_PASS` variables exist, sanitize the primary connection string to handle all valid input formats securely.

## 2026-01-04 - [Missing Granular Rate Limiting]
**Vulnerability:** The `/api/frontend-settings` (disk write), `/api/gallery/check-conflicts` (YAML parsing), and `/api/gallery/*` (external fetch) endpoints were only protected by the global rate limiter (300 req/min), allowing potential Resource Exhaustion (disk I/O, CPU, network bandwidth).
**Learning:** Global rate limits are often too loose for specific, resource-intensive operations. Different operations have different costs (e.g., in-memory read vs disk write vs external network call) and require granular limits to prevent targeted exhaustion attacks that stay within global limits.
**Prevention:**
1.  **Granular Rate Limiting:** Apply specific, tighter rate limits (e.g., 20/min) to endpoints that consume significant resources (Disk I/O, CPU, External APIs).
2.  **Audit Write Endpoints:** Systematically review all `POST`, `PUT`, `DELETE` endpoints to ensuring they have stricter limits than read endpoints.

## 2026-01-10 - [Path Traversal in File APIs]
**Vulnerability:** The `RawPacketLoggerService` and `LogRetentionService` constructed file paths using user-provided filenames via `path.join` without validation. This allowed attackers to access arbitrary files on the system using `..` sequences (Path Traversal).
**Learning:** `path.join` does not sanitize paths against directory traversal. When handling file paths derived from user input, we must explicitly verify that the resolved path is contained within the intended allowlist directory.
**Prevention:**
1.  **Resolve and Check:** Always use `path.resolve` on the user input and check if it starts with the `path.resolve(baseDir) + path.sep`.
2.  **Helper Utility:** Centralize this logic in a helper function (like `resolveSecurePath`) to ensure consistency across the codebase.
