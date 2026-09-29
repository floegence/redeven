export const SESSION_RESTART_INIT = 'redeven-desktop:session-restart-init';
export const SESSION_RESTART_REGISTER = 'redeven-desktop:session-restart-register';
export const SESSION_RESTART_PREPARE = 'redeven-desktop:session-restart-prepare';
export const SESSION_RESTART_CANCEL = 'redeven-desktop:session-restart-cancel';
export const SESSION_RESTART_SUBMIT = 'redeven-desktop:session-restart-submit';
export const SESSION_RESTART_READ = 'redeven-desktop:session-restart-read';
export const SESSION_RESTART_RESTORED = 'redeven-desktop:session-restart-restored';

/** User-authored state only. Runtime credentials and request handles never cross this boundary. */
export type SessionRestartState = Readonly<{
  v: 1;
  json: string;
  files: readonly Readonly<{ id: string; name: string; type: string; lastModified: number; bytes: Uint8Array }>[];
}>;

export type SessionRestartRestore = Readonly<{ ticket: string; state: SessionRestartState }>;

export interface SessionRestartBridge {
  register: (prepare: () => Promise<SessionRestartState>, cancel: () => void) => () => void;
  read: () => Promise<SessionRestartRestore | null>;
  restored: (ticket: string) => Promise<boolean>;
}

// Bound one window's temporary IPC transfer. Failure preserves the original page.
export const SESSION_RESTART_MAX_BYTES = 256 * 1024 * 1024;
export function validSessionRestartState(value: unknown): value is SessionRestartState {
  if (!value || typeof value !== 'object') return false;
  const state = value as SessionRestartState;
  if (state.v !== 1 || typeof state.json !== 'string' || state.json.length > 16 * 1024 * 1024
    || !Array.isArray(state.files) || state.files.length > 4096) return false;
  let bytes = state.json.length * 2;
  const ids = new Set<string>();
  for (const file of state.files) {
    if (!file || typeof file.id !== 'string' || !file.id || ids.has(file.id)
      || typeof file.name !== 'string' || typeof file.type !== 'string'
      || !Number.isFinite(file.lastModified) || !(file.bytes instanceof Uint8Array)) return false;
    ids.add(file.id);
    bytes += file.bytes.byteLength + 2 * (file.id.length + file.name.length + file.type.length);
    if (bytes > SESSION_RESTART_MAX_BYTES) return false;
  }
  return bytes <= SESSION_RESTART_MAX_BYTES;
}
