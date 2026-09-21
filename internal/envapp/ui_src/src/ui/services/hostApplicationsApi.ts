import { fetchLocalApi, fetchLocalApiJSON } from './localApi';

export type HostApplicationSetup = Readonly<{
  state: 'available' | 'checking' | 'downloading' | 'receiving' | 'verifying' | 'installing' | 'validating' | 'ready' | 'failed' | 'cancelled' | 'interrupted' | 'unsupported';
  operation_id?: string;
  received_bytes: number;
  expected_bytes: number;
  error_code?: string;
  can_cancel: boolean;
  package?: Readonly<{ id: string; architecture: 'amd64' | 'arm64'; size_bytes: number; installed_bytes: number }>;
}>;

export function hostApplicationSetupActive(setup: HostApplicationSetup | null | undefined): boolean {
  return Boolean(setup && ['checking', 'downloading', 'receiving', 'verifying', 'installing', 'validating'].includes(setup.state));
}

export type HostApplication = Readonly<{
  id: string;
  name: string;
  description: string;
  categories: string[];
  icon: string;
  custom: boolean;
}>;

export type HostApplicationSession = Readonly<{
  id: string;
  application: HostApplication;
  state: 'starting' | 'running' | 'ended' | 'failed' | 'opened';
  backend?: 'macos';
  existing_application?: boolean;
  mode?: 'native' | 'stream';
  error_code?: string;
  started_at_unix_ms: number;
  forward?: { forward: { forward_id: string; target_url: string }; app_path: string; ephemeral: boolean };
}>;

export type HostApplicationCatalog = Readonly<{
  availability: { backend?: 'macos'; native_ready?: boolean; permissions?: {screen_recording: boolean; accessibility: boolean}; supported: boolean; ready: boolean; reason?: string; version?: string; requirements?: string[] };
  applications: HostApplication[];
  sessions: HostApplicationSession[];
}>;

export type HostApplicationPresentation = Readonly<{
  permissionRequired?: string;
  permissionHint?: string;
  sessionUnavailable?: string;
  sessionHint?: string;
  sessionFailed?: string;
  reopenHint?: string;
  captureHint?: string;

  controls?: string;
  picturePixels?: string;
  picture?: string;
  pictureAuto?: string;
  pictureClarity?: string;
  pictureSmooth?: string;
  pictureData?: string;
  pictureHint?: string;
  pictureAdvanced?: string;
  pictureResolution?: string;
  pictureFrameRate?: string;
  pictureActualRate?: string;
  pictureBandwidth?: string;
  pictureTransport?: string;
  pictureVideo?: string;
  pictureImages?: string;
  operationFailed?: string;
  waiting?: string;
  waitingHint?: string;
  captureUnavailable?: string;
  menu?: string;
  windows?: string;
  closeWindow?: string;
  sharedControl?: string;
  input?: string;
  locale: string;
  connecting: string;
  reconnecting: string;
  disconnected: string;
  connectionHint: string;
  reconnect: string;
  starting: string;
  failed: string;
  ended: string;
  retry: string;
}>;

const base = '/_redeven_proxy/api/host-applications';

export function listHostApplications(locale: string, signal?: AbortSignal) {
  return fetchLocalApiJSON<HostApplicationCatalog>(`${base}?locale=${encodeURIComponent(locale)}`, { method: 'GET', signal });
}

export function launchHostApplication(applicationID: string, locale: string, presentation: HostApplicationPresentation, mode: 'native' | 'stream' = 'stream') {
  return fetchLocalApiJSON<HostApplicationSession>(`${base}/sessions`, {
    method: 'POST', body: JSON.stringify({ application_id: applicationID, locale, presentation, mode }),
  });
}

export function stopHostApplication(sessionID: string) {
  return fetchLocalApiJSON(`${base}/sessions/${encodeURIComponent(sessionID)}`, { method: 'DELETE' });
}

export function addHostApplication(request: { name: string; executable: string; arguments: string }) {
  return fetchLocalApiJSON(base, { method: 'POST', body: JSON.stringify(request) });
}

export function listHostApplicationSessions(signal?: AbortSignal) {
 return fetchLocalApiJSON<HostApplicationSession[]>(`${base}/sessions`, { method: 'GET', signal });
}

export function requestHostApplicationPermission(permission: 'screen_recording' | 'accessibility') {
  return fetchLocalApiJSON(`${base}/permissions`, {method: 'POST', body: JSON.stringify({permission})});
}

export function getHostApplicationSetup(signal?: AbortSignal) {
  return fetchLocalApiJSON<HostApplicationSetup>(`${base}/setup`, { method: 'GET', signal });
}

export function startHostApplicationSetup(requestID: string, source: 'download' | 'upload' = 'download', sizeBytes = 0) {
  return fetchLocalApiJSON<HostApplicationSetup>(`${base}/setup`, { method: 'POST', body: JSON.stringify({ request_id: requestID, source, size_bytes: sizeBytes }) });
}

export function cancelHostApplicationSetup(operationID: string) {
  return fetchLocalApiJSON<HostApplicationSetup>(`${base}/setup/${encodeURIComponent(operationID)}`, { method: 'DELETE' });
}

export async function observeHostApplicationSetup(onUpdate: (setup: HostApplicationSetup) => void, signal: AbortSignal) {
  const { fetchServerSentEvents } = await import('@floegence/floe-webapp-boot');
  for await (const event of fetchServerSentEvents(`${base}/setup/events`, {
    signal, fetch: (url, init) => fetchLocalApi(String(url), init),
    maxFrameBytes: 16 * 1024, maxBufferBytes: 32 * 1024,
  })) {
    if (event.event === 'setup') onUpdate(JSON.parse(event.data) as HostApplicationSetup);
  }
  if (!signal.aborted) throw new Error('Host application preparation stream ended.');
}

export async function uploadHostApplicationSetup(operationID: string, file: Blob | { size: number; read: (offset: number) => Promise<Blob> }, signal: AbortSignal) {
  const url = `${base}/setup/${encodeURIComponent(operationID)}`;
  const chunkSize = 256 * 1024;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const response = await fetchLocalApi(`${url}/content?offset=${offset}`, {
      method: 'PUT', body: 'read' in file ? await file.read(offset) : file.slice(offset, offset + chunkSize), signal,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    if (!response.ok) throw new Error('Host application component transfer failed.');
  }
  return fetchLocalApiJSON<HostApplicationSetup>(`${url}/complete`, { method: 'POST', signal });
}
