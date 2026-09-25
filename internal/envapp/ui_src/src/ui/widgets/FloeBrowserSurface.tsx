import { captureBrowserDocumentTheme } from '../services/browserDocumentTheme';
import '../../styles/browserWorkspace.css';
import { Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import type { BrowserSourceMessages } from '../i18n/browserSourceMessages';
import type { BrowserSourceSelection, BrowserSourceService } from '../services/browserSourceContract';
import type { BrowserFailureCode } from '../services/browserWorkspaceController';
import type { Session } from '@floegence/flowersec-core';
import type { BrowserMessages } from '@floegence/floebrowser/viewer';
import type { BrowserState, TabState } from '@floegence/floebrowser/protocol';
import { createBrowserWindow } from '../services/browserWindow';
import { browserDocumentURL, type BrowserViewDescriptor } from '../services/browserWindowProtocol';

export type FloeBrowserSurfaceProps = {
  session: Session;
  view: BrowserViewDescriptor;
  title: string;
  locale: string;
  messages: BrowserMessages;
  copy: Readonly<{ connecting: string; unavailable: string }>;
  sources: { service: BrowserSourceService; messages: BrowserSourceMessages; current: BrowserSourceSelection; select(selection: BrowserSourceSelection, signal: AbortSignal): Promise<void> };
  onOpenWindow(): Promise<void>;
  onReconnect(): void;
  onFailure?(code: BrowserFailureCode): void;
  onInteraction?(): void;
  onState?(state: BrowserState): void;
  onTabs?(state: TabState): void;
};

/** Only the trusted browser document mounts the shared engine. The environment
 * keeps its existing Session and disposes just this view on navigation. */
export function FloeBrowserSurface(props: FloeBrowserSurfaceProps) {
  let frame!: HTMLIFrameElement;
  let host: ReturnType<typeof createBrowserWindow> | undefined;
  const [loading, setLoading] = createSignal(true);
  const [failure, setFailure] = createSignal(false);
  // Workspace progress can invalidate the prop getter without changing this
  // view. Only a new identity may retire its document and outstanding actions.
  const view = createMemo(() => props.view);
  const session = createMemo(() => props.session);
  createEffect(on([view, session], ([view, session]) => {
    const previous = host; host = undefined; previous?.close();
    setLoading(true); setFailure(false);
    const nonce = crypto.randomUUID();
    try {
      const url = browserDocumentURL(view, nonce);
      const theme = captureBrowserDocumentTheme();
      const current = createBrowserWindow({
        session, view, child: () => frame.contentWindow,
        configuration: { type: 'redeven-browser-ports', nonce, title: props.title, locale: props.locale, messages: props.messages, theme,
          sources: { messages: props.sources.messages, current: props.sources.current, desktop: Boolean(props.sources.service.management.browserDesktopAvailable) }, openWindow: true },
        sources: { service: props.sources.service, select: props.sources.select },
        onOpenWindow: () => props.onOpenWindow(),
        onInteraction: () => { if (host === current) props.onInteraction?.(); },
        onReconnect: () => { if (host === current) props.onReconnect(); },
        onFailure: code => { if (host === current) props.onFailure?.(code); },
        onState: state => { if (host === current) props.onState?.(state); },
        onTabs: state => { if (host === current) props.onTabs?.(state); },
        onStatus: status => {
          if (host !== current) return;
          if (status === 'live' || status === 'disconnected') setLoading(false);
          if (status === 'disconnected') props.onFailure?.('BROWSER_DISCONNECTED');
        },
      });
      host = current;
      frame.src = url;
    } catch { setLoading(false); setFailure(true); }
  }));
  onCleanup(() => { const previous = host; host = undefined; previous?.close(); });
  return (
    <section class="redeven-floebrowser-surface" aria-label={props.title}>
      <iframe ref={frame} class="redeven-floebrowser-document" title={props.title}
        sandbox="allow-scripts allow-same-origin allow-downloads" referrerPolicy="no-referrer"
        allow="clipboard-read; clipboard-write" />
      <Show when={loading() || failure()}>
        <div class="redeven-floebrowser-page-loading" role={failure() ? 'alert' : 'status'}>
          {failure() ? props.copy.unavailable : props.copy.connecting}
        </div>
      </Show>
    </section>
  );
}
