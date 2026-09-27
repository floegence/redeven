import type { BrowserWindow, BrowserWindowConstructorOptions, WindowOpenHandlerResponse } from 'electron';

const documentPath = '/_redeven_proxy/env/browser/';
type Owner = { pending: Map<string, number>; windows: Map<BrowserWindow, string>; dispose(): void };

/** Only an authenticated environment root can reserve an exact document URL.
 * window.open preserves the native opener/MessagePort relationship while the
 * child receives no preload, Session owner, or generic Desktop bridge. */
export class BrowserProjectionWindows {
  private owners = new Map<number, Owner>();
  constructor(private create: (options: BrowserWindowConstructorOptions) => BrowserWindow) {}

  prepare(parent: BrowserWindow, value: unknown): boolean {
    if (parent.isDestroyed() || typeof value !== 'string') return false;
    const contents = parent.webContents;
    let url: URL;
    try {
      url = new URL(value);
      if (url.origin !== new URL(contents.getURL()).origin || !['http:', 'https:'].includes(url.protocol)
        || url.username || url.password || url.search !== `?instance=${url.hash.slice(1)}` || url.pathname !== documentPath || !/^#[a-zA-Z0-9-]{16,128}$/u.test(url.hash)) return false;
    } catch { return false; }
    let owner = this.owners.get(contents.id);
    if (!owner) {
      const id = contents.id;
      const close = () => {
        const current = this.owners.get(id);
        if (!current) return;
        this.owners.delete(id); current.dispose(); current.pending.clear();
        for (const window of current.windows.keys()) if (!window.isDestroyed()) window.close();
      };
      const navigate = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (mainFrame && !inPlace) close(); };
      owner = { pending: new Map(), windows: new Map(), dispose: () => {
        contents.removeListener('destroyed', close);
        contents.removeListener('did-start-navigation', navigate);
      } };
      this.owners.set(id, owner);
      contents.once('destroyed', close);
      contents.on('did-start-navigation', navigate);
    }
    for (const [key, expiry] of owner.pending) if (expiry <= Date.now()) owner.pending.delete(key);
    if (owner.pending.size + owner.windows.size >= 16) return false;
    owner.pending.set(url.href, Date.now() + 30000);
    return true;
  }

  /** Lend bridge headers only to the reserved static document and its assets.
   * This does not register the child as an environment or IPC/Session owner. */
  staticRequestOwner(contentsID: number, request: { url: string; method: string }): number | undefined {
    if (request.method !== 'GET') return;
    let requested: URL;
    try { requested = new URL(request.url); } catch { return; }
    if (requested.username || requested.password) return;
    for (const [parent, owner] of this.owners) for (const [child, document] of owner.windows) {
      if (child.isDestroyed() || child.webContents.id !== contentsID) continue;
      const reserved = new URL(document);
      if (requested.origin !== reserved.origin) return;
      requested.hash = ''; reserved.hash = '';
      if (requested.href === reserved.href || requested.pathname.startsWith('/_redeven_proxy/env/assets/')) return parent;
    }
  }

  consume(parent: BrowserWindow, details: { url: string }): WindowOpenHandlerResponse | undefined {
    let url: URL;
    try { url = new URL(details.url); } catch { return undefined; }
    if (!url.pathname.startsWith('/_redeven_proxy/env/browser/')) return undefined;
    if (parent.isDestroyed()) return { action: 'deny' };
    const owner = this.owners.get(parent.webContents.id);
    const expiry = owner?.pending.get(url.href) ?? 0;
    owner?.pending.delete(url.href);
    if (!owner || expiry <= Date.now()) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: { width: 1280, height: 900, minWidth: 720, minHeight: 480, frame: true, titleBarStyle: 'default', show: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } },
      createWindow: options => {
        const preferences = { ...options.webPreferences };
        delete preferences.preload;
        const child = this.create({ ...options, webPreferences: { ...preferences, session: parent.webContents.session,
          sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
        owner.windows.set(child, url.href);
        child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        child.webContents.on('will-navigate', (event, destination) => {
          if (destination === owner.windows.get(child)) return;
          const expiry = owner.pending.get(destination) ?? 0;
          owner.pending.delete(destination);
          if (expiry > Date.now()) owner.windows.set(child, destination);
          else event.preventDefault();
        });
        child.once('closed', () => owner.windows.delete(child));
        return child.webContents;
      },
    };
  }
}
