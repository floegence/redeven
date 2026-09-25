import { applyBrowserDocumentTheme, applyBrowserChromeTheme } from './ui/services/browserDocumentTheme';
import { browserFailureCode, type BrowserFailureCode } from './ui/services/browserFailure';
import type { FlowerBrowserInstallationSnapshot } from '../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { BrowserSourceService } from './ui/services/browserSourceContract';
import { mountBrowser, projectionPortConnection, type AddressSuggestion, type BrowserMenu } from '@floegence/floebrowser/viewer';
import decoderURL from '@floegence/floebrowser/media-worker.js?url';
import audioWorkletURL from '@floegence/floebrowser/audio-worklet.js?url';
import '@floegence/floebrowser/viewer.css';
import './styles/browserDocument.css';
import { browserResourceIdentity } from './ui/services/browserResourceIdentity';
import { saveBrowserDownload } from './ui/services/browserDownload';
import type { BrowserDocumentConfiguration, BrowserDocumentEvent, BrowserDocumentRequest, BrowserDocumentResult } from './ui/services/browserWindowProtocol';

// This entry point deliberately imports no Env App, Desktop bridge, connection
// owner or model service. The nested replay sandbox remains owned by FloeBrowser.
const owner = window.opener ?? (window.parent !== window ? window.parent : null);
const nonce = decodeURIComponent(location.hash.slice(1));
const origin = location.origin;
let accepted = false;

function attach(event: MessageEvent<BrowserDocumentConfiguration>): void {
  if (accepted || !owner || event.source !== owner || event.origin !== origin
    || event.data?.type !== 'redeven-browser-ports' || event.data.nonce !== nonce || event.ports.length !== 3) return;
  accepted = true;
  window.removeEventListener('message', attach);
  const configuration = event.data;
  const [messages, media, product] = event.ports as [MessagePort, MessagePort, MessagePort];
  document.title = configuration.title;
  document.documentElement.lang = configuration.locale;
  applyBrowserDocumentTheme(configuration.theme);
  let sequence = 0;
  let mounted = false;
  const pending = new Map<number, { resolve(value: BrowserDocumentResult): void; reject(error: Error): void; dispose(): void }>();
  const notify = (message: BrowserDocumentEvent) => product.postMessage(message);
  const request = (operation: BrowserDocumentRequest, signal?: AbortSignal): Promise<BrowserDocumentResult> => {
    if (pending.size >= 16 || signal?.aborted) return Promise.reject(new Error('Browser request unavailable'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const work = pending.get(id);
        if (!work) return;
        pending.delete(id); work.dispose();
        product.postMessage({ type: 'cancel', id });
        reject(new Error('Browser request canceled'));
      };
      const timer = setTimeout(cancel, 120000);
      const dispose = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
      pending.set(id, { resolve, reject, dispose });
      signal?.addEventListener('abort', cancel, { once: true });
      product.postMessage({ type: 'request', id, operation });
    });
  };
  const installationListeners = new Set<(status: FlowerBrowserInstallationSnapshot) => void>();
  let showFailure: ((code: BrowserFailureCode, phase?: 'opening' | 'failed') => void) | undefined;
  product.onmessage = ({ data }) => {
    if (data?.type === 'workspace.failure') { showFailure?.(browserFailureCode(data), data.phase === 'opening' ? 'opening' : 'failed'); return; }
    if (data?.type === 'source.installation') { for (const listener of installationListeners) listener(data.status); return; }
    if (data?.type !== 'result' || !Number.isSafeInteger(data.id)) return;
    const work = pending.get(data.id);
    if (!work) return;
    pending.delete(data.id); work.dispose();
    if (data.ok === true) work.resolve(data.value);
    else work.reject(Object.assign(new Error('Browser request unavailable'), { code: data.code }));
  };
  product.start();
  const file = async (method: 'resource' | 'download', target: string, id: string, signal: AbortSignal): Promise<Response> => {
    const value = await request({ method, target, id }, signal);
    if (!value || typeof value !== 'object' || !('body' in value) || !(value.body instanceof ArrayBuffer)) throw new Error('Browser file unavailable');
    return new Response(value.body, { headers: { 'Content-Type': value.contentType, 'Content-Disposition': value.disposition, 'Content-Length': String(value.body.byteLength) } });
  };
  const connection = projectionPortConnection({ messages, media }, {
    upload: async (chooser, file, signal) => {
      const id = await request({ method: 'upload', chooser, file }, signal);
      if (typeof id !== 'string') throw new Error('Browser upload unavailable');
      return id;
    },
    download: async (target, id, signal) => {
      signal.throwIfAborted();
      await saveBrowserDownload(await file('download', target, id, signal), signal);
    },
  });
  const surface = document.createElement('main'); surface.className = 'redeven-browser-document-surface'; document.body.append(surface);
  let disposeSources: (() => void) | undefined;
  let disposeRecovery: (() => void) | undefined;
  let recoveryRevision = 0;
  let openingSources = false, disposed = false;
  let view: ReturnType<typeof mountBrowser> | undefined;
  let menu: BrowserMenu | undefined;
  if (configuration.sources) {
    const sources = configuration.sources;
    const service: BrowserSourceService = {
      profiles: async signal => await request({ method: 'source.profiles' }, signal) as Awaited<ReturnType<BrowserSourceService['profiles']>>,
      createProfile: async (name, signal) => await request({ method: 'source.createProfile', name }, signal) as Awaited<ReturnType<BrowserSourceService['profiles']>>,
      status: async signal => await request({ method: 'source.status' }, signal) as Awaited<ReturnType<BrowserSourceService['status']>>,
      tabs: async (profile, signal) => await request({ method: 'source.tabs', profile }, signal) as Awaited<ReturnType<BrowserSourceService['tabs']>>,
      discover: async (endpoint, signal) => await request({ method: 'source.discover', endpoint }, signal) as Awaited<ReturnType<BrowserSourceService['discover']>>,
      management: {
        browserDesktopAvailable: sources.desktop,
        loadBrowserInstallation: async () => await request({ method: 'source.installation' }) as FlowerBrowserInstallationSnapshot,
        saveBrowserEnabled: async enabled => await request({ method: 'source.enabled', enabled }) as FlowerBrowserInstallationSnapshot,
        installBrowser: async input => await request({ method: 'source.install', request: input }) as FlowerBrowserInstallationSnapshot,
        setupExtension: async () => await request({ method: 'source.setup' }) as Awaited<ReturnType<NonNullable<BrowserSourceService['management']['setupExtension']>>>,
        openExtension: async action => { await request({ method: 'source.openExtension', action }); },
        loadExtensionStatus: async () => await request({ method: 'source.status' }) as Awaited<ReturnType<BrowserSourceService['status']>>,
        subscribeBrowserInstallation: listener => {
          installationListeners.add(listener);
          void request({ method: 'source.watch', enabled: true }).catch(() => undefined);
          return () => { installationListeners.delete(listener); if (!installationListeners.size) void request({ method: 'source.watch', enabled: false }).catch(() => undefined); };
        },
      },
    };
    const chooseSource = async () => {
      if (openingSources || disposeSources) return;
      const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      openingSources = true;
      try {
        const { mountBrowserSources } = await import('./browserSources');
        if (disposed) return;
        disposeSources = mountBrowserSources({ service, messages: sources.messages, current: sources.current,
          select: async (selection, signal) => { await request({ method: 'source.select', selection }, signal); },
          close: () => { disposeSources?.(); disposeSources = undefined; returnFocus?.focus(); },
        });
      } finally { openingSources = false; }
    };
    menu = { label: sources.messages.product.moreActions, actions: [
      { label: sources.messages.product.sources, description: sources.current.label, run: chooseSource, failureMessage: sources.messages.computer.chromeContinueFailed },
      ...(configuration.openWindow ? [{ label: sources.messages.product.openWindow,
        run: async () => { await request({ method: 'workspace.openWindow' }); },
        failureMessage: (error: unknown) => (error as { code?: string })?.code === 'BROWSER_WINDOW_BLOCKED' ? sources.messages.product.windowBlocked : sources.messages.product.windowUnavailable,
      }] : []),
    ] };
    showFailure = (code, phase = 'failed') => {
      const revision = ++recoveryRevision;
      // The chooser owns its pending selection. View-state updates must not
      // unmount it and abort the source request that is replacing this view.
      view?.destroy(); view = undefined;
      surface.hidden = true;
      void import('./browserSources').then(({ mountBrowserRecovery }) => {
        if (disposed || revision !== recoveryRevision) return;
        disposeRecovery?.();
        disposeRecovery = mountBrowserRecovery({ title: configuration.title, state: { phase, failure: code, selection: sources.current }, service,
          messages: sources.messages, connected: true,
          retry: async () => { await request({ method: 'workspace.retry' }); }, recover: async () => { await request({ method: 'workspace.recover' }); },
          chooseSource: () => { void chooseSource().catch(() => showFailure?.('BROWSER_OPEN_FAILED')); } });
      });
    };
    if (configuration.failure) showFailure(configuration.failure);
  }
  view = configuration.failure ? undefined : mountBrowser(surface, {
    title: configuration.title,
    menu,
    fetchResource: (url, signal) => {
      const { target, id } = browserResourceIdentity(url, location.href);
      return file('resource', target, id, signal);
    },
    messages: configuration.messages,
    mediaAssets: { decoderURL, audioWorkletURL },
    connect: () => {
      if (mounted) notify({ type: 'reconnect' });
      mounted = true;
      return connection;
    },
    suggest: async (query, { tabs, signal }) => (await request({ method: 'suggest', query, tabs }, signal)) as readonly AddressSuggestion[],
    library: configuration.library ? {
      list: async (kind, query, signal) => await request({ method: 'library.list', kind, query }, signal) as readonly AddressSuggestion[],
      saveBookmark: async (entry, signal) => { await request({ method: 'library.save', ...entry }, signal); },
      removeBookmark: async (url, signal) => { await request({ method: 'library.remove', url }, signal); },
      clearHistory: async signal => { await request({ method: 'library.clear' }, signal); },
    } : undefined,
    zoomPreferences: configuration.library ? {
      load: async (origin, signal) => await request({ method: 'zoom.load', origin }, signal) as number,
      save: async (origin, factor, signal) => { await request({ method: 'zoom.save', origin, factor }, signal); },
    } : undefined,
    onPrepareView: async (target, signal) => {
      await request({ method: 'control', target, takeover: false, private: false }, signal);
      return true;
    },
    onRequestControl: async (target, signal) => { await request({ method: 'control', target, takeover: false, private: false }, signal); },
    onTakeControl: async target => { await request({ method: 'control', target, takeover: true, private: false }); },
    onTabs: state => notify({ type: 'tabs', state }),
    onState: state => notify({ type: 'state', state }),
    onStatus: status => notify({ type: 'status', status }),
  });
  const chrome = document.querySelector<HTMLElement>('.floe-browser');
  if (chrome) applyBrowserChromeTheme(chrome);
  const visibility = () => { void request({ method: 'visibility', visible: !document.hidden }).catch(() => undefined); };
  // Pointer events stay inside this document, including the engine's trusted
  // input surface above its scriptless replay iframe. Notify product placement
  // without consuming the click or changing browser control authority.
  const interaction = (event: PointerEvent) => { if (event.isTrusted) notify({ type: 'interaction' }); };
  document.addEventListener('pointerdown', interaction, { capture: true, passive: true });
  document.addEventListener('visibilitychange', visibility);
  visibility();
  window.addEventListener('pagehide', () => {
    disposed = true;
    document.removeEventListener('visibilitychange', visibility);
    document.removeEventListener('pointerdown', interaction, true);
    for (const work of pending.values()) { work.dispose(); work.reject(new Error('Browser document closed')); }
    pending.clear();
    product.postMessage({ type: 'closed' });
    disposeSources?.(); disposeRecovery?.(); installationListeners.clear();
    view?.destroy(); product.close();
  }, { once: true });
}

if (owner && /^[a-zA-Z0-9-]{16,128}$/u.test(nonce)) {
  window.addEventListener('message', attach);
  owner.postMessage({ type: 'redeven-browser-ready', nonce }, origin);
}
