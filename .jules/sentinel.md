## 2026-01-11 - [WebSocket Max Payload Limit]
**Vulnerability:** The WebSocket server was initialized without a `maxPayload` limit, defaulting to 100MB. This allowed potential Denial of Service (DoS) attacks where an attacker could flood the server with large frames, causing memory exhaustion.
**Learning:** WebSocket libraries often have generous defaults (like 100MB) that are unsafe for production services handling small control messages.
**Prevention:**
1.  **Explicit Limits:** Always set `maxPayload` to the smallest reasonable value for the application's use case (e.g., 64KB for control messages).
2.  **Defense in Depth:** Combine application-level limits (maxPayload) with network-level protection (WAF, rate limiting).
