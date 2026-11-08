import { FILE_PREVIEW_FLOWER_QUERY } from '../../../../../../desktop/src/shared/filePreviewWindowRoute';
import { desktopShellBridgeAvailable } from './desktopShellBridge';

/** Keep the saved preview mounted while Flower runs in a complete shell. */
export async function askFilePreviewFlower(path: string, copy: { unavailable: string; popupBlocked: string }): Promise<void> {
  if (desktopShellBridgeAvailable()) {
    const result = await window.redevenDesktopShell?.askFilePreviewFlower?.({ path });
    if (!result?.ok) throw new Error(copy.unavailable);
    return;
  }
  const url = new URL(window.location.href);
  url.search = ''; url.hash = '';
  url.searchParams.set(FILE_PREVIEW_FLOWER_QUERY, path);
  const popup = window.open(url.toString(), '_blank');
  if (!popup) throw new Error(copy.popupBlocked);
  popup.opener = null;
}
