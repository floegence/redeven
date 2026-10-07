import { fetchSessionJSON } from './sessionHTTP';

const api = '/_redeven_proxy/api/remote-desktop';
export type DesktopDisplay = { id: string; name: string; width: number; height: number; scale: number; primary: boolean };
export type DesktopAuthorization = 'unsupported' | 'needs_consent' | 'saved' | 'restoring' | 'revoked' | 'unknown';
export type LoginServiceStatus = { state: 'unsupported' | 'not_installed' | 'authorization_required' | 'installing' | 'active' | 'failed' | 'uninstalling'; reason?: string; backend?: string };
export type RemoteDesktopStatus = {
  capabilities: { backend: string; state: string; authorization?: DesktopAuthorization; reason?: string; screen: boolean; input: boolean; audio: boolean; clipboard: boolean; unattended?: boolean; unlock?: boolean; displays: DesktopDisplay[] };
  unattended: boolean;
  approval_policy?: 'persistent' | 'session';
  control_in_use: boolean;
  last_display_id: string;
  setup?: { state: string; received_bytes: number; expected_bytes: number; can_cancel: boolean; error_code?: string; operation_id?: string };
  login_service?: LoginServiceStatus;
};
export type RemoteDesktopSession = { id: string; forward_id: string; target_url: string; mode: 'view' | 'control'; display_id: string; locale: string; theme: string; host_name: string };
export const getRemoteDesktopStatus = () => fetchSessionJSON<RemoteDesktopStatus>(api, { method: 'GET' });
export const prepareRemoteDesktop = () => fetchSessionJSON(api + '/setup', { method: 'POST', body: JSON.stringify({ request_id: crypto.randomUUID() }) });
export const cancelRemoteDesktopPreparation = (id: string) => fetchSessionJSON(api + '/setup/' + encodeURIComponent(id), { method: 'DELETE' });
export const setRemoteDesktopUnattended = (unattended: boolean) => fetchSessionJSON(api + '/settings', { method: 'PUT', body: JSON.stringify({ unattended }) });
export const createRemoteDesktop = (request: Omit<RemoteDesktopSession, 'id' | 'forward_id' | 'target_url'> & { takeover: boolean }) => fetchSessionJSON<RemoteDesktopSession>(api + '/sessions', { method: 'POST', body: JSON.stringify(request) });
export const disconnectRemoteDesktop = (id: string) => fetchSessionJSON(api + '/sessions/' + encodeURIComponent(id), { method: 'DELETE' });

export const forgetRemoteDesktopAuthorization = () => fetchSessionJSON(api + '/authorization', { method: 'DELETE' });
export const installRemoteDesktopLoginService = () => fetchSessionJSON<LoginServiceStatus>(api + '/service/install', { method: 'POST', body: '{}' });
export const cancelRemoteDesktopLoginService = () => fetchSessionJSON<LoginServiceStatus>(api + '/service/install', { method: 'DELETE' });
export const uninstallRemoteDesktopLoginService = () => fetchSessionJSON<LoginServiceStatus>(api + '/service', { method: 'DELETE' });
