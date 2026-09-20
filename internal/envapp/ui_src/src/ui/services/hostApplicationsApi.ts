import { fetchLocalApiJSON } from './localApi';

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

export type HostApplicationPresentation = Readonly<{ menu?: string; windows?: string; closeWindow?: string; sharedControl?: string; input?: string; locale: string; connecting: string; reconnecting: string; disconnected: string; connectionHint: string; reconnect: string; starting: string; failed: string; ended: string; retry: string }>;

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
