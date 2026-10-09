import { createHash } from 'node:crypto';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { RemoteDesktopDeployment, DesktopDeploymentPermissionError } from './remoteDesktopDeployment';
import type { DesktopSSHCommandResult, DesktopSSHTransportLease } from './sshTransportManager';
import { parseDesktopDeploymentRequest, parseDesktopDeploymentProgress, type DesktopDeploymentProgress, type DesktopDeploymentOperation } from '../shared/remoteDesktopDeployment';

function fixture(mode: 'nopasswd' | 'password' | 'reject' | 'cancel' | 'prepare_failure' | 'prepare_cancel' = 'nopasswd') {
  const commands: string[] = [], writes: string[] = [], progress: DesktopDeploymentProgress[] = [];
  const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
  const service = Buffer.from('reviewed-service'), worker = Buffer.from('reviewed-worker');
  const kit = { serviceSHA256: sha(service), workerSHA256: sha(worker), files: new Map([['floe-host-desktop-service', service], ['desktop-drm', worker], ['libdrmtap.LICENSE', Buffer.from('license')]]) };
  const manager = new RemoteDesktopDeployment();
  const done = (exit_code = 0, stdout = '') => ({ exit_code, stdout, stderr: '', signal: null } as DesktopSSHCommandResult);
  const lease = {
    run: async (command: string) => {
      commands.push(command);
      if (command.startsWith('uname')) return done(0, `Linux\nx86_64\n1000 1000\n${'a'.repeat(64)}  /proc/42/exe\n`);
      if (command.includes('mktemp')) return done(0, '/tmp/redeven-desktop-ssh-AbC123\n');
      return done();
    },
    stream: (command: string, options: { signal?: AbortSignal } = {}) => {
      commands.push(command);
      const stdout = new PassThrough(), stderr = new PassThrough();
      if (command.startsWith('/proc/42/exe desktop-service-media')) {
        let finish!: (value: DesktopSSHCommandResult) => void;
        const result = new Promise<DesktopSSHCommandResult>(resolve => { finish = resolve; });
        options.signal?.addEventListener('abort', () => finish(done(1)), { once: true });
        const stdin = new Writable({ write(_data, _encoding, callback) { callback(); } });
        queueMicrotask(() => {
          stdout.write(JSON.stringify({ state: 'downloading', received_bytes: 5, expected_bytes: 10 }) + '\n');
          if (mode !== 'prepare_cancel') {
            stdout.write(JSON.stringify({ media_sha256: 'b'.repeat(64) }) + '\n');
            finish(done(mode === 'prepare_failure' ? 1 : 0));
          }
        });
        return { stdin, stdout, stderr, result, closed: result.then(() => {}), kill: () => finish(done(1)) };
      }
      let finish!: (value: DesktopSSHCommandResult) => void;
      let accepted = false, complete = false;
      const result = new Promise<DesktopSSHCommandResult>(resolve => { finish = resolve; });
      const emit = (value: unknown) => stdout.write(JSON.stringify(value) + '\n');
      const stdin = new Writable({
        write(data, _encoding, callback) {
          const text = Buffer.from(data).toString(); writes.push(text); callback();
          queueMicrotask(() => {
            if (!accepted && mode !== 'nopasswd' && mode !== 'cancel') {
              if (mode === 'reject') { finish(done(1)); return; }
              accepted = true; emit({ stage: 'authorized' }); return;
            }
            emit({ stage: 'starting_service' });
            if (mode !== 'cancel') { complete = true; emit({ stage: 'result', status: { state: 'active' } }); finish(done()); }
          });
        },
        final(callback) {
          if (!complete && mode === 'cancel') {
            emit({ stage: 'rolling_back' }); emit({ stage: 'rolled_back', rollback: 'complete' });
            emit({ stage: 'result', status: { state: 'failed' }, code: 'DEPLOYMENT_FAILED' });
          }
          finish(done(mode === 'cancel' ? 1 : 0)); callback();
        },
      });
      queueMicrotask(() => { accepted = mode === 'nopasswd' || mode === 'cancel'; emit({ stage: accepted ? 'authorized' : 'authorization_required' }); });
      const closed = result.then(value => {
        if (value.exit_code !== 0) throw new Error('Management command failed');
      });
      return { stdin, stdout, stderr, result, closed, kill: () => { throw new Error('must keep SSH alive for rollback'); } };
    },
  } as unknown as DesktopSSHTransportLease;
  const run = (password?: string, operation: DesktopDeploymentOperation = 'install') => manager.manage(1, { lease, runtimePID: 42, mediaCache: '/state/remote-desktop/components', loadKit: async () => kit }, operation, password, event => {
    progress.push(event);
    if (mode === 'cancel' && event.stage === 'starting_service') void manager.cancel(1);
    if (mode === 'prepare_cancel' && event.stage === 'preparing_media' && event.received_bytes) void manager.cancel(1);
  });
  return { commands, writes, progress, run, kit };
}

describe('SSH desktop deployment authorization', () => {
  it('requires scope confirmation and rejects credentials with pipe delimiters', () => {
    expect(parseDesktopDeploymentRequest({ action: 'manage', operation: 'install' })).toBeUndefined();
    expect(parseDesktopDeploymentRequest({ action: 'manage', operation: 'install', confirmed: true, administratorPassword: 'bad\nrequest' })).toBeUndefined();
  });
  it('never sends an unused administrator credential to a NOPASSWD service', async () => {
    const f = fixture(); expect(await f.run('ephemeral-admin')).toEqual({ ok: true, state: 'active' });
    expect(f.writes).toHaveLength(1);
    expect(JSON.parse(f.writes[0])).toMatchObject({ operation: 'install', runtime_uid: 1000, media_sha256: 'b'.repeat(64) });
    expect(JSON.stringify([f.commands, f.writes, f.progress])).not.toContain('ephemeral-admin');
  });
  it('prepares the released media on the SSH host before requesting administrator authority', async () => {
    const f = fixture(); expect((await f.run('ephemeral-admin')).ok).toBe(true);
    const prepare = f.commands.findIndex(command => command.startsWith('/proc/42/exe desktop-service-media'));
    const authorize = f.commands.findIndex(command => command.includes('sudo -n true'));
    expect(prepare).toBeGreaterThan(0); expect(authorize).toBeGreaterThan(prepare);
    expect(f.progress).toContainEqual({ stage: 'preparing_media', received_bytes: 5, expected_bytes: 10 });
    expect(f.commands[prepare]).not.toContain('ephemeral-admin');
  });
  it('does not request root after failed media preparation', async () => {
    const f = fixture('prepare_failure');
    expect(await f.run('ephemeral-admin')).toEqual({ ok: false, code: 'deployment_failed' });
    expect(f.writes).toEqual([]);
    expect(f.commands.some(command => command.includes('sudo'))).toBe(false);
    expect(f.commands.at(-1)).toContain('rm -rf');
  });
  it('cancels media preparation and cleans the private staging directory before requesting root', async () => {
    const f = fixture('prepare_cancel');
    expect(await f.run('ephemeral-admin')).toEqual({ ok: false, code: 'canceled' });
    expect(f.writes).toEqual([]);
    expect(f.commands.some(command => command.includes('sudo'))).toBe(false);
    expect(f.commands.at(-1)).toContain('rm -rf');
  });
  it('does not download or prepare media for start, stop or uninstall', async () => {
    for (const operation of ['start', 'stop', 'uninstall'] as const) {
      const f = fixture(); expect((await f.run(undefined, operation)).ok).toBe(true);
      expect(f.commands.some(command => command.includes('desktop-service-media'))).toBe(false);
      expect(JSON.parse(f.writes[0])).not.toHaveProperty('media_sha256');
    }
  });
  it('rejects unbounded preparation progress without exposing arbitrary source data', () => {
    expect(parseDesktopDeploymentProgress({ stage: 'preparing_media', received_bytes: -1 })).toBeUndefined();
    expect(parseDesktopDeploymentProgress({ stage: 'preparing_media', received_bytes: 5, secret: 'omitted' })).toEqual({ stage: 'preparing_media', received_bytes: 5 });
  });
  it('stages the verified management executable on the system service filesystem', async () => {
    const f = fixture(); expect((await f.run()).ok).toBe(true);
    const bootstrap = f.commands.find(command => command.includes('sudo -n true'));
    expect(bootstrap).toContain('/usr/lib/redeven-desktop-authorize-');
    expect(bootstrap).not.toContain('/run/redeven-desktop-authorize-');
  });
  it('sends a credential only after sudo requests it and separates the daemon request', async () => {
    const f = fixture('password'); expect((await f.run('ephemeral-admin')).ok).toBe(true);
    expect(f.writes[0]).toBe('ephemeral-admin\n');
    expect(JSON.parse(f.writes[1])).not.toHaveProperty('administratorPassword');
    expect(JSON.stringify([f.commands, f.progress])).not.toContain('ephemeral-admin');
  });
  it('fails without passing a management request after rejected authorization', async () => {
    const f = fixture('reject'); expect(await f.run('wrong-fixture-secret')).toEqual({ ok: false, code: 'authorization_failed' });
    expect(f.writes).toEqual(['wrong-fixture-secret\n']);
  });
  it('closes the lifeline and waits for observed rollback on cancel', async () => {
    const f = fixture('cancel'); expect(await f.run()).toEqual({ ok: false, code: 'canceled', rollback: 'complete' });
    expect(f.progress.some(event => event.stage === 'rolled_back')).toBe(true);
  });
  it('rejects changed release bytes before uploading or requesting authority', async () => {
    const f = fixture(); f.kit.files.set('desktop-drm', Buffer.from('modified-worker'));
    expect(await f.run('ephemeral-admin')).toEqual({ ok: false, code: 'deployment_failed' });
    expect(f.commands).toHaveLength(1);
  });
  it('returns a permission failure before acquiring SSH or loading service bytes', async () => {
    const manager = new RemoteDesktopDeployment();
    expect(await manager.manage(1, async () => { throw new DesktopDeploymentPermissionError(); }, 'install', 'ephemeral-admin', () => {})).toEqual({ ok: false, code: 'permission_denied' });
  });
  it('cancels asynchronous host preparation before beginning a privileged operation', async () => {
    const manager = new RemoteDesktopDeployment();
    const preparing = manager.manage(1, signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Canceled preparation')), { once: true });
    }), 'install', 'ephemeral-admin', () => {});
    await manager.dispose();
    expect(await preparing).toEqual({ ok: false, code: 'canceled' });
  });
});
