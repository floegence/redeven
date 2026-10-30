type OriginPreparation = Readonly<{ origin: string; parentOrigin: string; signal: AbortSignal }>;

// This only prepares Center routing. It never receives a platform entry token
// or changes the SDK-owned iframe URL, handshake, permissions, or revocation.
export async function prepareCenterPluginOrigin(request: OriginPreparation): Promise<void> {
  request.signal.throwIfAborted();
  if (request.parentOrigin !== window.location.origin) throw new Error('CENTER_INVALID_TARGET');
  const child = new URL(request.origin);
  const parent = new URL(request.parentOrigin);
  if (child.origin !== request.origin || child.protocol !== 'https:' || child.port !== parent.port
    || !/^[a-f0-9]{48}$/.test(child.hostname.split('.')[0])
    || child.hostname.slice(child.hostname.indexOf('.') + 1) !== parent.hostname.slice(parent.hostname.indexOf('.') + 1)) {
    throw new Error('CENTER_INVALID_TARGET');
  }
  const options: RequestInit = {
    credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Redeven-Center': '1' },
    body: JSON.stringify({ origin: request.origin }),
  };
  const release = async () => {
    try { await fetch('/__center/plugin-origins', { ...options, method: 'DELETE', keepalive: true, signal: AbortSignal.timeout(15_000) }); }
    catch { /* Parent expiry removes routing; platform revocation still denies resources. */ }
  };
  // Await preparation even if the surface closes in flight, then remove the
  // exact prepared route. Aborting fetch first could lose a committed response.
  try {
    const response = await fetch('/__center/plugin-origins', { ...options, method: 'POST', signal: AbortSignal.timeout(15_000) });
    const result = await response.json() as { ok?: boolean; error?: { code?: string } };
    if (!response.ok || !result.ok) throw new Error(result.error?.code ?? 'CENTER_APPLICATION_UNAVAILABLE');
  }
  catch (error) { await release(); throw error; }
  if (request.signal.aborted) { await release(); request.signal.throwIfAborted(); }
  request.signal.addEventListener('abort', () => { void release(); }, { once: true });
}
