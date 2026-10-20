import { batch, createSignal } from 'solid-js';
import type { DirectoryFavorites } from '@floegence/floe-webapp-core/ui';

export type DirectoryFavoritesSnapshot = Readonly<{ paths: readonly string[]; revision: number }>;
export type DirectoryFavoritesRequest = (method: 'GET' | 'PUT' | 'DELETE', path: string | undefined, signal: AbortSignal) => Promise<DirectoryFavoritesSnapshot>;

/** Capture both the scoped client and logical path when a menu opens. */
export function directoryFavoriteAction(path: string, favorites: DirectoryFavorites | undefined, copy: { favoriteDirectory: string; unfavoriteDirectory: string }, onError: (error: unknown) => void) {
  if (!path || !favorites?.editable || !favorites.onSetFavorite) return undefined;
  const favorite = !favorites.paths.includes(path);
  return {
    label: favorite ? copy.favoriteDirectory : copy.unfavoriteDirectory,
    get disabled() { return !favorites.editable || (favorites.pendingPaths?.includes(path) ?? false); },
    run: () => { if (favorites.editable && !favorites.pendingPaths?.includes(path)) void favorites.onSetFavorite!(path, favorite).catch(onError); },
  };
}

/** One in-memory owner per authenticated environment; no independent browser persistence. */
export function createDirectoryFavoritesClient(request: DirectoryFavoritesRequest) {
  const [snapshot, setSnapshot] = createSignal<DirectoryFavoritesSnapshot>({ paths: [], revision: -1 });
  const [loading, setLoading] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [pending, setPending] = createSignal<readonly string[]>([]);
  const lifetime = new AbortController();
  let read: AbortController | undefined;
  let activeRead: Promise<void> | undefined;
  const accept = (next: DirectoryFavoritesSnapshot) => {
    if (lifetime.signal.aborted) return;
    if (!Number.isSafeInteger(next.revision) || next.revision < 0 || !Array.isArray(next.paths) || next.paths.some(path => typeof path !== 'string' || !path.startsWith('/'))) throw new Error('Invalid directory favorites snapshot');
    if (next.revision >= snapshot().revision) setSnapshot({ paths: [...next.paths], revision: next.revision });
  };
  const refresh = (): Promise<void> => {
    if (lifetime.signal.aborted) return Promise.resolve();
    if (activeRead) return activeRead;
    const controller = new AbortController();
    read = controller; setLoading(true);
    activeRead = (async () => {
      try { accept(await request('GET', undefined, AbortSignal.any([controller.signal, lifetime.signal]))); if (!lifetime.signal.aborted) setFailed(false); }
      catch { if (!controller.signal.aborted && !lifetime.signal.aborted) setFailed(true); }
      finally { if (read === controller) { read = undefined; activeRead = undefined; setLoading(false); } }
    })();
    return activeRead;
  };
  const setFavorite = async (path: string, favorite: boolean) => {
    if (lifetime.signal.aborted) throw new DOMException('Environment disconnected', 'AbortError');
    if (pending().includes(path)) return;
    setPending(paths => [...paths, path]);
    try { accept(await request(favorite ? 'PUT' : 'DELETE', path, lifetime.signal)); if (!lifetime.signal.aborted) setFailed(false); }
    finally { if (!lifetime.signal.aborted) setPending(paths => paths.filter(item => item !== path)); }
  };
  const focus = () => { void refresh(); };
  if (typeof window !== 'undefined') window.addEventListener?.('focus', focus);
  return {
    refresh, setFavorite,
    view(errorMessage: () => string): DirectoryFavorites {
      return {
        get paths() { return snapshot().paths; }, get loading() { return loading(); },
        get error() { return failed() ? errorMessage() : undefined; }, get editable() { return !lifetime.signal.aborted; },
        get pendingPaths() { return pending(); }, onRefresh: refresh,
        onSetFavorite: async (path, favorite) => {
          if (lifetime.signal.aborted) throw new DOMException('Environment disconnected', 'AbortError');
          try { await setFavorite(path, favorite); }
          catch (cause) { if (!lifetime.signal.aborted) throw new Error(errorMessage(), { cause }); }
        },
      };
    },
    dispose() {
      lifetime.abort(); read?.abort();
      batch(() => { setSnapshot({ paths: [], revision: -1 }); setPending([]); setLoading(false); setFailed(false); });
      if (typeof window !== 'undefined') window.removeEventListener?.('focus', focus);
    },
  };
}
