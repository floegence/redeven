import { browserSourceService } from './browserSourceManagement';
import type { BrowserSourceMessages } from '../i18n/browserSourceMessages';
import type { BrowserSourceSelection } from './browserSourceContract';
import type { Session } from '@floegence/flowersec-core';
import type { BrowserMessages } from '@floegence/floebrowser/viewer';
import type { createBrowserWindow } from './browserWindow';
import { browserDocumentURL, type BrowserViewDescriptor, type BrowserWorkspaceRequest } from './browserWindowProtocol';
import { desktopShellBridgeAvailable, prepareDesktopBrowserWindow } from './desktopShellBridge';
import { fetchLocalApiJSON } from './localApi';

type Entry = { label?: string; changing?: boolean; request: BrowserWorkspaceRequest; child: Window | null; host?: ReturnType<typeof createBrowserWindow> };
export class BrowserWindowBlockedError extends Error {}

export function openBrowserWorkspace(request: BrowserWorkspaceRequest, signal: AbortSignal): Promise<BrowserViewDescriptor> {
  const existing = 'source_target' in request;
  return fetchLocalApiJSON(existing ? '/_redeven_proxy/api/browser/views' : '/_redeven_proxy/api/browser/workspace', {
    method: 'POST', body: JSON.stringify(existing ? { targets: [request.source_target] } : request), signal,
  });
}
export function browserWorkspaceSource(view: BrowserViewDescriptor): BrowserWorkspaceRequest {
  return view.profile_id ? { managed_profile_id: view.profile_id } : { source_target: view.initial_target };
}

/** Lives with the environment shell, independently of its selected page or
 * Flower thread. Every child borrows the same Session and receives only ports. */
export function createBrowserWorkspaceWindows(configuration: () => { title: string; connecting: string; locale: string; messages: BrowserMessages; sources?: { environment: string; messages: BrowserSourceMessages } }) {
  let session: Session | undefined;
  let lifetime = new AbortController();
  const entries = new Set<Entry>();
  const close = () => {
    lifetime.abort();
    for (const entry of entries) { entry.host?.close(); entry.child?.close(); }
    entries.clear(); session = undefined;
  };
  const connect = async (entry: Entry, selection?: BrowserSourceSelection, operationSignal?: AbortSignal): Promise<void> => {
    const current = session, signal = operationSignal ? AbortSignal.any([lifetime.signal, operationSignal]) : lifetime.signal;
    if (!current || signal.aborted) throw new Error('Browser environment unavailable');
    const { createBrowserWindow } = await import('./browserWindow');
    signal.throwIfAborted();
    const previous = entry.host;
    const view = await openBrowserWorkspace(selection?.request ?? entry.request, signal);
    // Opening another view or refreshing never repeats a new-tab command or
    // rebinds an old URL selection after navigation.
    const canonical = browserWorkspaceSource(view);
    let issued = true;
    try {
      signal.throwIfAborted();
      const copy = configuration(), nonce = crypto.randomUUID();
      const url = new URL(browserDocumentURL(view, nonce), location.href).href;
      if (desktopShellBridgeAvailable() && !(await prepareDesktopBrowserWindow(url))) throw new Error('Desktop browser window unavailable');
      signal.throwIfAborted();
      const style = getComputedStyle(document.documentElement);
      const tokens = { '--floe-background': '--background', '--floe-foreground': '--foreground', '--floe-muted': '--muted-foreground', '--floe-line': '--border', '--floe-accent': '--primary', '--floe-surface': '--muted', '--floe-field': '--secondary' };
      const theme = Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, style.getPropertyValue(value).trim()]).filter(([, value]) => value));
      const sources = copy.sources && browserSourceService(copy.sources.environment);
      const currentSelection = { request: canonical, label: selection?.label ?? entry.label ?? (view.profile_id === 'browser-main' ? copy.sources?.messages.product.defaultProfile : copy.sources?.messages.product.sources) ?? copy.title };
      const host = createBrowserWindow({ session: current, view, child: () => entry.child,
        configuration: { type: 'redeven-browser-ports', nonce, title: copy.title, locale: copy.locale, messages: copy.messages, theme, ...(copy.sources && sources ? { sources: { messages: copy.sources.messages, current: currentSelection, desktop: Boolean(sources.management.browserDesktopAvailable) } } : {}) },
        sources: sources && { service: sources, select: async (selection, signal) => {
          if (entry.changing) throw new Error('Browser source is changing');
          entry.changing = true;
          try { await connect(entry, selection, signal); } finally { entry.changing = false; }
        } },
        onReconnect: () => { void connect(entry).catch(() => { entry.host?.close(); entry.child?.close(); entries.delete(entry); }); },
        onClose: () => { if (entry.host === host) { entry.host = undefined; entries.delete(entry); entry.child?.close(); } },
      });
      entry.host = host; issued = false;
      entry.request = canonical; entry.label = currentSelection.label;
      previous?.close();
      if (entry.child) entry.child.location.replace(url);
      else entry.child = window.open(url, '_blank', 'popup,width=1280,height=900');
      if (!entry.child) { host.close(); throw new BrowserWindowBlockedError('Browser window blocked'); }
      entries.add(entry);
    } finally {
      if (issued) void fetchLocalApiJSON(`/_redeven_proxy/api/browser/views/${encodeURIComponent(view.id)}`, { method: 'DELETE' }).catch(() => undefined);
    }
  };
  return {
    setSession(next: Session | undefined): void {
      if (next === session) return;
      close(); session = next; lifetime = new AbortController();
    },
    async open(request: BrowserWorkspaceRequest): Promise<void> {
      if (!session || lifetime.signal.aborted || entries.size >= 8) throw new Error('Browser window unavailable');
      const entry: Entry = { request, child: null };
      if (!desktopShellBridgeAvailable()) {
        // Keep the browser's user activation before awaiting Runtime admission.
        entry.child = window.open('about:blank', '_blank', 'popup,width=1280,height=900');
        if (!entry.child) throw new BrowserWindowBlockedError('Browser window blocked');
        const copy = configuration();
        entry.child.document.title = copy.title;
        entry.child.document.body.textContent = copy.connecting;
      }
      entries.add(entry);
      try { await connect(entry); }
      catch (error) { entry.host?.close(); entry.child?.close(); entries.delete(entry); throw error; }
    },
    close,
  };
}
