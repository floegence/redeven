import { safeMarkdownMediaURL } from '@floegence/floe-webapp-core/chat-media';
import { desktopShellExternalURLOpenAvailable, openExternalURLInDesktopShell } from './desktopShellBridge';

export async function openPreviewWebURL(
  url: string,
  signal: AbortSignal,
  copy: Readonly<{ unavailable: string; popupBlocked: string }>,
): Promise<void> {
  signal.throwIfAborted();
  if (!safeMarkdownMediaURL(url)) throw new Error(copy.unavailable);
  if (desktopShellExternalURLOpenAvailable()) {
    const result = await openExternalURLInDesktopShell(url);
    if (!result?.ok) throw new Error(result?.message || copy.unavailable);
    return;
  }
  // Keep a handle to detect popup blocking, and sever the opener before navigation.
  const popup = window.open('about:blank', '_blank');
  if (!popup) throw new Error(copy.popupBlocked);
  try {
    popup.opener = null;
    const policy = popup.document.createElement('meta');
    policy.name = 'referrer';
    policy.content = 'no-referrer';
    popup.document.head.append(policy);
    popup.location.replace(url);
  } catch (error) {
    popup.close();
    throw error;
  }
}
