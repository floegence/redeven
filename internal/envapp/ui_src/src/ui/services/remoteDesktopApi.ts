import { fetchSessionJSON } from './sessionHTTP';

const api = '/_redeven_proxy/api/remote-desktop';
export type DesktopDisplay = { id: string; name: string; width: number; height: number; scale: number; primary: boolean };
export type RemoteDesktopStatus = {
  capabilities: { backend: string; state: string; reason?: string; screen: boolean; input: boolean; audio: boolean; clipboard: boolean; unattended?: boolean; unlock?: boolean; displays: DesktopDisplay[] };
  unattended: boolean;
  control_in_use: boolean;
  last_display_id: string;
  setup?: { state: string; received_bytes: number; expected_bytes: number; can_cancel: boolean; error_code?: string; operation_id?: string };
};
export type RemoteDesktopSession = { id: string; forward_id: string; target_url: string; mode: 'view' | 'control'; display_id: string; locale: string; theme: string; host_name: string };
export const getRemoteDesktopStatus = () => fetchSessionJSON<RemoteDesktopStatus>(api, { method: 'GET' });
export const prepareRemoteDesktop = () => fetchSessionJSON(api + '/setup', { method: 'POST', body: JSON.stringify({ request_id: crypto.randomUUID() }) });
export const cancelRemoteDesktopPreparation = (id: string) => fetchSessionJSON(api + '/setup/' + encodeURIComponent(id), { method: 'DELETE' });
export const setRemoteDesktopUnattended = (unattended: boolean) => fetchSessionJSON(api + '/settings', { method: 'PUT', body: JSON.stringify({ unattended }) });
export const createRemoteDesktop = (request: Omit<RemoteDesktopSession, 'id' | 'forward_id' | 'target_url'> & { takeover: boolean }) => fetchSessionJSON<RemoteDesktopSession>(api + '/sessions', { method: 'POST', body: JSON.stringify(request) });
export const disconnectRemoteDesktop = (id: string) => fetchSessionJSON(api + '/sessions/' + encodeURIComponent(id), { method: 'DELETE' });
