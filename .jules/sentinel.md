## 2025-12-18 - Unauthenticated RCE via !lambda
**Vulnerability:** The application executes `!lambda` scripts using `node:vm` which is not a security boundary. Since there is no authentication on the `/api/config/update` endpoint, anyone can inject malicious code.
**Learning:** In "Addon" architectures, relying solely on network ingress for security creates a fragile defense. The application itself has no defense against a compromised or misconfigured network layer.
**Prevention:** Proper authentication middleware is required. Blocking `!lambda` via API breaks potential functionality but would mitigate RCE.

## 2024-05-21 - Unprotected Resource Intensive Operations
**Vulnerability:** The `/api/bridge/:portId/latency-test` endpoint triggers a long-running (up to 200s), state-modifying process without authentication or rate limiting. This allows for trivial Denial of Service and Race Conditions.
**Learning:** Endpoints that trigger physical device interaction or complex state machines must be strictly rate-limited, even in local/trusted networks, to prevent state corruption and resource exhaustion.
**Prevention:** Apply specific `RateLimiter` instances to all side-effecting or heavy-computation endpoints.

## 2025-12-22 - Missing Rate Limiting on Config Operations
**Vulnerability:** Several state-modifying endpoints (`rename`, `revoke-discovery`, `delete entity`, `log-consent`) lacked rate limiting. While individually low-risk, they allowed unrestricted file system writes (backups) and resource consumption.
**Learning:** Even "administrative" or "rarely used" endpoints must be protected against abuse. Relying on obscurity or "it's just a config tool" is insufficient.
**Prevention:** Apply `RateLimiter` middleware consistently to ALL state-modifying endpoints (POST/PUT/DELETE/PATCH), grouping them by function (e.g., `configRateLimiter`).
