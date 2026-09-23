import '../../styles/browserWorkspace.css';
import { Show, createEffect, createSignal, on, onCleanup } from 'solid-js';
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
  onReconnect(): void;
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
  createEffect(on(() => [props.view, props.session, props.locale] as const, () => {
    host?.close(); host = undefined;
    setLoading(true); setFailure(false);
    const nonce = crypto.randomUUID();
    try {
      const url = browserDocumentURL(props.view, nonce);
      const style = getComputedStyle(document.documentElement);
      const colors: Record<string, string> = {
        '--floe-background': '--background', '--floe-foreground': '--foreground',
        '--floe-muted': '--muted-foreground', '--floe-line': '--border',
        '--floe-accent': '--primary', '--floe-surface': '--muted', '--floe-field': '--secondary',
      };
      const theme = Object.fromEntries(Object.entries(colors).map(([name, token]) => [name, style.getPropertyValue(token).trim()]).filter(([, value]) => value));
      host = createBrowserWindow({
        session: props.session, view: props.view, child: () => frame.contentWindow,
        configuration: { type: 'redeven-browser-ports', nonce, title: props.title, locale: props.locale, messages: props.messages, theme },
        onReconnect: () => props.onReconnect(),
        onState: state => props.onState?.(state),
        onTabs: state => props.onTabs?.(state),
        onStatus: status => { if (status === 'live' || status === 'disconnected') setLoading(false); },
      });
      frame.src = url;
    } catch { setLoading(false); setFailure(true); }
  }));
  onCleanup(() => host?.close());
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
