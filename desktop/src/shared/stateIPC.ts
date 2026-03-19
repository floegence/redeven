export const DESKTOP_STATE_GET_CHANNEL = 'redeven-desktop:state-get';
export const DESKTOP_STATE_SET_CHANNEL = 'redeven-desktop:state-set';
export const DESKTOP_STATE_REMOVE_CHANNEL = 'redeven-desktop:state-remove';
export const DESKTOP_STATE_KEYS_CHANNEL = 'redeven-desktop:state-keys';

export type DesktopStateSetPayload = Readonly<{
  key: string;
  value: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDesktopStateKey(value: unknown): string {
  return compact(value);
}

export function normalizeDesktopStateValue(value: unknown): string {
  return String(value ?? '');
}

export function normalizeDesktopStateSetPayload(value: unknown): DesktopStateSetPayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopStateSetPayload>;
  const key = normalizeDesktopStateKey(candidate.key);
  if (!key) {
    return null;
  }

  return {
    key,
    value: normalizeDesktopStateValue(candidate.value),
  };
}

export interface DesktopStateStorageBridge {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  keys: () => string[];
}
