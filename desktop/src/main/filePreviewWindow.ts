import { filePreviewWindowURL, parseFilePreviewWindowRequest, readFilePreviewWindowRequest, type FilePreviewWindowResponse } from '../shared/filePreviewWindow';
import { LOCAL_UI_ENV_APP_ENTRY_PATH } from './localUIURL';

export type FilePreviewWindowOwner = Readonly<{
  mainFrame: boolean;
  allowed: boolean;
  sourceURL: string;
  entryURL: string;
  open: (url: string, identity: string) => boolean;
}>;

export function openFilePreviewWindow(request: unknown, owner: FilePreviewWindowOwner | null): FilePreviewWindowResponse {
  const parsed = parseFilePreviewWindowRequest(request);
  if (!parsed || !owner?.mainFrame || !owner.allowed) return { ok: false };
  try {
    const source = new URL(owner.sourceURL);
    const entry = new URL(owner.entryURL);
    if (source.origin !== entry.origin || source.pathname !== LOCAL_UI_ENV_APP_ENTRY_PATH) return { ok: false };
    entry.pathname = LOCAL_UI_ENV_APP_ENTRY_PATH;
    return { ok: owner.open(filePreviewWindowURL(entry.toString(), parsed), `file-preview:${parsed.path}`) };
  } catch { return { ok: false }; }
}

/** A preview may hand only its own current file to its session's Flower owner. */
export function askFilePreviewFlower(request: unknown, owner: FilePreviewWindowOwner | null): FilePreviewWindowResponse {
  const parsed = parseFilePreviewWindowRequest(request);
  if (!parsed || !owner?.mainFrame || !owner.allowed) return { ok: false };
  try {
    const source = new URL(owner.sourceURL), entry = new URL(owner.entryURL);
    if (source.origin !== entry.origin || source.pathname !== LOCAL_UI_ENV_APP_ENTRY_PATH
      || readFilePreviewWindowRequest(source.search)?.path !== parsed.path) return { ok: false };
    return { ok: owner.open(source.toString(), parsed.path) };
  } catch { return { ok: false }; }
}
