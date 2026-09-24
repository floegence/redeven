import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isHostApplicationTransferPlan, parseHostApplicationComponentsProgress, type HostApplicationTransferPlan, type HostApplicationComponentsProgress, type HostApplicationComponentsResult } from '../shared/hostApplicationComponents';

type Acquisition = { controller: AbortController; directory: string; file: string; size: number; finished: Promise<void>; finish: () => void };
// This adapter delegates acquisition/integrity to the bundled Runtime's released
// native component SDK. It owns only the initiating Desktop document and bytes.
export class HostApplicationComponents {
  private readonly entries = new Map<number, Acquisition>();
  private initialization?: Promise<void>;
  private maintenance?: Promise<void>;
  // Called only by the Desktop instance that holds its user-data single-instance lock.
  initialize(): Promise<void> {
    return this.initialization ??= (async () => {
      await fs.mkdir(this.root(), { recursive: true, mode: 0o700 });
      for (const entry of await fs.readdir(this.root(), { withFileTypes: true })) {
        if (entry.isDirectory() && /^transfer-[A-Za-z0-9]{6}$/u.test(entry.name)) {
          await fs.rm(path.join(this.root(), entry.name), { recursive: true, force: true });
        }
      }
    })();
  }
  maintainCache(): Promise<void> {
    return this.maintenance ??= this.runMaintenance().finally(() => { this.maintenance = undefined; });
  }
  private async runMaintenance(): Promise<void> {
    await this.initialize();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.executable(), ['host-application-package', '--maintenance', '--cache', path.join(this.root(), 'cache')], { stdio: ['ignore', 'ignore', 'pipe'] });
      let diagnostic = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => { diagnostic = (diagnostic + chunk).slice(-4096); });
      let failure: Error | undefined;
      child.once('error', error => { failure = error; });
      child.once('close', code => {
        if (!failure && code === 0) resolve();
        else reject(failure ?? new Error(diagnostic.trim() || 'Component cache maintenance failed'));
      });
    });
  }
  constructor(private readonly executable: () => string, private readonly root: () => string) {}
  async cancel(owner: number): Promise<void> {
    const entry = this.entries.get(owner);
    if (!entry) return;
    entry.controller.abort();
    await entry.finished;
    if (entry.directory) await fs.rm(entry.directory, { recursive: true, force: true });
    if (this.entries.get(owner) === entry) this.entries.delete(owner);
    await this.maintainCache().catch(error => { console.warn('[redeven:component-cache]', error); });
  }
  async acquire(owner: number, architecture: 'amd64' | 'arm64', progress: (value: HostApplicationComponentsProgress) => void, plan?: HostApplicationTransferPlan): Promise<HostApplicationComponentsResult> {
    if (plan && (!isHostApplicationTransferPlan(plan) || plan.architecture !== architecture)) return { ok: false, error: 'target_mismatch' };
    if (this.entries.has(owner)) return { ok: false };
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const entry: Acquisition = { controller: new AbortController(), directory: '', file: '', size: 0, finished, finish };
    this.entries.set(owner, entry);
    let ready = false;
    let targetMismatch = false;
    try {
      await this.initialize();
      entry.directory = await fs.mkdtemp(path.join(this.root(), 'transfer-'));
      entry.file = path.join(entry.directory, 'components.zip');
      if (entry.controller.signal.aborted) return { ok: false };
      await new Promise<void>((resolve, reject) => {
        const child = spawn(this.executable(), ['host-application-package', '--arch', architecture, '--cache', path.join(this.root(), 'cache'), '--output', entry.file, ...(plan ? ['--plan', JSON.stringify(plan)] : [])], { signal: entry.controller.signal, stdio: ['ignore', 'pipe', 'pipe'] });
        let pending = '';
        let diagnostic = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => { diagnostic = (diagnostic + chunk).slice(-4096); });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          pending += chunk;
          if (pending.length > 64 * 1024) { entry.controller.abort(); return; }
          let newline: number;
          while ((newline = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
            try {
              const value = parseHostApplicationComponentsProgress(JSON.parse(line));
              if (value) progress(value);
            } catch { /* Runtime diagnostics are not protocol progress. */ }
          }
        });
        let failure: Error | undefined;
        child.once('error', error => { failure = error; });
        // Abort reports an error before the process has necessarily exited.
        // Ownership and temporary files must survive until close confirms exit.
        child.once('close', code => {
          targetMismatch = code === 3;
          if (diagnostic.trim()) console.warn('[redeven:component-cache]', diagnostic.trim());
          if (!failure && code === 0) resolve(); else reject(failure ?? new Error('Component acquisition failed'));
        });
      });
      if (this.entries.get(owner) !== entry || entry.controller.signal.aborted) return { ok: false };
      entry.size = (await fs.stat(entry.file)).size;
      ready = true;
      return { ok: true, size: entry.size };
    } catch { return { ok: false, ...(targetMismatch ? { error: 'target_mismatch' as const } : {}) }; }
    finally {
      try {
        if (!ready && entry.directory) await fs.rm(entry.directory, { recursive: true, force: true });
      } finally {
        if (!ready && this.entries.get(owner) === entry) this.entries.delete(owner);
        entry.finish();
      }
    }
  }
  async read(owner: number, offset: number): Promise<HostApplicationComponentsResult> {
    const entry = this.entries.get(owner);
    if (!entry || entry.controller.signal.aborted || !Number.isSafeInteger(offset) || offset < 0 || offset >= entry.size) return { ok: false };
    const file = await fs.open(entry.file, 'r');
    try {
      const data = new Uint8Array(Math.min(256 * 1024, entry.size - offset));
      const { bytesRead } = await file.read(data, 0, data.length, offset);
      return { ok: bytesRead === data.length, data };
    } finally { await file.close(); }
  }
}
