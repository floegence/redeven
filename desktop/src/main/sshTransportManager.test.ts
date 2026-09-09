import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  DefaultDesktopSSHTransportManager,
  DesktopSSHTransportAuthenticationError,
  DesktopSSHTransportInterruptedError,
} from './sshTransportManager';

type FakeProcess = EventEmitter & {
  stdin: PassThrough | null;
  stdout: PassThrough | null;
  stderr: PassThrough;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals) => boolean>>;
};

function fakeProcess(options: Readonly<{ longLived?: boolean; stdout?: string; stderr?: string; exitCode?: number }> = {}): FakeProcess {
  const process = new EventEmitter() as FakeProcess;
  process.stdin = new PassThrough();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.exitCode = null;
  process.signalCode = null;
  const close = (exitCode: number | null, signal: NodeJS.Signals | null) => {
    if (process.exitCode !== null || process.signalCode) return;
    process.exitCode = exitCode;
    process.signalCode = signal;
    process.stdout?.end();
    process.stderr.end();
    process.emit('close', exitCode, signal);
  };
  process.kill = vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    close(null, signal);
    return true;
  });
  if (!options.longLived) {
    queueMicrotask(() => {
      if (options.stdout) process.stdout?.write(options.stdout);
      if (options.stderr) process.stderr.write(options.stderr);
      close(options.exitCode ?? 0, null);
    });
  }
  return process;
}

function target(authMode: 'key_agent' | 'password' = 'key_agent') {
  return {
    ssh_destination: 'devbox',
    ssh_port: 22,
    auth_mode: authMode,
    connect_timeout_seconds: 15,
  } as const;
}

function managerFixture() {
  const masters: FakeProcess[] = [];
  const calls: string[][] = [];
  const spawnProcess = vi.fn((_command: string, args: readonly string[]) => {
    calls.push([...args]);
    if (args.includes('-M')) {
      const master = fakeProcess({ longLived: true });
      masters.push(master);
      return master;
    }
    if (args.includes('-O')) {
      return fakeProcess({ exitCode: masters.at(-1)?.exitCode === null ? 0 : 255 });
    }
    return fakeProcess({ stdout: 'ok\n' });
  });
  const rm = vi.fn(async () => undefined);
  const manager = new DefaultDesktopSSHTransportManager({
    platform: 'darwin',
    idleCloseMs: 90_000,
    readyPollMs: 1,
    dependencies: {
      spawnProcess: spawnProcess as never,
      mkdtemp: vi.fn(async () => `/tmp/transport-${masters.length}`) as never,
      writeFile: vi.fn(async () => undefined) as never,
      rm: rm as never,
    },
  });
  return { manager, masters, calls, spawnProcess, rm };
}

function windowsManagerFixture() {
  const calls: Array<{ args: readonly string[]; options: import('node:child_process').SpawnOptions }> = [];
  const spawnProcess = vi.fn((_command: string, args: readonly string[], options: import('node:child_process').SpawnOptions) => {
    calls.push({ args, options });
    return fakeProcess({ stdout: 'ok\n' });
  });
  const manager = new DefaultDesktopSSHTransportManager({
    platform: 'win32',
    windowsAskPassExecutable: 'C:\\Redeven\\native\\redeven-ssh-askpass.exe',
    dependencies: {
      spawnProcess: spawnProcess as never,
      mkdtemp: vi.fn(async () => 'C:\\Temp\\transport') as never,
      writeFile: vi.fn(async () => undefined) as never,
      rm: vi.fn(async () => undefined) as never,
    },
  });
  return { manager, calls, spawnProcess };
}

describe('Windows native SSH transport', () => {
  it('authenticates and runs commands without a ControlMaster or shell password script', async () => {
    const fixture = windowsManagerFixture();
    try {
      const lease = await fixture.manager.acquire({
        target: target('password'), credentialScope: 'windows', sshPassword: ' secret $value ', readyTimeoutMs: 20,
      });
      await expect(lease.run('uname -m')).resolves.toMatchObject({ exit_code: 0, stdout: 'ok\n' });
      expect(fixture.calls).toHaveLength(2);
      for (const call of fixture.calls) {
        expect(call.args).not.toEqual(expect.arrayContaining(['-M']));
        expect(call.args).not.toEqual(expect.arrayContaining(['-S']));
        expect(call.args).not.toEqual(expect.arrayContaining(['-O']));
        expect(call.args.join(' ')).not.toContain('secret');
        expect(call.options.windowsHide).toBe(true);
        expect(call.options.env?.SSH_ASKPASS).toBe('C:\\Redeven\\native\\redeven-ssh-askpass.exe');
        expect(call.options.env?.REDEVEN_DESKTOP_SSH_PASSWORD).toBe(' secret $value ');
      }
      await lease.release();
    } finally { await fixture.manager.dispose(); }
  });

  it('returns remote command failures once and classifies authentication failures', async () => {
    const fixture = windowsManagerFixture();
    try {
      const lease = await fixture.manager.acquire({ target: target(), credentialScope: 'windows', readyTimeoutMs: 20 });
      fixture.spawnProcess.mockImplementationOnce(() => fakeProcess({ exitCode: 7, stderr: 'remote command failed' }));
      await expect(lease.run('false')).resolves.toMatchObject({ exit_code: 7 });
      fixture.spawnProcess.mockImplementationOnce(() => fakeProcess({ exitCode: 255, stderr: 'Permission denied (password).' }));
      await expect(lease.run('true')).rejects.toBeInstanceOf(DesktopSSHTransportAuthenticationError);
      expect(fixture.spawnProcess).toHaveBeenCalledTimes(3);
    } finally { await fixture.manager.dispose(); }
  });

  it('closes only its streaming processes and invalidates leases on disposal', async () => {
    const fixture = windowsManagerFixture();
    const lease = await fixture.manager.acquire({ target: target(), credentialScope: 'windows', readyTimeoutMs: 20 });
    const child = fakeProcess({ longLived: true });
    fixture.spawnProcess.mockImplementationOnce(() => child);
    const stream = lease.stream('desktop-bridge');
    const closed = expect(stream.closed).rejects.toBeInstanceOf(DesktopSSHTransportInterruptedError);
    await fixture.manager.dispose();
    await closed;
    expect(child.kill).toHaveBeenCalledOnce();
    await expect(lease.run('true')).rejects.toBeInstanceOf(DesktopSSHTransportInterruptedError);
  });

  it('cancels pending Windows authentication and allows a fresh credential retry', async () => {
    const fixture = windowsManagerFixture();
    const pending = fakeProcess({ longLived: true });
    fixture.spawnProcess.mockImplementationOnce(() => pending);
    const controller = new AbortController();
    const acquisition = fixture.manager.acquire({
      target: target('password'), credentialScope: 'windows', sshPassword: 'old', signal: controller.signal,
    });
    const rejection = expect(acquisition).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fixture.spawnProcess).toHaveBeenCalledOnce());
    controller.abort();
    await rejection;
    expect(pending.kill).toHaveBeenCalledOnce();
    const lease = await fixture.manager.acquire({ target: target('password'), credentialScope: 'windows', sshPassword: 'new' });
    await lease.run('true');
    expect(fixture.calls.at(-1)?.options.env?.REDEVEN_DESKTOP_SSH_PASSWORD).toBe('new');
    await lease.release();
    await fixture.manager.dispose();
  });

  it('keeps simultaneous Windows password environments in separate credential scopes', async () => {
    const fixture = windowsManagerFixture();
    const first = await fixture.manager.acquire({ target: target('password'), credentialScope: 'first', sshPassword: 'first-only' });
    const second = await fixture.manager.acquire({ target: target('password'), credentialScope: 'second', sshPassword: 'second-only' });
    await first.run('true');
    await second.run('true');
    expect(fixture.calls.slice(-2).map((call) => call.options.env?.REDEVEN_DESKTOP_SSH_PASSWORD))
      .toEqual(['first-only', 'second-only']);
    await first.release();
    await second.release();
    await fixture.manager.dispose();
  });
});

describe('DefaultDesktopSSHTransportManager', () => {
  it('coalesces concurrent acquisitions and reuses one ControlMaster', async () => {
    const fixture = managerFixture();
    const [first, second] = await Promise.all([
      fixture.manager.acquire({ target: target(), credentialScope: 'environment-a' }),
      fixture.manager.acquire({ target: target(), credentialScope: 'environment-b' }),
    ]);

    expect(fixture.calls.filter((args) => args.includes('-M'))).toHaveLength(1);
    expect(first.generation).toBe(second.generation);
    await first.release();
    await second.release();
    await fixture.manager.dispose();
  });

  it('isolates password transports by credential scope without putting the password in argv', async () => {
    const fixture = managerFixture();
    const first = await fixture.manager.acquire({
      target: target('password'),
      credentialScope: 'secret-a',
      sshPassword: 'first-secret',
    });
    const second = await fixture.manager.acquire({
      target: target('password'),
      credentialScope: 'secret-b',
      sshPassword: 'second-secret',
    });

    expect(fixture.calls.filter((args) => args.includes('-M'))).toHaveLength(2);
    expect(fixture.calls.flat().join(' ')).not.toContain('first-secret');
    expect(fixture.calls.flat().join(' ')).not.toContain('second-secret');
    await first.release();
    await second.release();
    await fixture.manager.dispose();
  });

  it('invalidates a fixed-generation lease after its master exits', async () => {
    const fixture = managerFixture();
    const lease = await fixture.manager.acquire({ target: target(), credentialScope: 'environment-a' });
    fixture.masters[0]!.kill('SIGKILL');

    await expect(lease.run('true')).rejects.toBeInstanceOf(DesktopSSHTransportInterruptedError);
    const replacement = await fixture.manager.acquire({ target: target(), credentialScope: 'environment-a' });
    expect(replacement.generation).toBeGreaterThan(lease.generation);
    await lease.release();
    await replacement.release();
    await fixture.manager.dispose();
  });

  it('bounds a remote command without killing the reusable control master', async () => {
    vi.useFakeTimers();
    try {
      const fixture = managerFixture();
      const lease = await fixture.manager.acquire({ target: target(), credentialScope: 'environment-a' });
      const original = fixture.spawnProcess.getMockImplementation()!;
      fixture.spawnProcess.mockImplementationOnce((_command: string, args: readonly string[]) => {
        fixture.calls.push([...args]);
        return fakeProcess({ longLived: true });
      });
      fixture.spawnProcess.mockImplementation(original);

      const command = lease.run('hang', { timeout_ms: 20 });
      const rejection = expect(command).rejects.toThrow('timed out after 20 ms');
      await vi.advanceTimersByTimeAsync(20);
      await rejection;
      expect(fixture.masters[0]!.kill).not.toHaveBeenCalled();
      await lease.release();
      await fixture.manager.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not replay a failed command while the master remains healthy', async () => {
    const fixture = managerFixture();
    fixture.spawnProcess.mockImplementationOnce(fixture.spawnProcess.getMockImplementation()!);
    const lease = await fixture.manager.acquire({ target: target(), credentialScope: 'environment-a' });
    const original = fixture.spawnProcess.getMockImplementation()!;
    fixture.spawnProcess.mockImplementationOnce((_command: string, args: readonly string[]) => {
      fixture.calls.push([...args]);
      return fakeProcess({ exitCode: 7, stderr: 'remote failure\n' });
    });
    fixture.spawnProcess.mockImplementation(original);

    const result = await lease.run('false');
    expect(result.exit_code).toBe(7);
    expect(fixture.calls.filter((args) => args.at(-1) === 'false')).toHaveLength(1);
    await lease.release();
    await fixture.manager.dispose();
  });

  it('closes an idle master after the configured delay and disposes persistent leases explicitly', async () => {
    vi.useFakeTimers();
    try {
      const fixture = managerFixture();
      const lease = await fixture.manager.acquire({
        target: target(),
        credentialScope: 'environment-a',
        persistent: true,
      });
      await lease.release();
      expect(fixture.masters[0]!.kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(89_999);
      expect(fixture.masters[0]!.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(fixture.masters[0]!.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs streaming commands through the existing master and releases all resources on dispose', async () => {
    const fixture = managerFixture();
    const lease = await fixture.manager.acquire({
      target: target(),
      credentialScope: 'environment-a',
      persistent: true,
    });
    const command = lease.stream('cat');

    await expect(command.result).resolves.toMatchObject({ exit_code: 0, signal: null });
    await expect(command.closed).resolves.toBeUndefined();
    expect(fixture.calls.filter((args) => args.includes('-M'))).toHaveLength(1);
    expect(fixture.calls.filter((args) => args.at(-1) === 'cat')).toHaveLength(1);

    await fixture.manager.dispose();
    expect(fixture.masters[0]!.kill).toHaveBeenCalledWith('SIGTERM');
    expect(fixture.rm).toHaveBeenCalledWith(expect.stringContaining('/tmp/transport-'), {
      recursive: true,
      force: true,
    });
  });

  it('treats an explicitly killed streaming command as caller-owned closure', async () => {
    const fixture = managerFixture();
    const lease = await fixture.manager.acquire({
      target: target(),
      credentialScope: 'environment-a',
    });
    const original = fixture.spawnProcess.getMockImplementation()!;
    fixture.spawnProcess.mockImplementationOnce((_command: string, args: readonly string[]) => {
      fixture.calls.push([...args]);
      return fakeProcess({ longLived: true });
    });
    fixture.spawnProcess.mockImplementation(original);

    const command = lease.stream('long-running-command');
    command.kill('SIGTERM');

    await expect(command.result).resolves.toMatchObject({ exit_code: null, signal: 'SIGTERM' });
    await expect(command.closed).resolves.toBeUndefined();
    expect(fixture.calls.filter((args) => args.includes('-O'))).toHaveLength(1);

    await lease.release();
    await fixture.manager.dispose();
  });

  it('times out a streaming command without closing the reusable control master', async () => {
    vi.useFakeTimers();
    try {
      const fixture = managerFixture();
      const lease = await fixture.manager.acquire({ target: target(), credentialScope: 'environment-a' });
      const original = fixture.spawnProcess.getMockImplementation()!;
      fixture.spawnProcess.mockImplementationOnce((_command: string, args: readonly string[]) => {
        fixture.calls.push([...args]);
        return fakeProcess({ longLived: true });
      });
      fixture.spawnProcess.mockImplementation(original);

      const command = lease.stream('long-running-command', { timeout_ms: 20 });
      const rejection = expect(command.closed).rejects.toThrow('timed out after 20 ms');
      await vi.advanceTimersByTimeAsync(20);
      await rejection;
      expect(fixture.masters[0]!.kill).not.toHaveBeenCalled();
      await lease.release();
      await fixture.manager.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an already-aborted acquisition without creating transport resources', async () => {
    const fixture = managerFixture();
    const controller = new AbortController();
    controller.abort(new DOMException('Canceled.', 'AbortError'));

    await expect(fixture.manager.acquire({
      target: target(),
      credentialScope: 'environment-a',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fixture.spawnProcess).not.toHaveBeenCalled();
    await fixture.manager.dispose();
  });

  it('classifies authentication failure before any lease is issued', async () => {
    const spawnProcess = vi.fn((_command: string, args: readonly string[]) => {
      if (args.includes('-M')) {
        return fakeProcess({ stderr: 'Permission denied (publickey,password).\n', exitCode: 255 });
      }
      return fakeProcess({ stderr: 'Control socket unavailable.\n', exitCode: 255 });
    });
    const manager = new DefaultDesktopSSHTransportManager({
      platform: 'darwin',
      readyPollMs: 1,
      dependencies: {
        spawnProcess: spawnProcess as never,
        mkdtemp: vi.fn(async () => '/tmp/transport-auth') as never,
        writeFile: vi.fn(async () => undefined) as never,
        rm: vi.fn(async () => undefined) as never,
      },
    });

    await expect(manager.acquire({
      target: target('password'),
      credentialScope: 'saved-secret-a',
      sshPassword: 'wrong-secret',
    })).rejects.toBeInstanceOf(DesktopSSHTransportAuthenticationError);
    await manager.dispose();
  });
});
