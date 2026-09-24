import type { BrowserWindow, BrowserWindowConstructorOptions, WindowOpenHandlerResponse } from 'electron';

const documentPath = '/_redeven_proxy/env/browser/';
type Owner = { pending: Map<string, number>; windows: Set<BrowserWindow>; dispose(): void };

/** Only an authenticated environment root can reserve an exact document URL.
 * window.open preserves the native opener/MessagePort relationship while the
 * child receives no preload, Session owner, or generic Desktop bridge. */
export class BrowserProjectionWindows {
  private owners = new Map<number, Owner>();
  constructor(private create: (options: BrowserWindowConstructorOptions) => BrowserWindow) {}

  prepare(parent: BrowserWindow, value: unknown): boolean {
    if (parent.isDestroyed() || typeof value !== 'string') return false;
    let url: URL;
    try {
      url = new URL(value);
      if (url.origin !== new URL(parent.webContents.getURL()).origin || !['http:', 'https:'].includes(url.protocol)
        || url.username || url.password || url.search !== `?instance=${url.hash.slice(1)}` || url.pathname !== documentPath || !/^#[a-zA-Z0-9-]{16,128}$/u.test(url.hash)) return false;
    } catch { return false; }
    let owner = this.owners.get(parent.webContents.id);
    if (!owner) {
      const id = parent.webContents.id;
      const close = () => {
        const current = this.owners.get(id);
        if (!current) return;
        this.owners.delete(id); current.dispose(); current.pending.clear();
        for (const window of current.windows) if (!window.isDestroyed()) window.close();
      };
      const navigate = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (mainFrame && !inPlace) close(); };
      owner = { pending: new Map(), windows: new Set(), dispose: () => {
        parent.webContents.removeListener('destroyed', close);
        parent.webContents.removeListener('did-start-navigation', navigate);
      } };
      this.owners.set(id, owner);
      parent.webContents.once('destroyed', close);
      parent.webContents.on('did-start-navigation', navigate);
    }
    for (const [key, expiry] of owner.pending) if (expiry <= Date.now()) owner.pending.delete(key);
    if (owner.pending.size + owner.windows.size >= 16) return false;
    owner.pending.set(url.href, Date.now() + 30000);
    return true;
  }

  consume(parent: BrowserWindow, details: { url: string }): WindowOpenHandlerResponse | undefined {
    let url: URL;
    try { url = new URL(details.url); } catch { return undefined; }
    if (!url.pathname.startsWith('/_redeven_proxy/env/browser/')) return undefined;
    const owner = this.owners.get(parent.webContents.id);
    const expiry = owner?.pending.get(url.href) ?? 0;
    owner?.pending.delete(url.href);
    if (!owner || expiry <= Date.now() || parent.isDestroyed()) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: { width: 1280, height: 900, minWidth: 720, minHeight: 480, frame: true, titleBarStyle: 'default', show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } },
      createWindow: options => {
        const preferences = { ...options.webPreferences };
        delete preferences.preload;
        const child = this.create({ ...options, webPreferences: { ...preferences, session: parent.webContents.session,
          sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
        owner.windows.add(child);
        child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        let currentURL = url.href;
        child.webContents.on('will-navigate', (event, destination) => {
          if (destination === currentURL) return;
          const expiry = owner.pending.get(destination) ?? 0;
          owner.pending.delete(destination);
          if (expiry > Date.now()) currentURL = destination;
          else event.preventDefault();
        });
        child.once('ready-to-show', () => { if (!child.isDestroyed()) child.show(); });
        child.once('closed', () => owner.windows.delete(child));
        return child.webContents;
      },
    };
  }
}
