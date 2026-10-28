/** Only a verified Center runtime profile selects this entry path. Runtime
 * permissions stay authoritative; browser results are exact HTTPS siblings. */
export async function prepareCenterApplication(kind: 'cs' | 'pf', id: string, path = '/'): Promise<string> {
  const options: RequestInit = {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Redeven-Center': '1' },
    body: JSON.stringify({ kind, id, path, request_id: crypto.randomUUID() }),
  };
  let response: Response;
  try { response = await fetch('/__center/applications', options); }
  catch { response = await fetch('/__center/applications', options); }
  const result = await response.json() as { ok?: boolean; data?: { destination?: string; origin?: string }; error?: { code?: string } };
  if (!response.ok || !result.ok || !result.data?.destination || !result.data.origin) throw new Error(result.error?.code ?? 'CENTER_APPLICATION_UNAVAILABLE');
  const destination = new URL(result.data.destination);
  const current = new URL(window.location.href);
  const suffix = current.hostname.slice(current.hostname.indexOf('.') + 1);
  if (destination.protocol !== 'https:' || destination.origin !== result.data.origin || destination.port !== current.port
    || !/^app-[a-f0-9]{40}$/u.test(destination.hostname.split('.')[0])
    || destination.hostname.slice(destination.hostname.indexOf('.') + 1) !== suffix
    || destination.pathname !== '/__center/start' || destination.username || destination.password || destination.hash) {
    throw new Error('CENTER_INVALID_TARGET');
  }
  return destination.href;
}
