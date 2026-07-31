export const DESKTOP_WEB_SERVICE_BROWSER_GET_STATE_CHANNEL = 'redeven-desktop:web-service-browser-get-state';
export const DESKTOP_WEB_SERVICE_BROWSER_ACTION_CHANNEL = 'redeven-desktop:web-service-browser-action';
export const DESKTOP_WEB_SERVICE_BROWSER_STATE_UPDATED_CHANNEL = 'redeven-desktop:web-service-browser-state-updated';

export type DesktopWebServiceBrowserAction =
  | Readonly<{ action: 'back' | 'forward' | 'reload' | 'stop' }>
  | Readonly<{ action: 'navigate'; address: string }>;

export type DesktopWebServiceBrowserState = Readonly<{
  address: string;
  title: string;
  loading: boolean;
  can_go_back: boolean;
  can_go_forward: boolean;
  error_message?: string;
}>;

export type DesktopWebServiceBrowserActionResponse = Readonly<{
  ok: boolean;
  message?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDesktopWebServiceBrowserAction(value: unknown): DesktopWebServiceBrowserAction | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const action = compact(candidate.action);
  if (action === 'back' || action === 'forward' || action === 'reload' || action === 'stop') {
    return { action };
  }
  if (action !== 'navigate') return null;
  const address = compact(candidate.address);
  if (!address || address.length > 8_192) return null;
  return { action, address };
}

export function normalizeDesktopWebServiceBrowserState(value: unknown): DesktopWebServiceBrowserState {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const errorMessage = compact(candidate.error_message);
  return {
    address: compact(candidate.address),
    title: compact(candidate.title),
    loading: candidate.loading === true,
    can_go_back: candidate.can_go_back === true,
    can_go_forward: candidate.can_go_forward === true,
    ...(errorMessage ? { error_message: errorMessage } : {}),
  };
}

export function normalizeDesktopWebServiceBrowserActionResponse(value: unknown): DesktopWebServiceBrowserActionResponse {
  if (!value || typeof value !== 'object') {
    return { ok: false, message: 'Desktop could not complete the browser action.' };
  }
  const candidate = value as Record<string, unknown>;
  const message = compact(candidate.message);
  return { ok: candidate.ok === true, ...(message ? { message } : {}) };
}
