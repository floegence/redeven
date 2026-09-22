import type { FlowerBrowserInstallation, FlowerBrowserInstallationSnapshot, FlowerBrowserInstallRequest } from '../src/contracts/flowerSurfaceContracts';
import type { BrowserPackageBridge, BrowserPackageProgress } from '../../../desktop/src/shared/browserPackageIPC';

export type ComputerRequest = <T>(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown) => Promise<T>;
const path = '/_redeven_proxy/api/browser/installation';
const activeStates = new Set(['downloading', 'uploading', 'verifying', 'installing']);
type Attempt = { source: 'download' | 'upload'; id: string; cancelled: boolean; runtimeID: string; done?: Promise<void> };

// One environment document owns transfer work. Panels are observers, never
// owners of acquisition, upload, or the Runtime's installed state.
export class BrowserInstallationController {
  private status?: FlowerBrowserInstallation;
  private attempt?: Attempt;
  private progress?: BrowserPackageProgress;
  private failure?: FlowerBrowserInstallationSnapshot['desktop_error'];
  private readonly listeners = new Set<(status: FlowerBrowserInstallationSnapshot) => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private observation = 0;
  private disposed = false;
  constructor(private readonly request: ComputerRequest, readonly desktop?: BrowserPackageBridge) {}

  snapshot(): FlowerBrowserInstallationSnapshot | undefined {
    return this.status ? { ...this.status, desktop_progress: this.progress, desktop_error: this.failure, transfer_active: Boolean(this.attempt) } : undefined;
  }
  subscribe(listener: (status: FlowerBrowserInstallationSnapshot) => void): () => void {
    this.listeners.add(listener);
    const current = this.snapshot(); if (current) listener(current);
    return () => { this.listeners.delete(listener); };
  }
  private publish(): void {
    const current = this.snapshot(); if (!current || this.disposed) return;
    for (const listener of this.listeners) listener(current);
  }
  private accept(status: FlowerBrowserInstallation): void { this.observation++; this.status = status; this.publish(); }
  async load(): Promise<FlowerBrowserInstallationSnapshot> {
    const revision = ++this.observation;
    const status = await this.request<FlowerBrowserInstallation>('GET', path);
    if (!this.disposed && revision === this.observation) { if (this.failure === 'status_failed') this.failure = undefined; this.status = status; this.publish(); this.observe(); }
    return this.snapshot() ?? status;
  }
  private observe(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.disposed || this.attempt || !activeStates.has(this.status?.state ?? '')) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.load().catch(() => { this.failure = 'status_failed'; this.publish(); });
    }, 800);
  }
  async setEnabled(enabled: boolean): Promise<FlowerBrowserInstallationSnapshot> {
    if (!enabled) await this.cancel();
    this.accept(await this.request<FlowerBrowserInstallation>('PUT', path, { enabled }));
    return this.snapshot()!;
  }
  async install(input: FlowerBrowserInstallRequest): Promise<FlowerBrowserInstallationSnapshot> {
    if (input.action === 'cancel') { await this.cancel(); return this.snapshot() ?? await this.load(); }
    if (input.action !== 'start') throw new Error('Browser transfer is owned by its environment controller.');
    if (this.attempt) return this.snapshot() ?? await this.load();
    if (!this.status) await this.load();
    if (this.attempt) return this.snapshot()!;
    if (!this.status?.enabled || this.disposed) throw new Error('Browser installation is unavailable.');
    if (activeStates.has(this.status.state) || this.status.state === 'installed') return this.snapshot()!;
    if (input.package_id !== this.status.package.id || !['download', 'upload'].includes(input.source ?? '')) throw new Error('Invalid browser installation request.');
    if (input.source === 'upload' && !this.desktop) throw new Error('Desktop acquisition is unavailable.');
    const attempt: Attempt = { source: input.source as 'download' | 'upload', id: crypto.randomUUID(), cancelled: false, runtimeID: '' };
    this.attempt = attempt; this.failure = undefined; this.observation++;
    if (input.source === 'upload') this.progress = { operation_id: attempt.id, phase: 'checking', received_bytes: 0, total_bytes: this.status.package.size_bytes };
    this.publish();
    attempt.done = this.run(attempt, input);
    return this.snapshot()!;
  }
  private async run(attempt: Attempt, input: FlowerBrowserInstallRequest): Promise<void> {
    let unsubscribe: (() => void) | undefined;
    let stage: FlowerBrowserInstallationSnapshot['desktop_error'] = 'desktop_download_failed';
    const check = () => { if (attempt.cancelled || this.disposed) throw new Error('Browser installation cancelled.'); };
    try {
      const current = await this.request<FlowerBrowserInstallation>('GET', path);
      check(); this.accept(current);
      if (!current.enabled || current.package.id !== input.package_id) throw new Error('Browser availability changed.');
      if (current.state === 'installed' || activeStates.has(current.state)) return;
      if (input.source === 'upload') {
        const desktop = this.desktop!;
        const pkg = { id: current.package.id, sha256: current.package.sha256, size_bytes: current.package.size_bytes };
        unsubscribe = desktop.subscribe(progress => {
          if (progress.operation_id === attempt.id && !attempt.cancelled && this.attempt === attempt) { this.progress = progress; this.publish(); }
        });
        const acquired = await desktop.request({ action: 'acquire', operation_id: attempt.id, package: pkg });
        check();
        if (!acquired.ok) { if (acquired.error === 'package_mismatch') stage = 'package_mismatch'; throw new Error('Desktop acquisition failed.'); }
        if (acquired.package?.id !== pkg.id || acquired.package.sha256 !== pkg.sha256 || acquired.package.size_bytes !== pkg.size_bytes) {
          stage = 'package_mismatch'; throw new Error('Browser package identity changed.');
        }
      }
      check();
      stage = 'desktop_upload_failed';
      const started = await this.request<FlowerBrowserInstallation>('POST', path, input);
      attempt.runtimeID = started.operation_id ?? '';
      this.progress = undefined; this.accept(started); check();
      if (input.source !== 'upload' || started.state !== 'uploading') return;
      if (!attempt.runtimeID || started.received_bytes !== 0) throw new Error('Unexpected browser upload operation.');
      for (let offset = 0; offset < current.package.size_bytes;) {
        check();
        const chunk = await this.desktop!.request({ action: 'read', operation_id: attempt.id, offset });
        check();
        const expected = Math.min(256 * 1024, current.package.size_bytes - offset);
        if (!chunk.ok || !chunk.data || chunk.data.length !== expected) throw new Error('Incomplete browser package chunk.');
        let binary = ''; for (const byte of chunk.data) binary += String.fromCharCode(byte);
        const uploaded = await this.request<FlowerBrowserInstallation>('POST', path, { action: 'chunk', operation_id: attempt.runtimeID, offset, data: btoa(binary) });
        check();
        if (uploaded.operation_id !== attempt.runtimeID || uploaded.received_bytes !== offset + expected) throw new Error('Browser upload cursor changed.');
        offset = uploaded.received_bytes; this.accept(uploaded);
      }
      check();
      this.accept(await this.request<FlowerBrowserInstallation>('POST', path, { action: 'complete', operation_id: attempt.runtimeID }));
    } catch {
      // Never replay a request whose result is unknown. Observe the host and
      // offer an explicit retry/cancel instead of starting a second operation.
      if (attempt.runtimeID && this.status?.state === 'uploading') {
        try { this.accept(await this.request<FlowerBrowserInstallation>('POST', path, { action: 'cancel', operation_id: attempt.runtimeID })); } catch { /* A later status read remains authoritative. */ }
      }
      try { this.accept(await this.request<FlowerBrowserInstallation>('GET', path)); } catch { /* Retain the last confirmed snapshot. */ }
      if (!attempt.cancelled && !this.disposed) this.failure = input.source === 'upload' ? stage : 'status_failed';
    } finally {
      unsubscribe?.();
      if (input.source === 'upload') await this.desktop!.request({ action: 'release', operation_id: attempt.id }).catch(() => undefined);
      if (this.attempt === attempt) { this.attempt = undefined; this.progress = undefined; }
      this.publish(); this.observe();
    }
  }
  async cancel(): Promise<void> {
    const attempt = this.attempt;
    if (attempt) {
      attempt.cancelled = true;
      await this.desktop?.request({ action: 'cancel', operation_id: attempt.id }).catch(() => undefined);
      await attempt.done;
    }
    const status = this.status;
    if (status?.operation_id && activeStates.has(status.state)) {
      this.accept(await this.request<FlowerBrowserInstallation>('POST', path, { action: 'cancel', operation_id: status.operation_id }));
    }
    this.failure = undefined; this.observe(); this.publish();
  }
  dispose(): void {
    this.disposed = true; this.listeners.clear();
    if (this.timer) clearTimeout(this.timer);
    // An environment download is already owned by Runtime. Only Desktop's
    // unfinished acquisition/upload depends on this document's lifetime.
    if (this.attempt?.source === 'upload') {
      this.attempt.cancelled = true;
      // Dispatch the known upload cancellation before document teardown can
      // prevent an awaited Desktop response from returning to this renderer.
      if (this.attempt.runtimeID && this.status?.state === 'uploading') {
        void this.request('POST', path, { action: 'cancel', operation_id: this.attempt.runtimeID }).catch(() => undefined);
      }
      void this.cancel().catch(() => undefined);
    }
  }
}

let session: { key: string; controller: BrowserInstallationController } | undefined;
export function browserInstallationForSession(key: string, request: ComputerRequest, desktop?: BrowserPackageBridge): BrowserInstallationController {
  if (session?.key === key) return session.controller;
  session?.controller.dispose();
  const controller = new BrowserInstallationController(request, desktop);
  session = { key, controller };
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
    controller.dispose(); if (session?.controller === controller) session = undefined;
  }, { once: true });
  return controller;
}
