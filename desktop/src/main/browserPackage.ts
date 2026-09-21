import type { IpcMainInvokeEvent } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseBrowserPackageProgress, type BrowserPackageIdentity, type BrowserPackageProgress, type BrowserPackageRequest, type BrowserPackageResult } from '../shared/browserPackageIPC';

type Job = {
  id: string; environmentID: string; controller: AbortController; package: BrowserPackageIdentity;
  file: string; finished: Promise<void>; finish: () => void;
};
export function browserPackageOwner(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  session: { closing: boolean; target: { environment_id: string }; root_window: { webContentsID: number } } | null | undefined,
  launcherEnvironmentID?: string,
): { id: number; environmentID: string } | undefined {
  if (event.sender.isDestroyed() || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) return;
  if (session && !session.closing && session.root_window.webContentsID === event.sender.id) return { id: event.sender.id, environmentID: session.target.environment_id };
  if (launcherEnvironmentID) return { id: event.sender.id, environmentID: launcherEnvironmentID };
}

// Desktop owns process and byte access. The bundled Runtime resolves its pinned
// catalog and delegates acquisition/integrity to the released upstream SDK.
export class BrowserPackages {
  private readonly jobs = new Map<number, Job>();
  constructor(private readonly executable: () => string, private readonly root: () => string) {}

  async request(owner: number, environmentID: string, request: BrowserPackageRequest, progress: (value: BrowserPackageProgress) => void): Promise<BrowserPackageResult> {
    if (request.action === 'acquire') return this.acquire(owner, environmentID, request, progress);
    const job = this.jobs.get(owner);
    if (!job || job.environmentID !== environmentID || job.id !== request.operation_id) return { ok: false, error: 'unavailable' };
    if (request.action === 'cancel' || request.action === 'release') {
      await this.cancel(owner, request.operation_id); return { ok: true };
    }
    if (request.action !== 'read') return { ok: false, error: 'unavailable' };
    if (!job.file || job.controller.signal.aborted || request.offset >= job.package.size_bytes) return { ok: false, error: 'unavailable' };
    const file = await fs.open(job.file, 'r');
    try {
      const data = new Uint8Array(Math.min(256 * 1024, job.package.size_bytes - request.offset));
      const { bytesRead } = await file.read(data, 0, data.length, request.offset);
      return bytesRead === data.length && !job.controller.signal.aborted ? { ok: true, data } : { ok: false, error: 'unavailable' };
    } finally { await file.close(); }
  }

  async cancel(owner: number, operationID?: string): Promise<void> {
    const job = this.jobs.get(owner);
    if (!job || (operationID && operationID !== job.id)) return;
    job.controller.abort();
    await job.finished;
    if (this.jobs.get(owner) === job) this.jobs.delete(owner);
  }

  async cancelEnvironment(environmentID: string): Promise<void> {
    await Promise.all([...this.jobs].filter(([, job]) => job.environmentID === environmentID).map(([owner]) => this.cancel(owner)));
  }

  async close(): Promise<void> { await Promise.all([...this.jobs.keys()].map(owner => this.cancel(owner))); }

  private async acquire(owner: number, environmentID: string, request: Extract<BrowserPackageRequest, { action: 'acquire' }>, progress: (value: BrowserPackageProgress) => void): Promise<BrowserPackageResult> {
    if (this.jobs.has(owner)) return { ok: false, error: 'unavailable' };
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const job: Job = { id: request.operation_id, environmentID, package: request.package, controller: new AbortController(), file: '', finished, finish };
    this.jobs.set(owner, job);
    let ready = false;
    let mismatch = false;
    try {
      const root = this.root();
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      if (job.controller.signal.aborted) return { ok: false, error: 'unavailable' };
      let completed: { package: BrowserPackageIdentity; from_cache: boolean } | undefined;
      await new Promise<void>((resolve, reject) => {
        const child = spawn(this.executable(), ['browser-package', '--package-id', job.package.id, '--sha256', job.package.sha256,
          '--size', String(job.package.size_bytes), '--cache', root], { signal: job.controller.signal, stdio: ['ignore', 'pipe', 'ignore'] });
        let pending = '';
        let lastProgress: BrowserPackageProgress | undefined;
        let progressAt = 0;
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          pending += chunk;
          if (pending.length > 64 * 1024) { job.controller.abort(); return; }
          let newline: number;
          while ((newline = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
            try {
              const value = JSON.parse(line) as Record<string, unknown>;
              if (value.error === 'package_mismatch') mismatch = true;
              const update = parseBrowserPackageProgress({ ...value, operation_id: job.id });
              if (update && update.total_bytes === job.package.size_bytes && (update.phase !== lastProgress?.phase
                || update.received_bytes === update.total_bytes || Date.now() - progressAt >= 100)) {
                progressAt = Date.now(); lastProgress = update; progress(update);
              }
              if (value.complete === true && value.package && typeof value.from_cache === 'boolean') {
                const pkg = value.package as BrowserPackageIdentity;
                if (pkg.id !== job.package.id || pkg.sha256 !== job.package.sha256 || pkg.size_bytes !== job.package.size_bytes) { mismatch = true; job.controller.abort(); }
                else completed = { package: pkg, from_cache: value.from_cache };
              }
            } catch { job.controller.abort(); }
          }
        });
        let failure: Error | undefined;
        child.once('error', error => { failure = error; });
        child.once('close', code => !failure && code === 0 ? resolve() : reject(failure ?? new Error('Browser acquisition failed')));
      });
      if (!completed || job.controller.signal.aborted || this.jobs.get(owner) !== job) return { ok: false, error: 'acquisition_failed' };
      // The command never chooses a path. Only a verified digest in our own root
      // can be read, and its original bytes are verified again by the target.
      const file = path.join(root, job.package.sha256);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size !== job.package.size_bytes) return { ok: false, error: 'acquisition_failed' };
      job.file = file; ready = true;
      return { ok: true, ...completed };
    } catch { return { ok: false, error: mismatch ? 'package_mismatch' : 'acquisition_failed' }; }
    finally {
      if (!ready && this.jobs.get(owner) === job) this.jobs.delete(owner);
      job.finish();
    }
  }
}
