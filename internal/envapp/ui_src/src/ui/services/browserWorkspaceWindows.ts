import { browserSourceService } from './browserSourceManagement';
import type { BrowserSourceMessages } from '../i18n/browserSourceMessages';
import type { BrowserSourceSelection, BrowserSourceService } from './browserSourceContract';
import type { Session } from '@floegence/flowersec-core';
import type { BrowserMessages } from '@floegence/floebrowser/viewer';
import type { createBrowserWindow } from './browserWindow';
import { browserDocumentURL, type BrowserWorkspaceRequest } from './browserWindowProtocol';
import { desktopShellBridgeAvailable, prepareDesktopBrowserWindow } from './desktopShellBridge';
import { createBrowserWorkspaceController, type BrowserWorkspaceController, type BrowserWorkspaceState } from './browserWorkspaceController';
export { openBrowserWorkspace, browserWorkspaceSource } from './browserWorkspaceController';

type Entry = { controller: BrowserWorkspaceController; service: BrowserSourceService; child: Window | null; host?: ReturnType<typeof createBrowserWindow>; unsubscribe?: () => void; document?: string; rendering?: Promise<void>; revision: number; closed: boolean };
export class BrowserWindowBlockedError extends Error {}

/** Windows retain their shells on disconnect; the shared controller alone owns
 * admitted views and source selection. The environment owns the only Session. */
export function createBrowserWorkspaceWindows(configuration: () => { title: string; connecting: string; locale: string; messages: BrowserMessages; sources: { environment: string; messages: BrowserSourceMessages } }) {
  let session: Session | undefined;
  let implementation: Promise<typeof import('./browserWindow')> | undefined;
  const entries = new Set<Entry>();
  const dispose = (entry: Entry) => {
    if (entry.closed) return;
    entry.closed = true; entry.revision++; entry.unsubscribe?.(); entry.controller.close();
    entry.host?.close(); entry.child?.close(); entries.delete(entry);
  };
  const render = async (entry: Entry, state: BrowserWorkspaceState, refresh = false) => {
    if (entry.closed) return;
    const revision = ++entry.revision;
    if (!state.view && entry.host && !refresh) { entry.host.suspend(state.failure ?? 'BROWSER_DISCONNECTED', state.phase === 'opening' ? 'opening' : 'failed'); return; }
    if (!session || (!state.view && state.phase !== 'failed')) return;
    const identity = state.view?.id ?? 'unavailable';
    if (entry.document === identity && !refresh) return;
    const { createBrowserWindow } = await (implementation ??= import('./browserWindow'));
    if (entry.closed || entry.revision !== revision || !session) return;
    const copy = configuration(), nonce = crypto.randomUUID();
    const url = new URL(browserDocumentURL(state.view, nonce), location.href).href;
    if (desktopShellBridgeAvailable() && !(await prepareDesktopBrowserWindow(url))) throw new Error('Desktop browser window unavailable');
    if (entry.closed || entry.revision !== revision || !session) return;
    const style = getComputedStyle(document.documentElement);
    const tokens = { '--floe-background': '--background', '--floe-foreground': '--foreground', '--floe-muted': '--muted-foreground', '--floe-line': '--border', '--floe-accent': '--primary', '--floe-surface': '--muted', '--floe-field': '--secondary' };
    const theme = Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, style.getPropertyValue(value).trim()]).filter(([, value]) => value));
    const current: BrowserSourceSelection = { ...state.selection, label: state.selection.label || copy.sources.messages.product.defaultProfile };
    const previous = entry.host;
    const host = createBrowserWindow({ session, view: state.view, child: () => entry.child,
      configuration: { type: 'redeven-browser-ports', nonce, title: copy.title, locale: copy.locale, messages: copy.messages, theme,
        failure: state.failure, sources: { messages: copy.sources.messages, current, desktop: Boolean(entry.service.management.browserDesktopAvailable) } },
      sources: { service: entry.service, select: (selection, signal) => entry.controller.open(selection, signal) },
      onReconnect: () => entry.controller.reconnect(),
      onRecover: () => entry.controller.recover(),
      onFailure: code => { if (entry.host === host) void entry.controller.fail(code); },
      onStatus: status => { if (entry.host === host && status === 'disconnected') void entry.controller.fail(); },
      onTabs: state => { if (entry.host === host) entry.controller.selectTarget(state.active); },
      onClose: () => { if (entry.host === host) dispose(entry); },
    });
    entry.host = host; entry.document = identity;
    previous?.close();
    if (entry.child) entry.child.location.replace(url);
    else entry.child = window.open(url, '_blank', 'popup,width=1280,height=900');
    if (!entry.child) { dispose(entry); throw new BrowserWindowBlockedError('Browser window blocked'); }
  };
  return {
    setSession(next: Session | undefined): void {
      if (next === session) return;
      session = next;
      for (const entry of entries) {
        entry.controller.setSession(next);
        if (next) void entry.controller.reconnect().catch(() => undefined);
      }
    },
    async open(request: BrowserWorkspaceRequest): Promise<void> {
      if (!session || entries.size >= 8) throw new Error('Browser window unavailable');
      const copy = configuration();
      const service = browserSourceService(copy.sources.environment);
      const controller = createBrowserWorkspaceController(service, { request, label: '' });
      const entry: Entry = { controller, service, child: null, revision: 0, closed: false };
      if (!desktopShellBridgeAvailable()) {
        entry.child = window.open('about:blank', '_blank', 'popup,width=1280,height=900');
        if (!entry.child) { controller.close(); throw new BrowserWindowBlockedError('Browser window blocked'); }
        entry.child.document.title = copy.title;
        entry.child.document.body.textContent = copy.connecting;
      }
      entries.add(entry); controller.setSession(session);
      entry.unsubscribe = controller.subscribe(state => {
        entry.rendering = render(entry, state);
        void entry.rendering.catch(() => { if (entry.host) entry.host.suspend('BROWSER_OPEN_FAILED'); else dispose(entry); });
      });
      await controller.open({ request, label: '' }).catch(() => undefined);
      await entry.rendering;
    },
    refreshPresentation() {
      for (const entry of entries) {
        if (entry.controller.snapshot().view) void entry.controller.reconnect().catch(() => undefined);
        else void render(entry, entry.controller.snapshot(), true).catch(() => undefined);
      }
    },
    close() { for (const entry of entries) dispose(entry); session = undefined; },
  };
}
