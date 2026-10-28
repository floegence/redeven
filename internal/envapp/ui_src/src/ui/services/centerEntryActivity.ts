/** Input, not output or keepalive traffic, extends a verified Center device. */
export function installCenterEntryActivity(onExpired: () => void, onExpiring?: () => void): () => void {
  const lifetime = new AbortController();
  let lastInput = 0;
  let pending = false;
  let ended = false;
  let warned = false;
  async function request(activity: boolean) {
    if (pending || ended) return;
    pending = true;
    try {
      const response = await fetch(activity ? '/__center/activity' : '/__center/session', {
        credentials: 'same-origin', cache: 'no-store', signal: lifetime.signal,
        ...(activity ? { method: 'POST', headers: { 'X-Redeven-Activity': 'user-input' } } : {}),
      });
      if (response.status === 401 || response.status === 403) { ended = true; onExpired(); }
      else if (response.ok && onExpiring) {
        const result = await response.json() as { data?: { expires_at?: number; device?: { expires_at?: number } } };
        const expiry = activity ? result.data?.expires_at : result.data?.device?.expires_at;
        if (typeof expiry === 'number') {
          const expiring = expiry - Date.now() < 5 * 60_000;
          if (expiring && !warned) onExpiring();
          warned = expiring;
        }
      }
    } catch { /* A network interruption never extends authority or logs out the Runtime. */ }
    finally { pending = false; }
  }
  function input(event: Event) {
    if (!event.isTrusted || document.visibilityState !== 'visible' || Date.now() - lastInput < 30_000) return;
    lastInput = Date.now();
    void request(true);
  }
  function wake() { if (document.visibilityState === 'visible') void request(false); }
  document.addEventListener('pointerdown', input, { passive: true });
  document.addEventListener('keydown', input);
  document.addEventListener('visibilitychange', wake);
  const timer = window.setInterval(wake, 30_000);
  void request(false);
  return () => {
    lifetime.abort(); window.clearInterval(timer);
    document.removeEventListener('pointerdown', input);
    document.removeEventListener('keydown', input);
    document.removeEventListener('visibilitychange', wake);
  };
}
