import { createHash } from 'node:crypto';
import type { DesktopSSHTransportLease } from './sshTransportManager';
import { parseDesktopDeploymentProgress, type DesktopDeploymentOperation, type DesktopDeploymentProgress, type DesktopDeploymentResult } from '../shared/remoteDesktopDeployment';

export type DesktopServiceKit = Readonly<{ files: ReadonlyMap<string, Buffer>; serviceSHA256: string; workerSHA256: string }>;
export type DesktopDeploymentHost = Readonly<{
  lease: DesktopSSHTransportLease;
  runtimePID: number;
  loadKit: (architecture: 'amd64' | 'arm64', signal: AbortSignal) => Promise<DesktopServiceKit>;
}>;
type DesktopDeploymentHostSource = DesktopDeploymentHost | ((signal: AbortSignal) => Promise<DesktopDeploymentHost>);
export class DesktopDeploymentPermissionError extends Error {
  constructor() { super('Desktop deployment permission denied'); }
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const sha256 = /^[a-f0-9]{64}$/u;

// Credentials belong only to this SSH transaction. Runtime APIs, daemon input,
// command arguments and diagnostics must never receive them.
export class RemoteDesktopDeployment {
  private readonly operations = new Map<number, { controller: AbortController; finished: Promise<DesktopDeploymentResult> }>();
  async cancel(owner: number): Promise<void> {
    const operation = this.operations.get(owner);
    if (operation) { operation.controller.abort(); await operation.finished; }
  }
  async dispose(): Promise<void> {
    await Promise.allSettled([...this.operations.keys()].map(owner => this.cancel(owner)));
  }
  async manage(owner: number, host: DesktopDeploymentHostSource, operation: DesktopDeploymentOperation, password: string | undefined, report: (event: DesktopDeploymentProgress) => void): Promise<DesktopDeploymentResult> {
    if (this.operations.has(owner)) return { ok: false, code: 'operation_in_progress' };
    const controller = new AbortController();
    const credential = Buffer.from(password ?? '', 'utf8');
    password = undefined;
    const finished = this.execute(host, operation, credential, controller.signal, report);
    this.operations.set(owner, { controller, finished });
    try { return await finished; }
    finally { credential.fill(0); if (this.operations.get(owner)?.finished === finished) this.operations.delete(owner); }
  }
  private async execute(source: DesktopDeploymentHostSource, operation: DesktopDeploymentOperation, credential: Buffer, signal: AbortSignal, report: (event: DesktopDeploymentProgress) => void): Promise<DesktopDeploymentResult> {
    let directory = '', privilegedStarted = false;
    let rollback: DesktopDeploymentResult['rollback'];
    let host: DesktopDeploymentHost | undefined;
    try {
      report({ stage: 'checking' });
      host = typeof source === 'function' ? await source(signal) : source;
      signal.throwIfAborted();
      if (!Number.isSafeInteger(host.runtimePID) || host.runtimePID <= 0) return { ok: false, code: 'invalid_request' };
      // Resolve process identity on the selected host, never from renderer paths.
      const probe = await host.lease.run(`uname -s; uname -m; stat -c '%u %g' /proc/${host.runtimePID}; sha256sum /proc/${host.runtimePID}/exe`, { signal, timeout_ms: 15_000 });
      const lines = probe.stdout.trim().split('\n');
      const architecture = lines[1] === 'x86_64' ? 'amd64' : lines[1] === 'aarch64' ? 'arm64' : undefined;
      const identity = /^(\d+) (\d+)$/u.exec(lines[2] ?? '');
      const runtimeSHA256 = (lines[3] ?? '').split(/\s/u)[0];
      if (probe.exit_code !== 0 || lines.length !== 4 || lines[0] !== 'Linux' || !architecture || !identity || !sha256.test(runtimeSHA256)) return { ok: false, code: 'unsupported_target' };
      const runtimeUID = Number(identity[1]), runtimeGID = Number(identity[2]);
      if (!Number.isSafeInteger(runtimeUID) || runtimeUID <= 0 || runtimeUID > 2 ** 32 - 1 || !Number.isSafeInteger(runtimeGID) || runtimeGID > 2 ** 32 - 1) return { ok: false, code: 'unsupported_target' };
      const kit = await host.loadKit(architecture, signal);
      if (!sha256.test(kit.serviceSHA256) || !sha256.test(kit.workerSHA256)
        || digest(kit.files.get('floe-host-desktop-service') ?? Buffer.alloc(0)) !== kit.serviceSHA256
        || digest(kit.files.get('desktop-drm') ?? Buffer.alloc(0)) !== kit.workerSHA256) return { ok: false, code: 'deployment_failed' };
      const temporary = await host.lease.run('umask 077; mktemp -d /tmp/redeven-desktop-ssh-XXXXXX', { signal, timeout_ms: 10_000 });
      directory = temporary.stdout.trim();
      if (temporary.exit_code !== 0 || !/^\/tmp\/redeven-desktop-ssh-[A-Za-z0-9]{6}$/u.test(directory)) { directory = ''; return { ok: false, code: 'deployment_failed' }; }
      report({ stage: 'transferring' });
      for (const name of ['floe-host-desktop-service', 'desktop-drm', 'libdrmtap.LICENSE']) {
        const data = kit.files.get(name);
        if (!data || data.length === 0 || data.length > 128 << 20) return { ok: false, code: 'deployment_failed' };
        const uploaded = await host.lease.run(`cat > ${quote(`${directory}/${name}`)}`, { stdinData: data, signal, timeout_ms: 30_000 });
        if (uploaded.exit_code !== 0) return { ok: false, code: 'deployment_failed' };
      }
      const request = { operation, source_directory: directory, runtime_uid: runtimeUID, runtime_gid: runtimeGID, runtime_sha256: runtimeSHA256, service_sha256: kit.serviceSHA256, worker_sha256: kit.workerSHA256 };
      // Verify copied bytes in a private root-owned directory on the installed
      // service filesystem; /run is legitimately mounted noexec on some hosts.
      // Send the request only after sudo has consumed its credential and root
      // has reported authority; a NOPASSWD operation never receives a password.
      const bootstrap = `set -eu; umask 077; stage=$(mktemp -d /usr/lib/redeven-desktop-authorize-XXXXXX); trap 'rm -rf -- "$stage"' EXIT; install -m 0700 -- ${quote(`${directory}/floe-host-desktop-service`)} "$stage/manage"; printf '%s  %s\\n' ${quote(kit.serviceSHA256)} "$stage/manage" | sha256sum -c - >/dev/null; printf '%s\\n' '{"stage":"authorized"}'; "$stage/manage" manage`;
      const command = `if [ "$(id -u)" = 0 ]; then /bin/sh -c ${quote(bootstrap)}; elif sudo -n true 2>/dev/null; then sudo -n /bin/sh -c ${quote(bootstrap)}; else printf '%s\\n' '{"stage":"authorization_required"}'; sudo -S -p '' /bin/sh -c ${quote(bootstrap)}; fi`;
      // Close the lifeline on cancellation. Keep SSH alive for rollback output.
      const stream = host.lease.stream(command, { timeout_ms: 120_000 });
      // SSH exposes command bytes and checked transport completion separately.
      // Observe rejection immediately, including expected management failures.
      const completion = stream.closed.then(() => undefined, error => error);
      let pending = '', authorized = false, sentCredential = false;
      let result: DesktopDeploymentResult | undefined;
      const cancel = () => stream.stdin.end();
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      stream.stdout.setEncoding('utf8');
      stream.stdout.on('data', (chunk: string) => {
        pending += chunk;
        if (pending.length > 32 * 1024) { stream.stdin.end(); return; }
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
          let value: { stage?: string; code?: string; status?: { state?: string }; rollback?: string };
          try {
            const parsed: unknown = JSON.parse(line);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { stream.stdin.end(); continue; }
            value = parsed;
          } catch { stream.stdin.end(); continue; }
          if (value.stage === 'authorization_required') {
            if (sentCredential || authorized || signal.aborted || credential.length === 0) { result = { ok: false, code: 'administrator_required' }; stream.stdin.end(); continue; }
            sentCredential = true;
            const data = Buffer.concat([credential, Buffer.from('\n')]);
            credential.fill(0);
            stream.stdin.write(data, () => data.fill(0));
          }
          if (value.stage === 'authorized') {
            if (authorized || signal.aborted) { stream.stdin.end(); continue; }
            authorized = true; privilegedStarted = true; credential.fill(0);
            stream.stdin.write(JSON.stringify(request) + '\n');
          }
          const progress = parseDesktopDeploymentProgress(value);
          if (progress) { if (progress.rollback) rollback = progress.rollback; report(progress); }
          if (value.stage === 'result') {
            const state = value.status?.state;
            result = { ok: !value.code && ['active', 'stopped', 'not_installed'].includes(state ?? ''), ...(state === 'active' || state === 'stopped' || state === 'not_installed' ? { state } : {}), ...(value.code ? { code: signal.aborted ? 'canceled' : 'deployment_failed' } : {}), ...(rollback ? { rollback } : {}) };
            stream.stdin.end();
          }
        }
      });
      stream.stdin.on('error', () => {}); // sudo may close the pipe after rejection.
      try {
        const closed = await stream.result;
        const completionError = await completion;
        if (result && !result.ok) return result;
        if (result?.ok && closed.exit_code === 0 && !completionError) return result;
        return { ok: false, code: signal.aborted ? 'canceled' : authorized ? 'deployment_failed' : sentCredential ? 'authorization_failed' : 'administrator_required', ...(privilegedStarted ? { rollback: rollback ?? 'unknown' } : {}) };
      } finally { signal.removeEventListener('abort', cancel); }
    } catch (error) {
      return { ok: false, code: signal.aborted ? 'canceled' : error instanceof DesktopDeploymentPermissionError ? 'permission_denied' : 'transport_interrupted', ...(privilegedStarted ? { rollback: rollback ?? 'unknown' } : {}) };
    } finally {
      credential.fill(0);
      if (directory && host) await host.lease.run(`rm -rf -- ${quote(directory)}`, { timeout_ms: 10_000 }).catch(() => {});
    }
  }
}
