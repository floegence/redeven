import { browserFailureCode, type BrowserFailureCode } from './browserFailure';
import { readBrowserFile } from './browserFiles';
import { browserSourcePort } from './browserSourcePort';
import type { BrowserSourceOperation, BrowserSourceService, BrowserSourceSelection } from './browserSourceContract';
import type { Session } from '@floegence/flowersec-core';
import { serveProjectionPorts, type AddressSuggestion } from '@floegence/floebrowser/viewer';
import type { BrowserState, ClientMessage, ServerMessage, TabState } from '@floegence/floebrowser/protocol';
import { createBrowserCarrier, createBrowserUpload } from './browserTransport';
import { fetchSessionJSON } from './sessionHTTP';
import type { BrowserDocumentConfiguration, BrowserDocumentRequest, BrowserDocumentResult, BrowserViewDescriptor } from './browserWindowProtocol';

type LibraryEntry = { url: string; title: string };
export type BrowserWindowOptions = Readonly<{
  session: Session;
  view?: BrowserViewDescriptor;
  child: () => Window | null;
  configuration: BrowserDocumentConfiguration;
  onReconnect(): void | Promise<void>;
  sources?: { service: BrowserSourceService; select(selection: BrowserSourceSelection, signal: AbortSignal): Promise<void> };
  onInteraction?(): void;
  onState?(state: BrowserState): void;
  onTabs?(state: TabState): void;
  onStatus?(status: string): void;
  onClose?(): void;
  onFailure?(code: BrowserFailureCode): void;
  onRecover?(): Promise<void>;
  onOpenWindow?(): Promise<void>;
}>;

/** The environment remains the sole Session owner. Each trusted browser document
 * gets one observation and dedicated ports; it never receives a control token. */
export function createBrowserWindow(options: BrowserWindowOptions): { close(): void; suspend(code: BrowserFailureCode, phase?: 'opening' | 'failed'): void } {
  const lifetime = new AbortController();
  const root = `/_redeven_proxy/api/browser/views/${encodeURIComponent(options.view?.id ?? '')}`;
  const libraryProfile = options.view?.library_profile_id ?? options.view?.profile_id;
  const libraryRoot = '/_redeven_proxy/api/browser/library';
  let bridge: ReturnType<typeof serveProjectionPorts> | undefined;
  let product: MessagePort | undefined;
  let token = '', controlled = '';
  let grant: Extract<ServerMessage, { type: 'control' }> | undefined;
  const receivers = new Set<(message: ServerMessage) => void | Promise<void>>();
  const publish = async (message: ServerMessage): Promise<void> => {
    if (!lifetime.signal.aborted && !suspended) for (const receiver of receivers) await receiver(message);
  };
  let selected = options.view?.initial_target ?? '';
  let connected = false;
  let suspended = false;
  let failure = options.configuration.failure;
  let failurePhase: 'opening' | 'failed' = 'failed';
  let accepted = false;
  let uploads = 0;
  let control: { key: string; target: string; sourceGranted: boolean; abort: AbortController; work: Promise<BrowserDocumentResult> } | undefined;
  const sourcePort = options.sources && browserSourcePort(options.sources.service, options.sources.select, status => product?.postMessage({ type: 'source.installation', status }));
  const requests = new Map<number, { abort: AbortController; view: boolean }>();
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  void ready.catch(() => undefined);
  const setupTimer = setTimeout(() => { suspend('BROWSER_OPEN_TIMEOUT'); options.onFailure?.('BROWSER_OPEN_TIMEOUT'); }, 45000);

  const api = <T>(path: string, method: string, body: unknown, signal: AbortSignal = lifetime.signal): Promise<T> =>
    fetchSessionJSON<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal });
  const currentToken = (message: ClientMessage): string => 'tab' in message && message.tab !== controlled ? '' : token;
  const upload = createBrowserUpload({ session: options.session, view: options.view?.id ?? '', token: target => target === controlled ? token : '', signal: lifetime.signal });

  const acquire = (request: Extract<BrowserDocumentRequest, { method: 'control' }>, signal: AbortSignal): Promise<BrowserDocumentResult> => {
    if (!request.target || request.target !== selected) return Promise.reject(new Error('Browser target changed'));
    if (token && controlled === request.target && !request.takeover && !request.private) return Promise.resolve(undefined);
    const key = JSON.stringify([request.target, request.takeover, request.private]);
    if (control?.key === key) return control.work;
    control?.abort.abort();
    const abort = new AbortController();
    const work = (async () => {
      const result = await api<{ token: string }>(`${root}/control`, 'POST', { target: request.target, takeover: request.takeover, private: request.private }, AbortSignal.any([signal, abort.signal]));
      if (lifetime.signal.aborted || abort.signal.aborted || selected !== request.target || typeof result.token !== 'string') throw new Error('Browser target changed');
      token = result.token; controlled = request.target;
      // The source grant can precede this HTTP response on the DOM lane.
      // Admit input only once this owner can actually authenticate it.
      if (grant?.target === controlled) await publish(grant);
      return undefined;
    })();
    control = { key, target: request.target, sourceGranted: false, abort, work };
    void work.finally(() => { if (control?.work === work) control = undefined; }).catch(() => undefined);
    return work;
  };

  const execute = async (operation: BrowserDocumentRequest, signal: AbortSignal): Promise<BrowserDocumentResult> => {
    if (operation.method === 'workspace.retry') { await options.onReconnect(); return; }
    if (operation.method === 'workspace.recover') { await options.onRecover?.(); return; }
    if (operation.method === 'workspace.openWindow') {
      if (suspended || !options.view || !options.onOpenWindow) throw new Error('Browser window unavailable');
      await options.onOpenWindow(); return;
    }
    if (operation.method.startsWith('source.')) {
      if (!sourcePort) throw new Error('Browser source management unavailable');
      return sourcePort.execute(operation as BrowserSourceOperation, signal);
    }
    if (suspended || !options.view) throw new Error('Browser view retired');
    await ready;
    signal.throwIfAborted();
    switch (operation.method) {
      case 'library.list': {
        if (!libraryProfile || !['bookmarks', 'history'].includes(operation.kind) || typeof operation.query !== 'string' || operation.query.length > 8192) throw new Error('Invalid browser library');
        const parameters = new URLSearchParams({ profile_id: libraryProfile, q: operation.query, limit: '100' });
        const entries = await api<LibraryEntry[] | null>(`${libraryRoot}/${operation.kind}?${parameters}`, 'GET', undefined, signal);
        const query = operation.query.trim().toLocaleLowerCase();
        return (entries ?? []).filter(entry => `${entry.title} ${entry.url}`.toLocaleLowerCase().includes(query)).slice(0, 100);
      }
      case 'library.save':
      case 'library.remove': {
        if (!libraryProfile || typeof operation.url !== 'string' || operation.url.length > 8192
          || (operation.method === 'library.save' && (typeof operation.title !== 'string' || operation.title.length > 512))) throw new Error('Invalid browser bookmark');
        await api(`${libraryRoot}/bookmark`, operation.method === 'library.save' ? 'PUT' : 'DELETE', { profile_id: libraryProfile, url: operation.url, ...(operation.method === 'library.save' ? { title: operation.title } : {}) }, signal);
        return;
      }
      case 'library.clear': {
        if (!libraryProfile) throw new Error('Browser library unavailable');
        await api(`${libraryRoot}/history?${new URLSearchParams({ profile_id: libraryProfile })}`, 'DELETE', undefined, signal);
        return;
      }
      case 'zoom.load':
      case 'zoom.save': {
        if (!libraryProfile || typeof operation.origin !== 'string' || operation.origin.length > 8192) throw new Error('Invalid browser preference');
        if (operation.method === 'zoom.load') {
          const result = await api<{ zoom: number }>(`${libraryRoot}/zoom?${new URLSearchParams({ profile_id: libraryProfile, origin: operation.origin })}`, 'GET', undefined, signal);
          return result.zoom;
        }
        if (!Number.isFinite(operation.factor) || operation.factor < .25 || operation.factor > 5) throw new Error('Invalid browser zoom');
        await api(`${libraryRoot}/zoom`, 'PUT', { profile_id: libraryProfile, origin: operation.origin, zoom: operation.factor }, signal);
        return;
      }
      case 'control': {
        if (typeof operation.target !== 'string' || typeof operation.takeover !== 'boolean' || typeof operation.private !== 'boolean') throw new Error('Invalid browser control');
        return acquire(operation, signal);
      }
      case 'visibility': {
        if (typeof operation.visible !== 'boolean') throw new Error('Invalid browser visibility');
        await api(`${root}/preferences`, 'PUT', { visible: operation.visible, audio: true }, signal);
        return;
      }
      case 'resource':
      case 'download':
        return readBrowserFile(root, operation.method, operation.target, operation.id, signal);
      case 'upload': {
        if (!(operation.file instanceof File) || operation.file.size > 256 * 1024 * 1024 || uploads >= 4
          || operation.chooser?.target !== controlled || !token) throw new Error('Browser upload unavailable');
        uploads++;
        try { return await upload(operation.chooser, operation.file, signal); }
        finally { uploads--; }
      }
      case 'suggest': {
        if (typeof operation.query !== 'string' || operation.query.length > 8192 || !Array.isArray(operation.tabs?.tabs) || operation.tabs.tabs.length > 128) throw new Error('Invalid browser suggestions');
        const query = operation.query.trim().toLocaleLowerCase();
        const matches = (entry: LibraryEntry) => `${entry.title} ${entry.url}`.toLocaleLowerCase().includes(query);
        const suggestions: AddressSuggestion[] = operation.tabs.tabs.filter(matches).map(tab => ({ title: tab.title, url: tab.url, tab: tab.id }));
        if (libraryProfile) {
          const parameters = new URLSearchParams({ profile_id: libraryProfile, q: operation.query, limit: '20' });
          const [history, bookmarks] = await Promise.all([
            api<LibraryEntry[] | null>(`/_redeven_proxy/api/browser/library/history?${parameters}`, 'GET', undefined, signal),
            api<LibraryEntry[] | null>(`/_redeven_proxy/api/browser/library/bookmarks?${parameters}`, 'GET', undefined, signal),
          ]);
          suggestions.push(...(bookmarks ?? []).filter(matches).map(entry => ({ ...entry, bookmarked: true })), ...(history ?? []).map(entry => ({ ...entry, visited: true })));
        }
        const seen = new Set<string>();
        return suggestions.filter(entry => { if (seen.has(entry.url)) return false; seen.add(entry.url); return true; }).slice(0, 20);
      }
      default: throw new Error('Browser operation unavailable');
    }
  };

  const receive = (event: MessageEvent): void => {
    const message = event.data;
    if (lifetime.signal.aborted || !message || typeof message !== 'object') return;
    if (message.type === 'interaction') { options.onInteraction?.(); return; }
    if (message.type === 'closed') { close(); return; }
    if (message.type === 'reconnect') { void Promise.resolve(options.onReconnect()).catch(() => undefined); return; }
    if (message.type === 'state') { if (!suspended) options.onState?.(message.state); return; }
    if (message.type === 'tabs') { if (!suspended) options.onTabs?.(message.state); return; }
    if (message.type === 'status') { if (!suspended) options.onStatus?.(message.status); return; }
    if (!Number.isSafeInteger(message.id) || message.id <= 0) return;
    if (message.type === 'cancel') { requests.get(message.id)?.abort.abort(); return; }
    if (message.type !== 'request' || requests.has(message.id) || requests.size >= 16 || !message.operation || typeof message.operation !== 'object') return;
    const abort = new AbortController();
    requests.set(message.id, { abort, view: !message.operation.method?.startsWith('source.') && !message.operation.method?.startsWith('workspace.') });
    void execute(message.operation, AbortSignal.any([lifetime.signal, abort.signal])).then(
      value => { if (!lifetime.signal.aborted && !abort.signal.aborted) product?.postMessage({ type: 'result', id: message.id, ok: true, value }, value && typeof value === 'object' && 'body' in value ? [value.body] : []); },
      error => { if (!lifetime.signal.aborted) product?.postMessage({ type: 'result', id: message.id, ok: false, code: message.operation.method === 'workspace.openWindow' && error?.code === 'BROWSER_WINDOW_BLOCKED' ? 'BROWSER_WINDOW_BLOCKED' : browserFailureCode(error) }); },
    ).finally(() => requests.delete(message.id));
  };

  const attach = (event: MessageEvent): void => {
    const child = options.child();
    if (accepted || lifetime.signal.aborted || !child || event.source !== child || event.origin !== location.origin
      || event.data?.type !== 'redeven-browser-ready' || event.data.nonce !== options.configuration.nonce) return;
    accepted = true;
    window.removeEventListener('message', attach);
    const messages = new MessageChannel(), media = new MessageChannel(), actions = new MessageChannel();
    product = actions.port1;
    product.addEventListener('message', receive); product.start();
    if (options.view && !suspended) bridge = serveProjectionPorts({ messages: messages.port1, media: media.port1 }, () => {
      const carrier = createBrowserCarrier({ session: options.session, view: options.view?.id ?? '', controlToken: currentToken, onClose: reason => {
        token = ''; controlled = ''; grant = undefined; connected = false; readyReject(new Error('Browser closed'));
        if (reason && !suspended && !lifetime.signal.aborted) {
          suspend('BROWSER_SOURCE_UNAVAILABLE');
          options.onFailure?.('BROWSER_SOURCE_UNAVAILABLE');
        }
      } });
      carrier.subscribe(async message => {
        if (suspended || lifetime.signal.aborted) return;
        if (!connected) { connected = true; clearTimeout(setupTimer); readyResolve(); }
        if (message.type === 'tabs') {
          if (selected !== message.state.active) { token = ''; controlled = ''; grant = undefined; control?.abort.abort(); }
          selected = message.state.active;
        }
        if (message.type === 'control') {
          if (message.active) {
            if (message.target !== selected) return;
            grant = message;
            if (control?.target === message.target) control.sourceGranted = true;
            if (!token || controlled !== message.target) return;
          } else {
            if (grant?.target === message.target) grant = undefined;
            if (control?.target === message.target && control.sourceGranted) control.abort.abort();
            if (controlled === message.target) { token = ''; controlled = ''; }
          }
        }
        await publish(message);
      });
      return { ...carrier, subscribe: listener => { receivers.add(listener); return () => receivers.delete(listener); } };
    });
    if (!options.view) { clearTimeout(setupTimer); suspended = true; }
    child.postMessage({ ...options.configuration, failure, library: Boolean(libraryProfile) }, location.origin, [messages.port2, media.port2, actions.port2]);
  };

  function close(): void {
    if (lifetime.signal.aborted) return;
    lifetime.abort(); clearTimeout(setupTimer);
    readyReject(new Error('Browser window closed'));
    window.removeEventListener('message', attach);
    control?.abort.abort(); requests.clear(); sourcePort?.close();
    bridge?.close(); product?.close(); receivers.clear(); token = ''; controlled = ''; grant = undefined;
    options.onClose?.();
  }
  function suspend(code: BrowserFailureCode, phase: 'opening' | 'failed' = 'failed'): void {
    if (lifetime.signal.aborted || suspended && failure === code && failurePhase === phase) return;
    failure = code; failurePhase = phase;
    suspended = true; clearTimeout(setupTimer);
    token = ''; controlled = ''; grant = undefined; control?.abort.abort();
    for (const request of requests.values()) if (request.view) request.abort.abort();
    bridge?.close(); bridge = undefined;
    readyReject(new Error('Browser view retired'));
    product?.postMessage({ type: 'workspace.failure', code, phase });
  }
  window.addEventListener('message', attach);
  return { close, suspend };
}
