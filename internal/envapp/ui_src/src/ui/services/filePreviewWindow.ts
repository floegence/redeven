import { filePreviewWindowURL, parseFilePreviewWindowRequest } from '../../../../../../desktop/src/shared/filePreviewWindow';
import { desktopShellBridgeAvailable } from './desktopShellBridge';

export async function openFilePreviewWindow(path: string, copy: { unavailable: string; popupBlocked: string }): Promise<void> {
  const request = parseFilePreviewWindowRequest({ path });
  if (!request) throw new Error(copy.unavailable);
  if (desktopShellBridgeAvailable()) {
    const result = await window.redevenDesktopShell?.openFilePreviewWindow?.(request);
    if (!result?.ok) throw new Error(copy.unavailable);
    return;
  }
  // Synchronous user activation also copies the current tab's session bootstrap.
  // The trusted same-origin shell owns the new page; HTML stays sandboxed inside it.
  const popup = window.open(filePreviewWindowURL(window.location.href, request), '_blank');
  if (!popup) throw new Error(copy.popupBlocked);
  popup.opener = null;
}

/** File links keep browser history; Desktop retains the source in its own window. */
export async function navigateFilePreviewWindow(path: string, copy: { unavailable: string; popupBlocked: string }): Promise<void> {
  if (desktopShellBridgeAvailable()) return openFilePreviewWindow(path, copy);
  window.location.assign(filePreviewWindowURL(window.location.href, { path }));
}
