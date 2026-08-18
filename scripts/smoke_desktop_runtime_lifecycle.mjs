import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const sharedPorts = new Set([9222, 9230, 23998]);
const coldLifecycleTimeoutMs = 600_000;

class FatalSmokeError extends Error {}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(read, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      if (error instanceof FatalSmokeError) throw error;
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms${lastError ? `: ${lastError}` : ''}`);
}

async function reservePort(excluded) {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        server.close((error) => error ? reject(error) : resolve(address.port));
      });
    });
    if (port >= 1024 && !sharedPorts.has(port) && !excluded.has(port)) return port;
  }
}

function browserPages(browser) {
  return browser.contexts().flatMap((context) => context.pages());
}

function isWorkspacePage(page) {
  try {
    return new URL(page.url()).pathname.startsWith('/_redeven_proxy/env/');
  } catch {
    return false;
  }
}

async function launcherSnapshot(page) {
  return page.evaluate(async () => {
    if (!window.redevenDesktopLauncher?.getSnapshot) {
      throw new Error('Desktop preload launcher bridge is unavailable');
    }
    return window.redevenDesktopLauncher.getSnapshot();
  });
}

function environmentByLabel(snapshot, label) {
  return snapshot.environments.find((environment) => environment.label === label) ?? null;
}

async function waitForEnvironment(page, label, predicate, timeoutMs = 120_000) {
  return waitFor(async () => {
    const snapshot = await launcherSnapshot(page);
    const environment = environmentByLabel(snapshot, label);
    return environment && predicate(environment, snapshot) ? { environment, snapshot } : null;
  }, timeoutMs, `${label} ${predicate.name || 'environment'} state`);
}

async function lifecycleActionForEnvironment(page, label, operation, expectedOutcome) {
  const { environment } = await waitForEnvironment(
    page,
    label,
    (candidate) => candidate.gateway_id && candidate.gateway_env_id,
    120_000,
  );
  const prepared = await page.evaluate(async ({ target, operation: requestedOperation }) => (
    window.redevenDesktopLauncher.performAction({
      kind: 'run_gateway_environment_lifecycle',
      environment_id: target.id,
      gateway_id: target.gateway_id,
      gateway_env_id: target.gateway_env_id,
      operation: requestedOperation,
      label: target.label,
    })
  ), { target: environment, operation });
  if (prepared?.ok !== false || prepared.code !== 'confirmation_required') {
    throw new Error(`${operation} did not stop for explicit confirmation: ${JSON.stringify(prepared)}`);
  }
  const confirmed = await page.evaluate(async ({ operationKey }) => (
    window.redevenDesktopLauncher.performAction({
      kind: 'confirm_runtime_operation',
      operation_key: operationKey,
    })
  ), { operationKey: `${environment.id}:${operation}` });
  if (confirmed?.ok !== true || confirmed.outcome !== expectedOutcome) {
    throw new Error(`${operation} failed after confirmation: ${JSON.stringify(confirmed)}`);
  }
  return { prepared, confirmed };
}

async function environmentCard(page, label) {
  const card = page.locator('.redeven-environment-card').filter({ hasText: label }).first();
  await card.waitFor({ state: 'visible', timeout: 30_000 });
  return card;
}

async function openThroughGuidance(page, label, expectedGuidance) {
  const card = await environmentCard(page, label);
  const primary = card.locator('.redeven-split-action-primary button').first();
  await primary.waitFor({ state: 'visible', timeout: 30_000 });
  const primaryLabel = (await primary.innerText()).trim();
  await primary.click();
  const panel = page.locator('.redeven-action-popover').filter({ hasText: expectedGuidance }).first();
  await panel.waitFor({ state: 'visible', timeout: 30_000 });
  const action = panel.locator('.redeven-action-popover__actions button').first();
  await action.waitFor({ state: 'visible', timeout: 30_000 });
  const actionLabel = (await action.innerText()).trim();
  const panelText = (await panel.innerText()).trim();
  await action.click();
  return { primaryLabel, actionLabel, panelText };
}

async function openDirectly(page, label) {
  const card = await environmentCard(page, label);
  const primary = card.locator('.redeven-split-action-primary button').first();
  await primary.waitFor({ state: 'visible', timeout: 30_000 });
  const labelBeforeClick = (await primary.innerText()).trim();
  await primary.click();
  await delay(300);
  if (await page.locator('.redeven-action-popover').filter({ hasText: /Initialize and open|Start and open|初始化并打开|启动并打开/u }).count() > 0) {
    throw new Error(`online ${label} opened lifecycle guidance instead of opening directly`);
  }
  return { label: labelBeforeClick };
}

async function ensureGatewayPaired(page, label) {
  const current = await waitForEnvironment(page, label, () => true, 120_000);
  if (current.environment.gateway_trust_state === 'paired' && current.environment.gateway_status !== 'pairing_required') {
    return { outcome: 'already_paired' };
  }
  if (!current.environment.gateway_id) {
    return { outcome: 'not_created_yet' };
  }
  const result = await page.evaluate(async (gateway_id) => window.redevenDesktopLauncher.performAction({
    kind: 'pair_gateway',
    gateway_id,
  }), current.environment.gateway_id);
  if (result?.ok !== true) {
    throw new Error(`${label} Gateway pairing failed: ${JSON.stringify(result)}`);
  }
  await waitForEnvironment(
    page,
    label,
    (environment) => environment.gateway_trust_state === 'paired' && environment.gateway_status !== 'pairing_required',
    120_000,
  );
  return result;
}

async function waitForWorkspace(browser, excludedPages = new Set()) {
  return waitFor(
    () => browserPages(browser).find((page) => !excludedPages.has(page) && !page.isClosed() && isWorkspacePage(page)) ?? null,
    120_000,
    'Desktop workspace window',
  );
}

async function waitForWorkspaceOrInitializationFailure(browser, launcherPage) {
  return waitFor(async () => {
    const workspace = browserPages(browser).find((page) => !page.isClosed() && isWorkspacePage(page)) ?? null;
    if (workspace) return { kind: 'workspace', workspace };
    const retry = launcherPage.locator('.redeven-action-popover__actions button').filter({
      hasText: /Retry initialization|重试初始化/u,
    }).first();
    if (await retry.count() > 0 && await retry.isVisible()) return { kind: 'failed' };
    return null;
  }, coldLifecycleTimeoutMs, 'Desktop workspace or initialization failure');
}

async function closeWorkspacePages(browser) {
  await Promise.all(browserPages(browser).filter(isWorkspacePage).map((page) => page.close().catch(() => undefined)));
}

async function gatewayLifecycleState(snapshot) {
  const gatewayStateRoot = snapshot?.gateway_sources?.[0]?.service_state?.service_state_root;
  if (!gatewayStateRoot) return null;
  const storePath = path.join(gatewayStateRoot, 'runtime-lifecycle', 'runtime-operations-v1.json');
  const raw = await fs.readFile(storePath, 'utf8').catch(() => '');
  if (!raw) return { store_path: storePath, store: null, staging_files: [] };
  const store = JSON.parse(raw);
  const stagingFiles = [];
  for (const operationID of Object.keys(store.operations ?? {})) {
    const stagingKey = createHash('sha256').update(operationID.trim()).digest('hex').slice(0, 32);
    const artifactRoot = path.join(gatewayStateRoot, 'runtime-lifecycle', 'runtime-operation-staging', stagingKey);
    for (const name of ['runtime.artifact.partial', 'runtime.artifact']) {
      const artifactPath = path.join(artifactRoot, name);
      const stat = await fs.stat(artifactPath).catch(() => null);
      if (stat?.isFile()) stagingFiles.push({ operation_id: operationID, name, size_bytes: stat.size });
    }
  }
  return { store_path: storePath, store, staging_files: stagingFiles };
}

function redactDiagnosticValue(value) {
  if (Array.isArray(value)) return value.map(redactDiagnosticValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (/(?:^|_)(?:token|secret|password|private_key|pairing_code)(?:$|_)/iu.test(key)) {
      return [key, entry ? '[redacted]' : entry];
    }
    return [key, redactDiagnosticValue(entry)];
  }));
}

function redactDiagnosticText(value) {
  return String(value ?? '')
    .replace(/("(?:token|secret|password|private_key|pairing_code)"\s*:\s*")[^"]*(")/giu, '$1[redacted]$2')
    .slice(0, 24_000);
}

async function captureCommand(executable, args, options = {}) {
  return new Promise((resolve) => {
    const command = spawn(executable, args, {
      cwd: rootDir,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ...result,
        stdout: redactDiagnosticText(stdout),
        stderr: redactDiagnosticText(stderr),
      });
    };
    const timer = setTimeout(() => {
      command.kill('SIGKILL');
      finish({ timed_out: true });
    }, options.timeoutMs ?? 5_000);
    command.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    command.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    command.once('error', (error) => finish({ spawn_error: String(error) }));
    command.once('close', (exitCode, signal) => finish({ exit_code: exitCode, signal }));
  });
}

async function startSSHSmokeTarget(tempRoot, excludedPorts) {
  const sshRoot = path.join(tempRoot, 'ssh-target');
  const sshConfigRoot = path.join(sshRoot, 'config');
  const sshHome = path.join(sshRoot, 'home');
  const sshKeyRoot = path.join(sshHome, '.ssh');
  await fs.mkdir(sshKeyRoot, { recursive: true, mode: 0o700 });
  const keyPath = path.join(sshKeyRoot, 'id_ed25519');
  const hostKeyPath = path.join(sshRoot, 'ssh_host_ed25519_key');
  const authorizedKeysPath = path.join(sshKeyRoot, 'authorized_keys');
  const sshdPidPath = path.join(sshRoot, 'sshd.pid');
  for (const generatedKeyPath of [keyPath, hostKeyPath]) {
    const generated = await captureCommand('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', generatedKeyPath]);
    if (generated.exit_code !== 0) {
      throw new Error(`ssh-keygen failed for ${generatedKeyPath}: ${generated.stderr || generated.stdout}`);
    }
  }
  await fs.copyFile(`${keyPath}.pub`, authorizedKeysPath);
  await fs.chmod(authorizedKeysPath, 0o600);
  const port = await reservePort(excludedPorts);
  excludedPorts.add(port);
  const username = os.userInfo().username;
  const config = [
    `Port ${port}`,
    'ListenAddress 127.0.0.1',
    `HostKey ${hostKeyPath}`,
    `PidFile ${sshdPidPath}`,
    `AuthorizedKeysFile ${authorizedKeysPath}`,
    `AllowUsers ${username}`,
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'PubkeyAuthentication yes',
    'PermitRootLogin no',
    'UsePAM no',
    'StrictModes no',
    'AllowAgentForwarding no',
    'AllowTcpForwarding no',
    'X11Forwarding no',
    'Subsystem sftp internal-sftp',
    'LogLevel ERROR',
  ].join('\n') + '\n';
  await fs.writeFile(sshConfigRoot, config, { mode: 0o600 });
  const sshd = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', sshConfigRoot], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sshdOutput = [];
  sshd.stdout.on('data', (chunk) => sshdOutput.push(chunk.toString()));
  sshd.stderr.on('data', (chunk) => sshdOutput.push(chunk.toString()));
  const stopSSHD = async () => {
    if (sshd.exitCode !== null || sshd.signalCode !== null) return;
    sshd.kill('SIGTERM');
    const exited = await Promise.race([
      new Promise((resolve) => sshd.once('exit', () => resolve(true))),
      delay(5_000).then(() => false),
    ]);
    if (!exited && sshd.exitCode === null && sshd.signalCode === null) {
      sshd.kill('SIGKILL');
      await new Promise((resolve) => sshd.once('exit', resolve));
    }
  };
  let agentEnv;
  try {
    const knownHostsPath = path.join(sshRoot, 'known_hosts');
    const keyscan = await waitFor(async () => {
      const result = await captureCommand('ssh-keyscan', ['-p', String(port), '127.0.0.1'], { timeoutMs: 5_000 });
      return result.exit_code === 0 && result.stdout.trim() !== '' ? result.stdout : null;
    }, 20_000, 'temporary SSH host key');
    await fs.writeFile(knownHostsPath, keyscan, { mode: 0o600 });
    const sshWrapperRoot = path.join(sshRoot, 'bin');
    const sshWrapperPath = path.join(sshWrapperRoot, 'ssh');
    await fs.mkdir(sshWrapperRoot, { recursive: true });
    await fs.writeFile(sshWrapperPath, [
      '#!/bin/sh',
      `exec /usr/bin/ssh -o UserKnownHostsFile=${knownHostsPath} -o StrictHostKeyChecking=yes "$@"`,
      '',
    ].join('\n'), { mode: 0o700 });
    const agent = await captureCommand('ssh-agent', ['-s']);
    if (agent.exit_code !== 0) {
      throw new Error(`ssh-agent failed: ${agent.stderr}`);
    }
    const agentSocket = agent.stdout.match(/SSH_AUTH_SOCK=([^;\n]+)/u)?.[1] ?? '';
    const agentPID = agent.stdout.match(/SSH_AGENT_PID=(\d+)/u)?.[1] ?? '';
    if (!agentSocket || !agentPID) {
      throw new Error(`ssh-agent did not return usable environment: ${agent.stdout}`);
    }
    agentEnv = {
      ...process.env,
      PATH: `${sshWrapperRoot}:${process.env.PATH ?? ''}`,
      SSH_AUTH_SOCK: agentSocket,
      SSH_AGENT_PID: agentPID,
    };
    const added = await captureCommand('ssh-add', [keyPath], { env: agentEnv });
    if (added.exit_code !== 0) {
      throw new Error(`ssh-add failed: ${added.stderr}`);
    }
    const destination = `${username}@127.0.0.1`;
    await waitFor(async () => {
      const result = await captureCommand('ssh', [
        '-o', 'BatchMode=yes',
        '-p', String(port), destination, 'true',
      ], { env: agentEnv, timeoutMs: 5_000 });
      return result.exit_code === 0 ? true : null;
    }, 20_000, 'temporary SSH smoke target');
    return {
      sshd,
      sshdOutput,
      agentEnv,
      agentPID,
      port,
      destination,
      runtimeRoot: path.join(tempRoot, 'remote-runtime'),
      async stop() {
        await stopSSHD();
        await captureCommand('ssh-agent', ['-k'], { env: agentEnv });
      },
    };
  } catch (error) {
    await stopSSHD();
    if (agentEnv) {
      await captureCommand('ssh-agent', ['-k'], { env: agentEnv });
    }
    throw error;
  }
}

async function writeSSHSmokeCatalog(stateRoot, target) {
  const catalogRoot = path.join(stateRoot, 'catalog', 'connections');
  await fs.mkdir(catalogRoot, { recursive: true });
  const record = {
    schema_version: 1,
    record_kind: 'connection',
    kind: 'ssh',
    id: 'ssh-smoke-remote',
    label: 'SSH Remote Environment',
    ssh_destination: target.destination,
    ssh_port: target.port,
    auth_mode: 'key_agent',
    runtime_root: target.runtimeRoot,
    bootstrap_strategy: 'desktop_upload',
    release_base_url: '',
    connect_timeout_seconds: 10,
    pinned: true,
    auto_runtime_probe_enabled: true,
    created_at_ms: Date.now(),
    last_used_at_ms: 0,
  };
  await fs.writeFile(
    path.join(catalogRoot, `${encodeURIComponent(record.id)}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function runtimeSupervisorEvidence(stateRoot, snapshot) {
  const runtimeRoot = path.join(stateRoot, 'local-environment');
  const checkpointRoot = path.join(runtimeRoot, 'runtime', 'supervisor-checkpoints');
  const checkpointNames = await fs.readdir(checkpointRoot).catch(() => []);
  const checkpoints = [];
  for (const name of checkpointNames.filter((candidate) => candidate.endsWith('.json')).sort()) {
    const checkpointPath = path.join(checkpointRoot, name);
    const raw = await fs.readFile(checkpointPath, 'utf8').catch(() => '');
    if (!raw) continue;
    try {
      checkpoints.push({ path: checkpointPath, value: redactDiagnosticValue(JSON.parse(raw)) });
    } catch (error) {
      checkpoints.push({ path: checkpointPath, parse_error: String(error) });
    }
  }

  const candidateProcesses = [];
  for (const checkpoint of checkpoints) {
    const pid = Number(checkpoint.value?.candidate?.pid);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      alive = error?.code === 'EPERM';
    }
    const processTable = await captureCommand('ps', [
      '-o', 'pid=,ppid=,pgid=,sess=,stat=,etime=,command=',
      '-p', String(pid),
    ]);
    candidateProcesses.push({ pid, alive, process_table: processTable });
  }

  const bundledRuntime = path.join(rootDir, 'desktop', '.bundle', `${process.platform}-${process.arch}`, 'redeven');
  const managedRuntime = path.join(runtimeRoot, 'runtime', 'managed', 'bin', 'redeven');
  const statusProbes = [];
  for (const [kind, executable] of [['bundled', bundledRuntime], ['managed', managedRuntime]]) {
    if (!await fs.stat(executable).then((stat) => stat.isFile(), () => false)) continue;
    const result = await captureCommand(executable, ['desktop-runtime-status', '--state-root', runtimeRoot]);
    let parsed;
    try {
      parsed = redactDiagnosticValue(JSON.parse(result.stdout));
    } catch {
      parsed = undefined;
    }
    statusProbes.push({ kind, executable, ...result, ...(parsed ? { parsed } : {}) });
  }

  const gatewayStateRoot = snapshot?.gateway_sources?.[0]?.service_state?.service_state_root;
  const bindingPath = gatewayStateRoot ? path.join(gatewayStateRoot, 'runtime-target-binding-v1.json') : '';
  const bindingRaw = bindingPath ? await fs.readFile(bindingPath, 'utf8').catch(() => '') : '';
  const binding = bindingRaw ? redactDiagnosticValue(JSON.parse(bindingRaw)) : null;
  const controlSocketPath = binding?.binding?.runtime_control_socket_path ?? '';
  const controlSocket = controlSocketPath
    ? await fs.lstat(controlSocketPath).then((stat) => ({ path: controlSocketPath, exists: true, is_socket: stat.isSocket() }), () => ({ path: controlSocketPath, exists: false }))
    : null;
  return {
    runtime_root: runtimeRoot,
    checkpoints,
    candidate_processes: candidateProcesses,
    status_probes: statusProbes,
    binding_path: bindingPath,
    binding,
    control_socket: controlSocket,
  };
}

async function stopProcessGroup(child, output) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(10_000).then(() => false),
  ]);
  if (exited) return;
  output.push('[smoke] Desktop process group required SIGKILL during teardown');
  process.kill(-child.pid, 'SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));
}

async function runEnvironmentScenario({ page, browser, label, reportRoot, scenarioName, managedRuntimePath }) {
  const scenario = { label, operations: [] };
  scenario.gateway_pairing = await ensureGatewayPaired(page, label);
  await waitForEnvironment(page, label, () => true, 120_000);
  if (managedRuntimePath && await fs.stat(managedRuntimePath).then(() => true, () => false)) {
    throw new Error(`${label} managed Runtime exists before initialization: ${managedRuntimePath}`);
  }

  const initialize = await openThroughGuidance(page, label, /Initialize and open|初始化并打开/u);
  scenario.operations.push({ kind: 'initialize_guidance_confirmed', ...initialize });
  const initializationResult = await waitForWorkspaceOrInitializationFailure(browser, page);
  if (initializationResult.kind === 'failed') {
    const current = await waitForEnvironment(page, label, () => true, 30_000);
    scenario.initialization_failure_panel_text = await page.locator('.redeven-action-popover').first().innerText().catch(() => '');
    scenario.gateway_lifecycle_state_at_initial_failure = await gatewayLifecycleState(current.snapshot);
    throw new Error(`${label} Runtime initialization failed on first click: ${scenario.initialization_failure_panel_text}`);
  }
  const initialWorkspace = initializationResult.workspace;
  await waitForEnvironment(page, label, (environment) => environment.runtime_health.status === 'online' && environment.is_open === true, 120_000);
  scenario.operations.push({ kind: 'initialize_and_open', ...initialize, workspace_url: initialWorkspace.url() });

  await closeWorkspacePages(browser);
  await lifecycleActionForEnvironment(page, label, 'stop', 'stopped_gateway_environment_runtime');
  await waitForEnvironment(page, label, (environment) => environment.runtime_health.status !== 'online', 120_000);
  scenario.operations.push({ kind: 'stop', outcome: 'stopped_gateway_environment_runtime' });

  const start = await openThroughGuidance(page, label, /Start and open|启动并打开/u);
  const startedWorkspace = await waitForWorkspace(browser);
  await waitForEnvironment(page, label, (environment) => environment.runtime_health.status === 'online' && environment.is_open === true, 180_000);
  scenario.operations.push({ kind: 'start_and_open', ...start, workspace_url: startedWorkspace.url() });

  await closeWorkspacePages(browser);
  await lifecycleActionForEnvironment(page, label, 'restart', 'restarted_gateway_environment_runtime');
  await waitForEnvironment(page, label, (environment) => environment.runtime_health.status === 'online', 180_000);
  scenario.operations.push({ kind: 'restart', outcome: 'restarted_gateway_environment_runtime' });

  await lifecycleActionForEnvironment(page, label, 'update_runtime', 'updated_gateway_environment_runtime');
  const afterUpdate = await waitForEnvironment(page, label, (environment) => environment.runtime_health.status === 'online', 300_000);
  scenario.operations.push({
    kind: 'update',
    outcome: 'updated_gateway_environment_runtime',
    runtime_version: afterUpdate.environment.runtime_health.runtime_service?.runtime_version,
  });

  const direct = await openDirectly(page, label);
  const directWorkspace = await waitForWorkspace(browser);
  await waitForEnvironment(page, label, (environment) => environment.is_open === true, 120_000);
  scenario.operations.push({ kind: 'open', ...direct, workspace_url: directWorkspace.url() });

  await page.screenshot({ path: path.join(reportRoot, `desktop-lifecycle-${scenarioName}.png`), fullPage: true });
  await closeWorkspacePages(browser);
  await lifecycleActionForEnvironment(page, label, 'stop', 'stopped_gateway_environment_runtime');
  const final = await waitForEnvironment(page, label, (environment) => environment.runtime_health.status !== 'online', 120_000);
  if (final.environment.gateway_id) {
    scenario.gateway_stop = await page.evaluate(async (gateway_id) => window.redevenDesktopLauncher.performAction({
      kind: 'stop_gateway',
      gateway_id,
      impact_acknowledged: true,
    }), final.environment.gateway_id);
  }
  return scenario;
}

async function run() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error(`Desktop Runtime lifecycle smoke requires macOS or Linux, not ${process.platform}`);
  }
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-lifecycle-'));
  const stateRoot = path.join(tempRoot, 'state');
  const userDataRoot = path.join(tempRoot, 'user-data');
  const cacheRoot = path.join(tempRoot, 'cache');
  const desktopTempRoot = path.join(tempRoot, 'temp');
  const reportRoot = path.join(tempRoot, 'report');
  await Promise.all([stateRoot, userDataRoot, cacheRoot, desktopTempRoot, reportRoot].map((directory) => fs.mkdir(directory, { recursive: true })));

  const ports = new Set();
  const localUIPort = await reservePort(ports); ports.add(localUIPort);
  const cdpPort = await reservePort(ports); ports.add(cdpPort);
  const inspectorPort = await reservePort(ports); ports.add(inspectorPort);
  const sshTarget = await startSSHSmokeTarget(tempRoot, ports);
  await writeSSHSmokeCatalog(stateRoot, sshTarget);
  const output = [];
  const launchStartedAt = Date.now();
  const child = spawn(path.join(rootDir, 'scripts/dev_desktop.sh'), [
    '--no-stop',
    '--no-devtools',
    '--remote-debugging-port', String(cdpPort),
    '--inspect-port', String(inspectorPort),
  ], {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      ...sshTarget.agentEnv,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      REDEVEN_STATE_ROOT: stateRoot,
      REDEVEN_DESKTOP_USER_DATA_ROOT: userDataRoot,
      REDEVEN_DESKTOP_CACHE_ROOT: cacheRoot,
      REDEVEN_DESKTOP_TEMP_ROOT: desktopTempRoot,
      REDEVEN_DESKTOP_LOCAL_UI_BIND: `127.0.0.1:${localUIPort}`,
      REDEVEN_DESKTOP_AUTO_START_RUNTIME: '0',
      REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0',
      REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG: 'v0.0.0-dev',
      REDEVEN_DESKTOP_BUNDLE_VERSION: 'v0.0.0-dev',
      REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT: rootDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));

  let browser;
  let launcherPage;
  let failure;
  const evidence = {
    platform: process.platform,
    architecture: process.arch,
    root: tempRoot,
    state_root: stateRoot,
    electron_pid: child.pid,
    local_ui_port: localUIPort,
    cdp_port: cdpPort,
    inspector_port: inspectorPort,
    ssh_remote: {
      destination: sshTarget.destination,
      port: sshTarget.port,
      runtime_root: sshTarget.runtimeRoot,
      platform: process.platform,
    },
    launch_started_at_unix_ms: launchStartedAt,
    operations: [],
    scenarios: {},
  };
  try {
    await waitFor(async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new FatalSmokeError(`Desktop exited before CDP readiness: code=${child.exitCode} signal=${child.signalCode}`);
      }
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null);
      return response?.ok ? true : null;
    }, 240_000, 'Desktop CDP endpoint');

    const { chromium } = require(path.join(rootDir, 'internal/envapp/ui_src/node_modules/playwright'));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = await waitFor(() => browserPages(browser).find((candidate) => {
      const url = candidate.url();
      return !url.startsWith('devtools://') && url.includes('/welcome/index.html');
    }) ?? null, 60_000, 'Redeven Desktop welcome page');
    launcherPage = page;
    await page.bringToFront();
    if (!page.url().includes('/desktop/dist/welcome/index.html')) {
      throw new Error(`CDP target does not belong to this worktree Desktop: ${page.url()}`);
    }
    const localScenario = await runEnvironmentScenario({
      page,
      browser,
      label: 'Local Environment',
      reportRoot,
      scenarioName: 'local',
      managedRuntimePath: path.join(stateRoot, 'local-environment', 'runtime', 'managed', 'bin', 'redeven'),
    });
    evidence.scenarios.local = localScenario;
    evidence.operations = localScenario.operations;

    const remoteScenario = await runEnvironmentScenario({
      page,
      browser,
      label: 'SSH Remote Environment',
      reportRoot,
      scenarioName: 'ssh-remote',
      managedRuntimePath: path.join(sshTarget.runtimeRoot, 'runtime', 'managed', 'bin', 'redeven'),
    });
    evidence.scenarios.ssh_remote = remoteScenario;
    evidence.completed_at_unix_ms = Date.now();
    evidence.duration_ms = evidence.completed_at_unix_ms - launchStartedAt;
    await fs.writeFile(path.join(reportRoot, 'desktop-lifecycle.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    failure = error;
    evidence.failure = String(error?.stack ?? error);
    evidence.page_urls = browser ? browserPages(browser).map((page) => page.url()) : [];
    evidence.launcher_snapshot = launcherPage && !launcherPage.isClosed()
      ? await launcherSnapshot(launcherPage).catch((snapshotError) => ({ error: String(snapshotError) }))
      : null;
    evidence.launcher_text = launcherPage && !launcherPage.isClosed()
      ? (await launcherPage.locator('body').innerText().catch(() => '')).slice(0, 12_000)
      : '';
    const gatewayStateRoot = evidence.launcher_snapshot?.gateway_sources?.[0]?.service_state?.service_state_root;
    evidence.gateway_log = gatewayStateRoot
      ? await fs.readFile(path.join(gatewayStateRoot, 'gateway-service.log'), 'utf8').catch((logError) => String(logError))
      : '';
    evidence.runtime_supervisor = await runtimeSupervisorEvidence(
      stateRoot,
      evidence.launcher_snapshot,
    ).catch((diagnosticError) => ({ error: String(diagnosticError) }));
    if (launcherPage && !launcherPage.isClosed()) {
      await launcherPage.screenshot({ path: path.join(reportRoot, 'desktop-lifecycle-failure.png'), fullPage: true }).catch(() => undefined);
    }
    evidence.output_tail = output.join('').split('\n').slice(-200);
    await fs.writeFile(path.join(reportRoot, 'desktop-lifecycle-failure.json'), `${JSON.stringify(evidence, null, 2)}\n`).catch(() => undefined);
    process.stderr.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await browser?.close().catch(() => undefined);
    await stopProcessGroup(child, output).catch((error) => {
      failure ??= error;
    });
    await sshTarget.stop().catch((error) => {
      failure ??= error;
    });
    if (!failure || process.env.REDEVEN_KEEP_FAILED_SMOKE_STATE !== '1') {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
  if (failure) throw failure;
}

await run();
