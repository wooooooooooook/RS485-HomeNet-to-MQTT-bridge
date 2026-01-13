## 2026-01-11 - [WebSocket Max Payload Limit]
**Vulnerability:** The WebSocket server was initialized without a `maxPayload` limit, defaulting to 100MB. This allowed potential Denial of Service (DoS) attacks where an attacker could flood the server with large frames, causing memory exhaustion.
**Learning:** WebSocket libraries often have generous defaults (like 100MB) that are unsafe for production services handling small control messages.
**Prevention:**
1.  **Explicit Limits:** Always set `maxPayload` to the smallest reasonable value for the application's use case (e.g., 64KB for control messages).
2.  **Defense in Depth:** Combine application-level limits (maxPayload) with network-level protection (WAF, rate limiting).

## 2026-01-14 - [Regex DoS/Weakness in Log Masking]
**Vulnerability:** The regex fallback for `maskMqttPassword` was `/:([^:@]+)@/`, which failed to mask passwords containing colons or other special characters when `new URL()` parsing failed (e.g. due to spaces in the URL). This could leak sensitive credentials in logs.
**Learning:**
1.  **Regex Complexity:** Simple regexes often fail on complex inputs (like passwords with special chars). Always assume passwords contain the separator characters you rely on (like `:` or `@`).
2.  **Greedy Matching:** A safer pattern for masking is often `before(.*)after` using greedy matching to consume the sensitive part entirely, rather than trying to match "not separator" (`[^:]+`).
**Prevention:**
Use `/(:\/\/[^:]*:)(.+)(@)/` to anchor to the scheme and first colon, then greedily consume everything until the last `@` for the password group.
