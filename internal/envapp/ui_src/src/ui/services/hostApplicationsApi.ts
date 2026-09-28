import { readSessionEvents } from './sessionHTTP';
import { fetchLocalApi, fetchLocalApiJSON } from './localApi';
import type { HostApplicationTransferPlan } from '../../../../../../desktop/src/shared/hostApplicationComponents';
export type { HostApplicationTransferPlan };

export type HostApplicationSetup = Readonly<{
  state: 'available' | 'checking' | 'downloading' | 'receiving' | 'verifying' | 'installing' | 'validating' | 'ready' | 'failed' | 'cancelled' | 'interrupted' | 'unsupported';
  operation_id?: string;
  received_bytes: number;
  expected_bytes: number;
  error_code?: string;
  launch_diagnostic?: {code: string; stage: string; exit_code?: number};
  can_cancel: boolean;
  installed?: Readonly<{ id: string; digest: string; architecture: 'amd64' | 'arm64'; contract: string; ready: boolean }>;
  update_available?: boolean;
  installation_error_code?: string;
  package?: Readonly<{ id: string; digest?: string; architecture: 'amd64' | 'arm64'; size_bytes: number; installed_bytes: number }>;
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
  backend?: 'macos' | 'linux' | 'wayland';
  existing_application?: boolean;
  mode?: 'native' | 'stream';
  end_reason?: 'application_exited' | 'windows_closed' | 'sharing_stopped';
  error_code?: string;
  started_at_unix_ms: number;
  forward?: { forward: { forward_id: string; target_url: string }; app_path: string; ephemeral: boolean };
}>;

export type RunningHostApplication = Readonly<{ application_id: string; instances: string[] }>;

export type HostApplicationCatalog = Readonly<{
  availability: { backend?: 'macos' | 'linux' | 'wayland'; native_ready?: boolean; permissions?: {screen_recording: boolean; accessibility: boolean}; supported: boolean; ready: boolean; reason?: string; version?: string; requirements?: string[] };
  applications: HostApplication[];
  sessions: HostApplicationSession[];
  running?: RunningHostApplication[];
}>;

export type HostApplicationPresentation = Readonly<{
  noWindow?: string;
  browserProfileUnavailable?: string;
  nativePictureHint?: string;
  pictureUpgradeHint?: string;
  packageUnavailable?: string;
  hostServiceUnavailable?: string;
  graphicsUnavailable?: string;
  planStale?: string;
  packageUnsupported?: string;
  clipboardUnavailable?: string;
  shellTheme?: string;
  checking?: string;
  applicationExited?: string;
  applicationExitedHint?: string;
  windowsClosed?: string;
  windowsClosedHint?: string;
  sharingStopped?: string;
  sharingStoppedHint?: string;
  endedHint?: string;
  sessionMissing?: string;
  sessionMissingHint?: string;
  accessRequired?: string;
  accessHint?: string;
  dismiss?: string;

  permissionRequired?: string;
  permissionHint?: string;
  sessionUnavailable?: string;
  sessionHint?: string;
  sessionFailed?: string;
  reopenHint?: string;
  captureHint?: string;

  quit?: string;
  quitTitle?: string;
  quitDescription?: string;
  quitPending?: string;
  quitFailed?: string;
  cancel?: string;
  controls?: string;
  picturePixels?: string;
  picture?: string;
  pictureAuto?: string;
  pictureClarity?: string;
  pictureSmooth?: string;
  pictureData?: string;
  pictureHint?: string;
  pictureBackendLimitHint?: string;
  inputUnsupported?: string;
  inputUnsupportedHint?: string;
  viewerPreparationFailed?: string;
  viewerPreparationHint?: string;
  pictureRenderResolution?: string;
  pictureLimited?: string;
  pictureDisplayLimitHint?: string;
  pictureDensityLimitHint?: string;
  pictureAdvanced?: string;
  pictureResolution?: string;
  pictureFrameRate?: string;
  pictureActualRate?: string;
  pictureBandwidth?: string;
  pictureTransport?: string;
  pictureVideo?: string;
  pictureImages?: string;
  videoDecoding?: string;
  videoAvailable?: string;
  videoUnavailable?: string;
  httpsPerformanceHint?: string;
  operationFailed?: string;
  waiting?: string;
  waitingHint?: string;
  captureUnavailable?: string;
  menu?: string;
  windows?: string;
  closeWindow?: string;
  sharedControl?: string;
  input?: string;
  keyboard?: string;
  touchHelp?: string;
  touchHelpTitle?: string;
  touchHelpDescription?: string;
  inputUnavailable?: string;
  inputUnavailableHint?: string;
  inputVersionUnsupported?: string;
  inputVersionHint?: string;
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

export function listRunningHostApplications(signal?: AbortSignal) {
  return fetchLocalApiJSON<RunningHostApplication[]>(`${base}/running`, { method: 'GET', signal });
}

export function quitHostApplication(applicationID: string, instances: string[]) {
  return fetchLocalApiJSON(`${base}/quit`, { method: 'POST', body: JSON.stringify({ application_id: applicationID, instances }) });
}

export function terminateHostApplication(applicationID: string, instances: string[]) {
  return fetchLocalApiJSON(`${base}/terminate`, { method: 'POST', body: JSON.stringify({ application_id: applicationID, instances }) });
}

export function detachHostApplication(sessionID: string) {
  return fetchLocalApiJSON(`${base}/sessions/${encodeURIComponent(sessionID)}/detach`, { method: 'POST' });
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

export function getHostApplicationTransferPlan(signal?: AbortSignal) {
  return fetchLocalApiJSON<HostApplicationTransferPlan>(`${base}/setup/plan`, { method: 'GET', signal });
}

export function startHostApplicationSetup(requestID: string, source: 'download' | 'upload' | 'cache' = 'download', sizeBytes = 0, packageDigest?: string) {
  return fetchLocalApiJSON<HostApplicationSetup>(`${base}/setup`, { method: 'POST', body: JSON.stringify({ request_id: requestID, source, size_bytes: sizeBytes, package_digest: packageDigest }) });
}

export function cancelHostApplicationSetup(operationID: string) {
  return fetchLocalApiJSON<HostApplicationSetup>(`${base}/setup/${encodeURIComponent(operationID)}`, { method: 'DELETE' });
}

export async function observeHostApplicationSetup(onUpdate: (setup: HostApplicationSetup) => void, signal: AbortSignal) {
  for await (const event of readSessionEvents(`${base}/setup/events`, {
    signal,
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
