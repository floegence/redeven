import { prepareLocalApiRequestInit } from '../services/localApi';
import { fetchAuthenticatedReDevPlugin } from './pluginPlatform';

export type PluginIconLoadState = 'loading' | 'retrying';

export type LoadedPluginIcon = Readonly<{
  url: string;
  release: () => void;
}>;

export type PluginIconLoadOptions = Readonly<{
  signal?: AbortSignal;
  onState?: (state: PluginIconLoadState) => void;
}>;

type PendingIconLoad = Readonly<{
  promise: Promise<Blob>;
  listeners: Set<(state: PluginIconLoadState) => void>;
}>;

const ICON_REQUEST_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [0, 300, 1_000] as const;
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429]);
const iconCache = new Map<string, Blob>();
const pendingIconLoads = new Map<string, PendingIconLoad>();

class PluginIconLoadError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'PluginIconLoadError';
    this.retryable = retryable;
  }
}

export function acquireCachedPluginIcon(url: string): LoadedPluginIcon | undefined {
  const blob = iconCache.get(url);
  return blob ? createLoadedIcon(blob) : undefined;
}

export function loadPluginIcon(url: string, options: PluginIconLoadOptions = {}): Promise<LoadedPluginIcon> {
  const cached = iconCache.get(url);
  if (cached) return Promise.resolve(createLoadedIcon(cached));

  let pending = pendingIconLoads.get(url);
  if (!pending) {
    const listeners = new Set<(state: PluginIconLoadState) => void>();
    const promise = loadWithRetry(url, (state) => {
      for (const listener of listeners) listener(state);
    }).then((blob) => {
      iconCache.set(url, blob);
      return blob;
    });
    pending = { promise, listeners };
    pendingIconLoads.set(url, pending);
    void promise.then(
      () => {
        if (pendingIconLoads.get(url) === pending) pendingIconLoads.delete(url);
      },
      () => {
        if (pendingIconLoads.get(url) === pending) pendingIconLoads.delete(url);
      },
    );
  }

  const listener = options.onState;
  if (listener) pending.listeners.add(listener);
  const result = withAbort(pending.promise, options.signal).then(createLoadedIcon);
  return result.finally(() => {
    if (listener) pending?.listeners.delete(listener);
  });
}

export function clearPluginIconCache(): void {
  iconCache.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', clearPluginIconCache, { once: true });
}

async function loadWithRetry(url: string, onState: (state: PluginIconLoadState) => void): Promise<Blob> {
  for (let retry = 0; ; retry += 1) {
    try {
      onState('loading');
      return await loadOnce(url);
    } catch (error) {
      if (!(error instanceof PluginIconLoadError) || !error.retryable || retry >= MAX_RETRIES) throw error;
      onState('retrying');
      await delay(RETRY_DELAYS_MS[retry]);
    }
  }
}

async function loadOnce(url: string): Promise<Blob> {
  if (!isSupportedPluginIconURL(url)) {
    throw new PluginIconLoadError('Unsupported plugin icon URL', false);
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ICON_REQUEST_TIMEOUT_MS);
  try {
    const response = url.startsWith('/_redevplugin/api/plugins/')
      ? await fetchAuthenticatedReDevPlugin(url, { method: 'GET', cache: 'force-cache', signal: controller.signal })
      : await fetch(url, {
        ...await prepareLocalApiRequestInit({ method: 'GET', signal: controller.signal }),
        cache: 'force-cache',
      });
    if (!response.ok) {
      throw new PluginIconLoadError(
        `Plugin icon request failed with HTTP ${response.status}`,
        RETRYABLE_HTTP_STATUSES.has(response.status) || response.status >= 500,
      );
    }
    const blob = await response.blob();
    if (blob.type !== 'image/png' && blob.type !== 'image/webp') {
      throw new PluginIconLoadError('Plugin icon media type is invalid', false);
    }
    if (typeof URL.createObjectURL !== 'function') {
      throw new PluginIconLoadError('Plugin icon object URLs are unavailable', false);
    }
    const objectURL = URL.createObjectURL(blob);
    try {
      await decodeImage(objectURL);
      return blob;
    } catch (error) {
      throw new PluginIconLoadError(
        error instanceof Error ? error.message : 'Plugin icon decoding failed',
        false,
      );
    } finally {
      URL.revokeObjectURL(objectURL);
    }
  } catch (error) {
    if (error instanceof PluginIconLoadError) throw error;
    if (timedOut) throw new PluginIconLoadError('Plugin icon request timed out', true);
    throw new PluginIconLoadError('Plugin icon request failed', true);
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function createLoadedIcon(blob: Blob): LoadedPluginIcon {
  const objectURL = URL.createObjectURL(blob);
  let released = false;
  return Object.freeze({
    url: objectURL,
    release: () => {
      if (released) return;
      released = true;
      URL.revokeObjectURL(objectURL);
    },
  });
}

function isSupportedPluginIconURL(url: string): boolean {
  return url.startsWith('/_redevplugin/api/plugins/')
    || url.startsWith('/_redeven_proxy/api/plugins/market/plugins/');
}

function decodeImage(objectURL: string): Promise<void> {
  const image = new Image();
  image.src = objectURL;
  if (typeof image.decode === 'function') return image.decode();
  return new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Plugin icon decoding failed'));
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function abortError(): Error {
  const error = new Error('Plugin icon loading was cancelled');
  error.name = 'AbortError';
  return error;
}
