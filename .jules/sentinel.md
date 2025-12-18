## 2025-12-18 - Unauthenticated RCE via !lambda
**Vulnerability:** The application executes `!lambda` scripts using `node:vm` which is not a security boundary. Since there is no authentication on the `/api/config/update` endpoint, anyone can inject malicious code.
**Learning:** In "Addon" architectures, relying solely on network ingress for security creates a fragile defense. The application itself has no defense against a compromised or misconfigured network layer.
**Prevention:** Proper authentication middleware is required. Blocking `!lambda` via API breaks potential functionality but would mitigate RCE.
