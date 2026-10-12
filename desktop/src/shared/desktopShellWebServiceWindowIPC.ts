export const MANAGED_ENTRANCE_REQUEST = 'redeven-desktop:managed-entrance-request';
export const MANAGED_ENTRANCE_CANCEL = 'redeven-desktop:managed-entrance-cancel';
export const MANAGED_ENTRANCE_RESPONSE = 'redeven-desktop:managed-entrance-response';
export type ManagedEntrancePreparationRequest = Readonly<{ request_id: string; service_id: string; refresh: boolean; cancel?: boolean }>;

export const DESKTOP_SHELL_OPEN_WEB_SERVICE_WINDOW_CHANNEL = 'redeven-desktop:shell-open-web-service-window';

export type WebServiceAccessMode = 'unified_proxy' | 'desktop_loopback';
export type ForwardWindowPresentation = 'browser' | 'application' | 'desktop';

export type ManagedWebEntranceContext = Readonly<{service_id: string; launch_generation: string}>;

export type DesktopShellOpenWebServiceWindowRequest = Readonly<{
  url: string;
  forward_id: string;
  target_url: string;
  access_mode?: WebServiceAccessMode;
  presentation?: ForwardWindowPresentation;
  preparation_id?: string;
  managed_entrance?: ManagedWebEntranceContext;
}>;

export type NormalizedDesktopShellOpenWebServiceWindowRequest = Readonly<{
  url: string;
  forward_id: string;
  target_url: string;
  access_mode: WebServiceAccessMode;
  presentation: ForwardWindowPresentation;
  preparation_id?: string;
  managed_entrance?: ManagedWebEntranceContext;
}>;

export type DesktopShellOpenWebServiceWindowResponse = Readonly<{
  ok: boolean;
  message?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function isLoopbackTargetOrigin(targetURL: URL): boolean {
  if (!targetURL.port || targetURL.pathname !== '/' || targetURL.search || targetURL.hash) return false;
  const hostname = targetURL.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  const octets = hostname.split('.');
  return octets.length === 4
    && octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255)
    && octets[0] === '127';
}

export function normalizeDesktopShellOpenWebServiceWindowRequest(value: unknown): NormalizedDesktopShellOpenWebServiceWindowRequest | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const forwardID = compact(candidate.forward_id);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u.test(forwardID)) return null;

  try {
    const url = new URL(compact(candidate.url));
    const targetURL = new URL(compact(candidate.target_url));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (targetURL.protocol !== 'http:' && targetURL.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (targetURL.username || targetURL.password) return null;
    if (!isLoopbackTargetOrigin(targetURL)) return null;
    const accessMode = compact(candidate.access_mode) || 'unified_proxy';
    if (accessMode !== 'unified_proxy' && accessMode !== 'desktop_loopback') return null;
    if (accessMode === 'desktop_loopback' && targetURL.protocol !== 'http:') return null;
    const presentation = compact(candidate.presentation) || 'browser';
    if (presentation !== 'browser' && presentation !== 'application' && presentation !== 'desktop') return null;
    const preparationID = compact(candidate.preparation_id);
    if (preparationID && (presentation !== 'application' || !/^[a-f0-9-]{36}$/u.test(preparationID))) return null;
    let managedEntrance: ManagedWebEntranceContext | undefined;
    if (candidate.managed_entrance !== undefined) {
      const entrance = candidate.managed_entrance as Partial<ManagedWebEntranceContext> | null;
      if (!entrance || !/^[a-zA-Z0-9_-]{1,128}$/u.test(compact(entrance.service_id)) || !compact(entrance.launch_generation) || compact(entrance.launch_generation).length > 512 || /[\r\n\0]/u.test(compact(entrance.launch_generation))) return null;
      managedEntrance = {service_id: compact(entrance.service_id), launch_generation: compact(entrance.launch_generation)};
    }
    return { ...(managedEntrance ? {managed_entrance: managedEntrance} : {}), url: url.toString(), forward_id: forwardID, target_url: targetURL.toString(), access_mode: accessMode, presentation, ...(preparationID ? { preparation_id: preparationID } : {}) };
  } catch {
    return null;
  }
}

export function normalizeDesktopShellOpenWebServiceWindowResponse(value: unknown): DesktopShellOpenWebServiceWindowResponse {
  if (!value || typeof value !== 'object') {
    return { ok: false, message: 'Desktop failed to open the Web Service window.' };
  }
  const candidate = value as Partial<DesktopShellOpenWebServiceWindowResponse>;
  const message = compact(candidate.message);
  return { ok: candidate.ok === true, message: message || undefined };
}
