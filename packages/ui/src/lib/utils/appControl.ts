/**
 * Initiates a system restart by fetching a token and sending a restart request.
 * Automatically reloads the window after a successful request.
 *
 * @param delayMs - Delay in milliseconds before reloading the window (default: 5000)
 * @returns Promise that resolves when the restart request is successful (before reload)
 * @throws Error if the token fetch or restart request fails
 */
export async function triggerSystemRestart(delayMs = 5000): Promise<void> {
  // 1. Get One-time Token
  const tokenRes = await fetch('./api/system/restart/token');
  if (!tokenRes.ok) throw new Error('Failed to get restart token');
  const { token } = await tokenRes.json();

  // 2. Send Restart Request with Token
  const res = await fetch('./api/system/restart', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Restart failed');
  }

  // 3. Reload Page
  if (delayMs >= 0) {
    setTimeout(() => {
      window.location.reload();
    }, delayMs);
  }
}
