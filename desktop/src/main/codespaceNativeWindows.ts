import type { CodespaceLoadingWindowCopy } from './codespaceLoadingDocument';
import {
  createNativeCodeSpaceGateway,
  type NativeCodeSpaceGateway,
  type NativeCodeSpaceRoute,
} from './codespaceNativeGateway';
import type { NativeCodeSpaceProfiles } from './codespaceNativeProfiles';

export type CodeSpaceOpenStage = 'loading_document' | 'profile' | 'route' | 'gateway' | 'editor_navigation';

const productErrors = new Set([
  'codespace_closed', 'codespace_password_required', 'codespace_profiles_invalid',
  'codespace_profile_invalid', 'codespace_origin_conflict', 'codespace_unavailable',
  'codespace_transport_unavailable', 'codespace_binding_invalid', 'codespace_account_required',
]);

/** Contains only bounded diagnostic codes, never an Electron error URL or credential. */
export class CodeSpaceNativeWindowError extends Error {
  constructor(readonly stage: CodeSpaceOpenStage, readonly code: string, readonly errno?: number) {
    super(code);
  }
}

export function codeSpaceWindowFailure(error: unknown, stage: CodeSpaceOpenStage): CodeSpaceNativeWindowError {
  if (error instanceof CodeSpaceNativeWindowError) return error;
  const original = error instanceof Error ? error as NodeJS.ErrnoException : undefined;
  const code = original && productErrors.has(original.message) ? original.message
    : original?.code && /^(?:ERR_[A-Z_]+|E[A-Z]+)$/u.test(original.code) && original.code.length <= 80 ? original.code
    : 'codespace_open_failed';
  return new CodeSpaceNativeWindowError(stage, code, Number.isSafeInteger(original?.errno) ? original!.errno : undefined);
}

export type NativeCodeSpaceWindow = {
  loadURL: (url: string) => Promise<void>;
  getURL: () => string;
  isDestroyed: () => boolean;
  present: () => void;
  stop: () => void;
  destroy: () => void;
  prepareSession: () => Promise<void>;
  installSession: (gateway: NativeCodeSpaceGateway) => () => void;
};

type Options = {
  identity: string;
  window: NativeCodeSpaceWindow;
  profiles: () => Pick<NativeCodeSpaceProfiles, 'port' | 'remember'>;
  loadingURL: (copy: CodespaceLoadingWindowCopy) => string;
  createRoute: (signal: AbortSignal, password?: string) => Promise<NativeCodeSpaceRoute>;
  createGateway?: typeof createNativeCodeSpaceGateway;
  onReady: (port: number) => void;
  onFailure: (failure: CodeSpaceNativeWindowError) => void;
};

/** One product window owns its documents, navigation order, and native connection lifetime. */
export class CodeSpaceNativeWindow {
  private phase: 'loading' | 'opening' | 'ready' | 'failed' | 'closed' = 'loading';
  private readonly lifetime = new AbortController();
  private document?: CodespaceLoadingWindowCopy;
  private documentRevision = 0;
  private initialDocument?: Promise<void>;
  private navigation: Promise<void> = Promise.resolve();
  private opening?: Promise<void>;
  private resources?: { gateway: NativeCodeSpaceGateway; dispose?: () => void };
  private closing?: Promise<void>;

  constructor(private readonly options: Options) {}

  private assertActive(): void {
    if (this.lifetime.signal.aborted || this.options.window.isDestroyed()) throw new Error('codespace_closed');
  }

  private enqueue(navigate: () => Promise<void>): Promise<void> {
    const result = this.navigation.then(async () => {
      this.assertActive();
      await navigate();
    });
    // Callers observe each rejection; later explicit retries still get a usable queue.
    this.navigation = result.catch(() => undefined);
    return result;
  }

  private report(error: unknown, stage: CodeSpaceOpenStage): CodeSpaceNativeWindowError {
    if (this.lifetime.signal.aborted) return new CodeSpaceNativeWindowError(stage, 'codespace_closed');
    const failure = codeSpaceWindowFailure(error, stage);
    if (!(error instanceof CodeSpaceNativeWindowError) && !this.lifetime.signal.aborted) this.options.onFailure(failure);
    return failure;
  }

  async showLoading(copy: CodespaceLoadingWindowCopy, present = true): Promise<void> {
    this.assertActive();
    if (this.phase === 'opening' || this.phase === 'ready') {
      if (present && copy.state !== 'error') this.options.window.present();
      return;
    }
    this.document = copy;
    this.phase = copy.state === 'error' ? 'failed' : 'loading';
    const first = this.initialDocument === undefined;
    const revision = ++this.documentRevision;
    const pending = this.enqueue(async () => {
      if (!first && (revision !== this.documentRevision || this.phase === 'opening' || this.phase === 'ready')) return;
      await this.options.window.loadURL(this.options.loadingURL(copy));
      this.assertActive();
    }).catch((error: unknown) => {
      if (!this.lifetime.signal.aborted) this.phase = 'failed';
      throw this.report(error, 'loading_document');
    });
    if (first) this.initialDocument = pending;
    else if (this.phase === 'loading') this.initialDocument = pending;
    await pending;
    this.assertActive();
    if (present) this.options.window.present();
  }

  async refreshLoading(): Promise<void> {
    if (this.phase === 'closed' || this.phase === 'opening' || this.phase === 'ready' || !this.document) return;
    await this.showLoading(this.document, false);
  }

  allowsNavigation(url: string): boolean {
    try {
      const target = new URL(url);
      return Boolean(this.resources && !target.username && !target.password && target.origin === this.resources.gateway.origin);
    } catch { return false; }
  }

  open(password?: string): Promise<void> {
    if (this.opening) return this.opening;
    if (this.phase === 'ready') {
      this.options.window.present();
      return Promise.resolve();
    }
    if (this.phase === 'closed') return Promise.reject(new Error('codespace_closed'));
    this.phase = 'opening';
    this.document = undefined;
    ++this.documentRevision;
    const pending = this.prepare(password);
    this.opening = pending;
    void pending.finally(() => { if (this.opening === pending) this.opening = undefined; }).catch(() => undefined);
    return pending;
  }

  private async prepare(password?: string): Promise<void> {
    let stage: CodeSpaceOpenStage = 'loading_document';
    try {
      if (!this.initialDocument) throw new Error('codespace_open_failed');
      await this.initialDocument;
      await this.navigation;
      this.assertActive();
      stage = 'profile';
      const profiles = this.options.profiles();
      const port = profiles.port(this.options.identity);
      stage = 'route';
      const route = await this.options.createRoute(this.lifetime.signal, password);
      if (this.lifetime.signal.aborted) { await route.close(); throw new Error('codespace_closed'); }
      stage = 'gateway';
      const gateway = await (this.options.createGateway ?? createNativeCodeSpaceGateway)(route, port);
      if (this.lifetime.signal.aborted) { await gateway.close(); throw new Error('codespace_closed'); }
      const resources = { gateway, dispose: undefined as (() => void) | undefined };
      this.resources = resources;
      profiles.remember(this.options.identity, gateway.port);
      await this.options.window.prepareSession();
      this.assertActive();
      resources.dispose = this.options.window.installSession(gateway);
      stage = 'editor_navigation';
      await this.enqueue(async () => {
        await this.options.window.loadURL(gateway.origin + '/');
        this.assertActive();
        if (!this.allowsNavigation(this.options.window.getURL())) throw new Error('codespace_open_failed');
      });
      this.assertActive();
      this.phase = 'ready';
      this.options.onReady(gateway.port);
    } catch (error) {
      await this.releaseResources();
      if (!this.lifetime.signal.aborted) this.phase = 'failed';
      throw this.report(error, stage);
    }
  }

  async navigate(url: string): Promise<void> {
    if (this.opening) await this.opening;
    this.assertActive();
    if (!this.allowsNavigation(url)) return;
    try {
      await this.enqueue(async () => {
        if (!this.allowsNavigation(url)) return;
        await this.options.window.loadURL(url);
        this.assertActive();
      });
    } catch (error) { throw this.report(error, 'editor_navigation'); }
  }

  private releaseResources(): Promise<void> {
    const resources = this.resources;
    this.resources = undefined;
    resources?.dispose?.();
    return resources?.gateway.close() ?? Promise.resolve();
  }

  close(destroyWindow = true): Promise<void> {
    if (this.closing) return this.closing;
    this.phase = 'closed';
    this.document = undefined;
    this.lifetime.abort();
    const resourcesClosed = this.releaseResources();
    this.closing = Promise.all([resourcesClosed, this.opening?.catch(() => undefined), this.navigation]).then(() => undefined);
    if (!this.options.window.isDestroyed()) {
      this.options.window.stop();
      if (destroyWindow) this.options.window.destroy();
    }
    return this.closing;
  }
}
