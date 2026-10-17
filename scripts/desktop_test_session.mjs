import childProcess, { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const workerKey = 'REDEVEN_DESKTOP_TEST_SESSION';
const defaults = {
  timeoutMs: 180000,
  gracefulMs: 5000,
  termMs: 5000,
  killMs: 5000,
  actionMs: 15000,
};
const errorText = (error) => error?.stack ?? String(error);
export async function bounded(operation, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Identity is captured at creation, never reconstructed from a name or a port.
const processHelper = fileURLToPath(new URL('./desktop_test_processes.py', import.meta.url));
export function processSnapshot() {
  return JSON.parse(
    execFileSync(process.platform === 'win32' ? 'python' : 'python3', [processHelper], {
      encoding: 'utf8',
      timeout: 5000,
      killSignal: 'SIGKILL',
    }),
  );
}
export function processIdentity(pid) {
  return JSON.parse(
    execFileSync(process.platform === 'win32' ? 'python' : 'python3', [processHelper, String(pid)], {
      encoding: 'utf8',
      timeout: 5000,
      killSignal: 'SIGKILL',
    }),
  );
}
export function processPorts(identities) {
  if (!identities.length) return [];
  const records = JSON.parse(
    execFileSync(
      process.platform === 'win32' ? 'python' : 'python3',
      [processHelper, '--ports', ...identities.map((item) => String(item.pid))],
      { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' },
    ),
  );
  return records.filter((record) =>
    identities.some((identity) => identity.pid === record.pid && sameProcess(identity, processIdentity(record.pid))),
  );
}
export function sameProcess(expected, actual) {
  return Boolean(
    expected &&
      actual &&
      expected.pid === actual.pid &&
      expected.birth === actual.birth &&
      expected.executable === actual.executable &&
      expected.device === actual.device &&
      expected.inode === actual.inode &&
      expected.group === actual.group,
  );
}
export function refreshOwnedProcesses(resource, snapshot = processSnapshot()) {
  resource.members ??= [resource.identity];
  const live = resource.members.filter((expected) => snapshot.some((actual) => sameProcess(expected, actual)));
  const ownsGroup = resource.group && resource.identity.group === resource.identity.pid && live.length > 0;
  const members = new Map(live.map((item) => [item.pid, item]));
  for (let changed = true; changed; ) {
    changed = false;
    for (const item of snapshot) {
      if (members.has(item.pid)) continue;
      if ((ownsGroup && item.group === resource.identity.group) || (!resource.group && members.has(item.parent))) {
        members.set(item.pid, item);
        changed = true;
      }
    }
  }
  for (const item of members.values()) {
    if (!resource.members.some((expected) => sameProcess(expected, item))) resource.members.push(item);
  }
  return [...members.values()];
}
async function waitGone(resource, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (!refreshOwnedProcesses(resource).length) return;
    await delay(25);
  } while (Date.now() < deadline);
  throw new Error(`Owned process tree ${resource.identity.pid} has not exited`);
}
async function signalOwned(resource, signal) {
  for (const identity of refreshOwnedProcesses(resource).reverse()) {
    if (!sameProcess(identity, processIdentity(identity.pid))) continue;
    try {
      if (process.platform === 'win32') {
        await runCommand(
          {
            file: 'taskkill',
            args: ['/PID', String(identity.pid), ...(signal === 'SIGKILL' ? ['/F'] : [])],
            timeoutMs: 5000,
          },
          false,
        );
      } else process.kill(identity.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}
export async function stopOwnedProcess(resource, options = defaults) {
  if (!refreshOwnedProcesses(resource).length) return { forced: false };
  await signalOwned(resource, 'SIGTERM');
  try {
    await waitGone(resource, options.termMs);
    return { forced: false };
  } catch {
    /* Escalate only the same process identities. */
  }
  await signalOwned(resource, 'SIGKILL');
  await waitGone(resource, options.killMs);
  return { forced: true };
}
async function verifyPort({ port, host = '127.0.0.1' }) {
  await bounded(
    () =>
      new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(port, host, () => server.close(resolve));
      }),
    2000,
    `Port ${host}:${port} rebind`,
  );
}
export async function runCommand(command, superviseTree = true) {
  const child = spawn(command.file, command.args ?? [], {
    cwd: command.cwd,
    env: { ...process.env, ...command.env, GOWORK: 'off' },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const ended = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  ended.catch(() => {});
  const identity = child.pid ? processIdentity(child.pid) : null;
  const resource = identity ? { identity, group: process.platform !== 'win32' } : null;
  try {
    const result = await bounded(() => ended, command.timeoutMs ?? defaults.actionMs, `Cleanup command ${command.file}`);
    if (result.code !== 0 || result.signal) throw new Error(`Cleanup command failed (${result.code}/${result.signal}): ${stderr}`);
    return stdout;
  } catch (error) {
    if (resource && superviseTree) await stopOwnedProcess(resource, { ...defaults, termMs: 1000 });
    else if (child.exitCode === null) child.kill('SIGKILL');
    throw error;
  }
}
export async function stopTarget({ executable, root }, observe = () => {}, execute = runCommand) {
  const inspect = async () =>
    JSON.parse(
      await execute({
        file: executable,
        args: ['desktop-target-process-inventory', '--target-root', root],
      }),
    );
  const inventory = await inspect();
  await observe(inventory);
  let failure, result;
  try {
    result = JSON.parse(
      await execute({
        file: executable,
        args: [
          'desktop-target-process-stop',
          '--target-root',
          root,
          '--expected-inventory-digest',
          inventory.inventory_digest,
          '--grace-period',
          '5s',
        ],
        timeoutMs: 5000,
      }),
    );
  } catch (error) {
    failure = error;
  }
  const after = await inspect();
  await observe(after);
  if (after.instances.length) {
    failure ??= new Error(`Owned target processes remain under ${root}`);
    await execute({
      file: executable,
      args: [
        'desktop-target-process-stop',
        '--target-root',
        root,
        '--expected-inventory-digest',
        after.inventory_digest,
        '--grace-period',
        '5s',
      ],
    });
  }
  if ((await inspect()).instances.length) throw new Error(`Owned target inventory is not empty: ${root}`);
  if (failure) throw failure;
  return result;
}

async function supervise(entry, options) {
  const id = randomUUID();
  const directory = mkdtempSync(path.join(tmpdir(), 'redeven-desktop-test-session-'));
  const reportFile = options.reportFile ?? path.join(directory, 'result.json');
  const report = {
    schemaVersion: 1,
    id,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    entry,
    directory,
    state: 'running',
    status: 'running',
    resources: [],
    processes: [],
    ports: [],
    directories: [],
    evidenceFiles: [],
    errors: [],
    remainingProcesses: [],
  };
  const manifest = path.join(directory, 'session.json');
  function persist() {
    writeFileSync(`${manifest}.tmp`, JSON.stringify(report, null, 2), {
      mode: 0o600,
    });
    renameSync(`${manifest}.tmp`, manifest);
  }
  function recordPorts(identities) {
    for (const port of processPorts(identities))
      if (!report.ports.some((item) => item.port === port.port && item.host === port.host)) report.ports.push(port);
    persist();
  }
  persist();
  console.log(`Desktop test session ${id}: ${manifest}`);
  const worker = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: { ...process.env, [workerKey]: JSON.stringify({ id, directory }) },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
  const workerIdentity = processIdentity(worker.pid);
  const pending = new Map();
  let sequence = 0,
    cleaning,
    exited = false,
    completed = false;
  let completeCleanup;
  const cleanupComplete = new Promise((resolve) => {
    completeCleanup = resolve;
  });
  const remote = async (method, args, milliseconds) => {
    const request = ++sequence;
    try {
      return await bounded(
        () =>
          new Promise((resolve, reject) => {
            if (!worker.connected || exited) {
              reject(new Error(`Scenario control channel unavailable: ${method}`));
              return;
            }
            pending.set(request, { resolve, reject });
            worker.send({ request, method, args }, (error) => {
              if (error) {
                pending.delete(request);
                reject(error);
              }
            });
          }),
        milliseconds,
        method,
      );
    } finally {
      pending.delete(request);
    }
  };
  const attempt = async (label, action) => {
    try {
      return await action();
    } catch (error) {
      report.errors.push(`${label}: ${errorText(error)}`);
    }
  };
  const cleanup = (reason) => {
    if (cleaning) return cleaning;
    cleaning = (async () => {
      clearTimeout(deadline);
      report.state = 'cleaning';
      if (reason) report.error = errorText(reason);
      persist();
      await attempt('Listener inventory', () => recordPorts(report.processes.flatMap((resource) => refreshOwnedProcesses(resource))));
      const quiesced = await attempt('Stop scenario operations', async () => {
        await remote('quiesce', null, options.gracefulMs);
        return true;
      });
      if (!quiesced && sameProcess(workerIdentity, processIdentity(worker.pid))) {
        await attempt('Unresponsive scenario stop', () => stopOwnedProcess({ identity: workerIdentity }, options));
      }
      // All paths use this ordering; failures never skip the next owner.
      for (const resource of report.resources.filter((item) => item.phase === 'release')) await cleanResource(resource);
      for (const resource of report.processes.filter((item) => item.kind === 'desktop' || item.kind === 'browser'))
        await attempt(`${resource.kind} cleanup`, async () => {
          if (!refreshOwnedProcesses(resource).length) return;
          if (resource.graceful)
            await attempt('graceful Desktop close', () =>
              bounded(
                async () => {
                  await remote('graceful', resource.key, options.gracefulMs);
                  await waitGone(resource, options.gracefulMs);
                },
                options.gracefulMs,
                'Desktop exit',
              ),
            );
          if (refreshOwnedProcesses(resource).length) {
            report.errors.push(`Desktop ${resource.identity.pid} required termination`);
            const stopped = await attempt('Desktop termination', () => stopOwnedProcess(resource, options));
            if (stopped?.forced) report.errors.push(`Desktop ${resource.identity.pid} required force termination`);
          }
        });
      for (const resource of report.resources.filter((item) => item.phase !== 'release')) await cleanResource(resource);
      for (const resource of report.processes.filter((item) => item.kind !== 'desktop' && item.kind !== 'browser')) {
        const stopped = await attempt(`Process ${resource.identity.pid}`, () => stopOwnedProcess(resource, options));
        if (stopped?.forced) report.errors.push(`Process ${resource.identity.pid} required force termination`);
      }
      for (const port of report.ports) await attempt('Port verification', () => verifyPort(port));
      report.remainingProcesses = [];
      for (const resource of report.processes)
        await attempt('Process inventory verification', () => {
          report.remainingProcesses.push(...refreshOwnedProcesses(resource));
        });
      if (report.remainingProcesses.length) report.errors.push('Owned process inventory is not empty');
      await attempt('Scenario stop', async () => {
        if (exited) return;
        try {
          await remote('finish', null, options.gracefulMs);
        } catch {
          /* Reclaim the exact worker if its channel failed. */
        }
        if (sameProcess(workerIdentity, processIdentity(worker.pid))) {
          try {
            await waitGone({ identity: workerIdentity }, options.gracefulMs);
          } catch {
            report.errors.push('Scenario worker required termination');
            await stopOwnedProcess({ identity: workerIdentity }, options);
          }
        }
      });
      clearInterval(inventoryTimer);
      report.remainingProcesses = [];
      for (const resource of report.processes)
        await attempt('Final process inventory verification', () => {
          report.remainingProcesses.push(...refreshOwnedProcesses(resource));
        });
      if (report.remainingProcesses.length) report.errors.push('Owned processes remain after scenario stop');
      for (const port of report.ports) await attempt('Final port verification', () => verifyPort(port));
      for (const file of report.evidenceFiles)
        await attempt('Evidence readback', async () => {
          JSON.parse(readFileSync(file, 'utf8'));
        });
      if (!report.error && !report.errors.length)
        for (const target of report.directories)
          await attempt('Temporary state removal', () => rm(target, { recursive: true, force: true }));
      report.state = 'finished';
      report.status = !report.error && !report.errors.length ? 'passed' : 'failed';
      persist();
      for (const file of report.evidenceFiles)
        await attempt('Evidence finalization', async () => {
          const evidence = JSON.parse(readFileSync(file, 'utf8'));
          evidence.status = report.status;
          evidence.cleanup = {
            session: report.id,
            status: report.status,
            errors: report.errors,
            remainingProcesses: report.remainingProcesses,
          };
          await writeFile(file, JSON.stringify(evidence, null, 2));
        });
      report.status = !report.error && !report.errors.length ? 'passed' : 'failed';
      persist();
      if (report.status === 'failed')
        for (const file of report.evidenceFiles) {
          try {
            const evidence = JSON.parse(readFileSync(file, 'utf8'));
            evidence.status = 'failed';
            await writeFile(file, JSON.stringify(evidence, null, 2));
          } catch {
            /* The manifest remains the authoritative failed result. */
          }
        }
      await mkdir(path.dirname(reportFile), { recursive: true });
      await writeFile(reportFile, JSON.stringify(report, null, 2));
      if (report.status === 'passed') {
        console.log(`PASS Desktop session ${id}: scenario and owned cleanup verified`);
        await rm(directory, { recursive: true, force: true });
      } else
        console.error(`Desktop test failed. Diagnostics: ${manifest}
Retry owned cleanup: node ${fileURLToPath(import.meta.url)} --cleanup ${manifest}`);
      process.exitCode = report.status === 'passed' ? 0 : 1;
    })().finally(completeCleanup);
    return cleaning;
  };
  async function cleanResource(resource) {
    await attempt(resource.name, async () => {
      if (resource.command) await runCommand(resource.command);
      else if (resource.target)
        resource.result = await stopTarget(resource.target, (inventory) => {
          resource.inventory = inventory;
          recordPorts(inventory.instances.map((item) => processIdentity(item.pid)).filter(Boolean));
        });
      else await remote('cleanup', resource.key, options.actionMs);
      resource.cleaned = true;
      persist();
    });
  }
  const inventoryTimer = setInterval(() => {
    try {
      const snapshot = processSnapshot();
      for (const resource of report.processes) refreshOwnedProcesses(resource, snapshot);
      persist();
    } catch (error) {
      void cleanup(error);
    }
  }, 500);
  const deadline = setTimeout(() => void cleanup(new Error(`Scenario exceeded ${options.timeoutMs}ms deadline`)), options.timeoutMs);
  const signals = ['SIGINT', 'SIGTERM'].map((signal) => {
    const handler = () => void cleanup(new Error(`Interrupted by ${signal}`));
    process.on(signal, handler);
    return [signal, handler];
  });
  worker.on('message', (message) => {
    if (message.response) {
      const callback = pending.get(message.response);
      pending.delete(message.response);
      if (callback) message.error ? callback.reject(new Error(message.error)) : callback.resolve(message.value);
      return;
    }
    if (message.type === 'register') {
      // Already created resources must remain visible during interruption.
      report[message.collection].push(message.resource);
      persist();
      worker.send({ response: message.request });
    } else if (message.type === 'graceful') {
      const resource = report.processes.find((item) => item.key === message.key);
      if (resource) resource.graceful = true;
      persist();
      worker.send({ response: message.request });
    } else if (message.type === 'close-process') {
      const resource = report.processes.find((item) => item.key === message.key);
      if (resource) resource.stopping = true;
      void (async () => {
        try {
          if (!resource?.graceful) throw new Error('Unknown graceful process owner');
          await remote('graceful', resource.key, options.gracefulMs);
          await waitGone(resource, options.gracefulMs);
          worker.send({ response: message.request });
        } catch (error) {
          report.errors.push(errorText(error));
          worker.send({ response: message.request, error: errorText(error) });
        }
      })();
    } else if (message.type === 'stop-process') {
      const resource = report.processes.find((item) => item.key === message.key);
      if (resource) resource.stopping = true;
      void (async () => {
        try {
          if (!resource) throw new Error('Unknown session process');
          const stopped = await stopOwnedProcess(resource, options);
          if (stopped.forced) throw new Error('Scenario process required force termination');
          worker.send({ response: message.request });
        } catch (error) {
          worker.send({ response: message.request, error: errorText(error) });
        }
      })();
    } else if (message.type === 'process-exit') {
      const resource = report.processes.find((item) => item.key === message.key);
      if (resource) {
        resource.exit = { code: message.code, signal: message.signal };
        persist();
        if (report.state === 'running' && !resource.stopping && (!resource.allowCleanExit || message.code !== 0 || message.signal)) {
          void cleanup(new Error(`Owned ${resource.kind} exited unexpectedly: ${message.code}/${message.signal}`));
        }
      }
    } else if (message.type === 'done') {
      completed = true;
      void cleanup(message.error || (message.exitCode ? `Scenario exited with status ${message.exitCode}` : null));
    }
  });
  worker.on('error', (error) => void cleanup(error));
  worker.on('exit', (code, signal) => {
    exited = true;
    for (const callback of pending.values()) callback.reject(new Error('Scenario worker exited'));
    pending.clear();
    if (!completed && !cleaning) void cleanup(new Error(`Scenario worker exited unexpectedly: ${code}/${signal}`));
  });
  await cleanupComplete;
  await cleaning;
  for (const [signal, handler] of signals) process.off(signal, handler);
  process.exit(process.exitCode ?? 1);
}

export async function createDesktopTestSession(meta, settings = {}) {
  const options = { ...defaults, ...settings };
  if (!process.env[workerKey]) return supervise(fileURLToPath(meta), options);
  const identity = JSON.parse(process.env[workerKey]);
  const actions = new Map(),
    graceful = new Map(),
    pending = new Map();
  let sequence = 0,
    stopping = false;
  const applications = new WeakMap();
  const registrations = new Set();
  const register = (collection, resource) => {
    const registration = new Promise((resolve, reject) => {
      const request = ++sequence;
      pending.set(request, { resolve, reject });
      process.send({ type: 'register', collection, resource, request });
    });
    registrations.add(registration);
    registration.finally(() => registrations.delete(registration)).catch(() => {});
    return registration;
  };
  process.on('message', async (message) => {
    if (message.response) {
      const callback = pending.get(message.response);
      pending.delete(message.response);
      if (callback) message.error ? callback.reject(new Error(message.error)) : callback.resolve(message.value);
      return;
    }
    if (message.method === 'quiesce' || message.method === 'finish') stopping = true;
    if (message.method === 'quiesce') {
      await Promise.allSettled([...registrations]);
      process.send({ response: message.request });
      return;
    }
    if (message.method === 'finish') {
      process.send({ response: message.request }, () => process.exit(0));
      return;
    }
    try {
      const value = await (message.method === 'graceful' ? graceful.get(message.args) : actions.get(message.args))?.();
      process.send({ response: message.request, value });
    } catch (error) {
      process.send({ response: message.request, error: errorText(error) });
    }
  });
  function checkRunning() {
    if (stopping) throw new Error('Desktop test session is cleaning');
  }
  async function track(child, { kind = 'desktop', group = process.platform !== 'win32', allowCleanExit = true } = {}) {
    const key = randomUUID();
    child.__desktopTestKey = key;
    child.once('exit', (code, signal) => {
      if (process.connected) process.send({ type: 'process-exit', key, code, signal });
    });
    const created = processIdentity(child.pid);
    if (!created) {
      // A short command can exit during the identity syscall, before Node drains
      // its child-exit event. Reap that handle before deciding identity is missing.
      await bounded(
        () => (child.exitCode !== null || child.signalCode !== null ? undefined : new Promise((resolve) => child.once('exit', resolve))),
        1000,
        'Process identity readback',
      );
      if (!allowCleanExit || child.exitCode !== 0 || child.signalCode)
        throw new Error(`Owned ${kind} exited before registration: ${child.exitCode}/${child.signalCode}`);
      return child;
    }
    await register('processes', {
      key,
      kind,
      identity: created,
      group,
      allowCleanExit,
    });
    return child;
  }
  async function captureLaunch(launch, ownership, owns = () => true) {
    const original = childProcess.spawn;
    const captured = [];
    childProcess.spawn = function (file, args, config) {
      checkRunning();
      const child = original.call(this, file, args, {
        ...config,
        detached: process.platform !== 'win32',
      });
      if (owns(file, config)) {
        const registration = new Promise((resolve, reject) => {
          child.once('spawn', resolve);
          child.once('error', reject);
        }).then(() => track(child, ownership));
        registration.catch(() => {});
        captured.push({ child, registration });
      }
      return child;
    };
    let result, failure;
    try {
      result = await launch();
    } catch (error) {
      failure = error;
    } finally {
      childProcess.spawn = original;
    }
    const registered = await Promise.allSettled(captured.map((item) => item.registration));
    if (failure) throw failure;
    const rejected = registered.find((item) => item.status === 'rejected');
    if (rejected) throw rejected.reason;
    return { result, captured };
  }
  async function closeProcess(key) {
    await new Promise((resolve, reject) => {
      const request = ++sequence;
      pending.set(request, { resolve, reject });
      process.send({ type: 'close-process', request, key });
    });
  }
  const session = {
    ...identity,
    async run(scenario) {
      let error;
      try {
        await scenario();
      } catch (failure) {
        error = errorText(failure);
      }
      await Promise.all(registrations);
      process.send({ type: 'done', error, exitCode: process.exitCode });
      await new Promise(() => {});
    },
    async defer(name, action, { phase = 'service', command, target } = {}) {
      checkRunning();
      const key = randomUUID();
      actions.set(key, action);
      await register('resources', { name, key, phase, command, target });
      return key;
    },
    async command(name, file, args, config = {}) {
      return session.defer(name, null, { command: { file, args, ...config } });
    },
    async writeEvidence(file, contents) {
      const evidence = typeof contents === 'string' ? JSON.parse(contents) : contents;
      evidence.scenarioStatus ??= evidence.status;
      evidence.status = 'running';
      await register('evidenceFiles', path.resolve(file));
      await writeFile(file, JSON.stringify(evidence, null, 2));
    },
    async release(key) {
      const action = actions.get(key);
      if (!action) throw new Error('Unknown session resource');
      await bounded(action, options.actionMs, 'Resource release');
      actions.set(key, () => {});
    },
    async evidence(file) {
      await register('evidenceFiles', path.resolve(file));
    },
    async stopProcess(child) {
      checkRunning();
      await new Promise((resolve, reject) => {
        const request = ++sequence;
        pending.set(request, { resolve, reject });
        process.send({
          type: 'stop-process',
          request,
          key: child.__desktopTestKey,
        });
      });
    },
    async target(executable, root) {
      return session.defer(`Target ${root}`, null, {
        target: { executable, root: path.resolve(root) },
      });
    },
    async directory(directory) {
      await register('directories', path.resolve(directory));
      return directory;
    },
    async port(port, host = '127.0.0.1') {
      if (Number(port) > 0) await register('ports', { port: Number(port), host });
    },
    async spawn(file, args, config = {}, ownership = {}) {
      checkRunning();
      const child = spawn(file, args, {
        ...config,
        detached: process.platform !== 'win32',
      });
      // Install an error listener immediately, including ENOENT before registration.
      const spawned = new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      await spawned;
      await track(child, ownership);
      return child;
    },
    async setGracefulClose(child, action) {
      const key = child.__desktopTestKey;
      if (!key) throw new Error('Graceful close requires a registered process');
      graceful.set(key, action);
      await new Promise((resolve, reject) => {
        const request = ++sequence;
        pending.set(request, { resolve, reject });
        process.send({ type: 'graceful', key, request });
      });
    },
    async wait(child, timeoutMs) {
      const result = await bounded(
        () =>
          child.exitCode !== null || child.signalCode !== null
            ? { code: child.exitCode, signal: child.signalCode }
            : new Promise((resolve, reject) => {
                child.once('error', reject);
                child.once('exit', (code, signal) => resolve({ code, signal }));
              }),
        timeoutMs ?? options.timeoutMs,
        'Electron fixture',
      );
      if (result.code !== 0 || result.signal) throw new Error(`Electron fixture exited unexpectedly: ${JSON.stringify(result)}`);
      return result;
    },
    async launchElectron(launcher, config) {
      checkRunning();
      // Playwright exposes its ChildProcess only after startup. Observe exactly its
      // configured executable during launch so startup failure is supervised too.
      const { result: app, captured } = await captureLaunch(
        () =>
          launcher.launch({
            ...config,
            args: [...(config.args ?? []), `--redeven-test-session=${identity.id}`],
          }),
        { allowCleanExit: false },
        (file, spawnOptions) =>
          path.resolve(file) === path.resolve(config.executablePath) ||
          (process.platform === 'win32' && spawnOptions?.shell && file.startsWith(`"${config.executablePath}" `)),
      );
      if (!captured.some((item) => item.child === app.process()))
        await track(app.process(), {
          group: process.platform !== 'win32',
          allowCleanExit: false,
        });
      applications.set(app, app.process().__desktopTestKey);
      await session.setGracefulClose(app.process(), async () => {
        await installQuitConfirmation(app, path.join(identity.directory, 'quit.jsonl'));
        // Keep the inspector connected while product shutdown awaits its own work.
        // Playwright closes it immediately when app.close() first calls app.quit().
        await app.evaluate(
          ({ app }) =>
            new Promise((resolve) => {
              app.once('will-quit', () => resolve());
              app.quit();
            }),
        );
        await app.close();
      });
      return app;
    },
    async launchBrowser(launcher, config) {
      checkRunning();
      const { result: browser, captured } = await captureLaunch(() => launcher.launch(config), { kind: 'browser', allowCleanExit: false });
      if (!captured.length) throw new Error('Browser launch did not expose an owned process');
      const child = captured[0].child;
      applications.set(browser, child.__desktopTestKey);
      await session.setGracefulClose(child, () => browser.close());
      return browser;
    },
    async closeBrowser(browser) {
      if (browser) await closeProcess(applications.get(browser));
    },
    async closeElectron(app) {
      if (!app) return;
      await closeProcess(applications.get(app));
    },
  };
  return session;
}

// Use the shipped localized model identity. This is installed only at teardown
// and only in the current Playwright Electron instance; every other dialog delegates.
export async function installQuitConfirmation(application, diagnosticFile) {
  await application.evaluate(({ app, dialog }, diagnosticFile) => {
    const require = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`);
    const path = require('node:path');
    const fs = require('node:fs');
    const root = path.join(app.getAppPath(), 'dist');
    const impactPath = path.join(root, 'main/desktopQuitImpact.js');
    if (!fs.existsSync(impactPath)) return;
    const { buildDesktopQuitConfirmationModel } = require(impactPath);
    const { buildDesktopConfirmationMessageBoxOptions } = require(path.join(root, 'main/desktopConfirmation.js'));
    const { REDEVEN_SUPPORTED_LOCALES } = require(path.join(root, 'shared/i18n/localeMeta.js'));
    const models = REDEVEN_SUPPORTED_LOCALES.map((locale) =>
      buildDesktopConfirmationMessageBoxOptions({
        model: buildDesktopQuitConfirmationModel(
          {
            environment_window_count: 0,
            pending_operation_count: 0,
            running_runtime_count: 0,
          },
          typeof locale === 'string' ? locale : locale.id,
        ),
      }),
    );
    const original = dialog.showMessageBox;
    dialog.showMessageBox = (...args) => {
      const options = args.at(-1);
      if (diagnosticFile) fs.appendFileSync(diagnosticFile, `${JSON.stringify({ event: 'dialog', options })}\n`);
      if (
        models.some(
          (model) =>
            options?.title === model.title &&
            options.type === model.type &&
            options.defaultId === model.defaultId &&
            options.cancelId === model.cancelId &&
            JSON.stringify(options.buttons) === JSON.stringify(model.buttons),
        )
      )
        return Promise.resolve({ response: 0, checkboxChecked: false });
      return original.apply(dialog, args);
    };
    if (diagnosticFile)
      for (const event of ['before-quit', 'will-quit', 'quit'])
        app.on(event, () => fs.appendFileSync(diagnosticFile, `${JSON.stringify({ event })}\n`));
  }, diagnosticFile);
}

async function retryCleanup(file) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  if (
    report.schemaVersion !== 1 ||
    path.dirname(file) !== report.directory ||
    !path.basename(report.directory).startsWith('redeven-desktop-test-session-')
  )
    throw new Error('Not a Desktop test session manifest');
  const errors = [];
  for (const resource of report.processes)
    try {
      await stopOwnedProcess(resource, defaults);
    } catch (error) {
      errors.push(error);
    }
  for (const resource of report.resources)
    try {
      if (resource.command) await runCommand(resource.command);
      else if (resource.target) await stopTarget(resource.target);
      else if (!resource.cleaned) throw new Error(`Scenario-owned cleanup requires inspection: ${resource.name}`);
    } catch (error) {
      errors.push(error);
    }
  for (const port of report.ports)
    try {
      await verifyPort(port);
    } catch (error) {
      errors.push(error);
    }
  if (errors.length) throw new AggregateError(errors, 'Owned cleanup remains incomplete');
  console.log(`Owned session resources released: ${report.id}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--cleanup') await retryCleanup(path.resolve(process.argv[3]));
  else if (process.argv[2] === '--command') {
    const [timeout, file, ...args] = process.argv.slice(3);
    if (!file || !(Number(timeout) > 0)) throw new Error('Expected --command <timeout-ms> <executable> [arguments]');
    const session = await createDesktopTestSession(import.meta.url, {
      timeoutMs: Number(timeout),
    });
    await session.run(async () => {
      const child = await session.spawn(file, args, { stdio: 'inherit', env: { ...process.env, GOWORK: 'off' } }, { kind: 'service' });
      await session.wait(child, Number(timeout));
    });
  }
}
