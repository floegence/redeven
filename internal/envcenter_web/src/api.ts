import { centerEndpoints, validateCenterContract } from './contracts.generated';
export class CenterError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const endpoint = path.split('?')[0];
  const contract = centerEndpoints[endpoint as keyof typeof centerEndpoints];
  if (!contract) throw new CenterError('CENTER_INVALID_TARGET', 400);
  if (body !== undefined && contract[0]) validateCenterContract(contract[0], body);
  const options: RequestInit = {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', 'X-Redeven-Center': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  // Only requests with a server-owned idempotency contract can recover a lost
  // response. Reuse the exact body and grant/request identity, never reauthorize.
  const replaySafe = body === undefined || new Set([
    'open', 'operations/cancel', 'gateways/begin', 'gateways/complete', 'routes/add',
    'routes/rotate', 'bookmarks/add', 'sources/remove', 'factor/replace', 'recovery/rotate',
    'setup/start', 'setup/verify', 'setup/commit', 'setup/cancel',
  ]).has(path);
  let response: Response;
  try { response = await fetch('/api/center/v1/' + path, options); }
  catch (error) {
    if (!replaySafe || signal?.aborted) throw error;
    response = await fetch('/api/center/v1/' + path, options);
  }
  const result = await response.json() as { ok: boolean; data: T; error?: { code: string } };
  if (!response.ok || !result.ok) throw new CenterError(result.error?.code ?? 'CENTER_REQUEST_FAILED', response.status);
  validateCenterContract(contract[1], result.data);
  return result.data;
}
export async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export async function actionDigest(kind: string, value: unknown): Promise<string> { return kind + ':' + await digest(JSON.stringify(value)); }
export async function passwordAction(password: string, device: string): Promise<string> {
  if (!device) throw new CenterError('CENTER_AUTH_REQUIRED', 401);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: new TextEncoder().encode('redeven:center:password:' + device) }, key, 256);
  return 'password:pbkdf2-sha256-v1:' + btoa(String.fromCharCode(...new Uint8Array(bits))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export type { AuditEvent, Device, Status, Source, Route, Directory, Member, Catalog, Operation, Setup } from './contracts.generated';
