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
const phaseBudgets = Object.freeze({
  desktop_cold_start_ms: 120_000,
  desktop_warm_start_ms: 90_000,
  direct_open_ms: 30_000,
  lifecycle_start_ms: 120_000,
  lifecycle_update_ms: 180_000,
});

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

async function prepareLifecycleAction(page, label, operation) {
  const { environment } = await waitForEnvironment(
    page,
    label,
    (candidate) => candidate.gateway_id && candidate.gateway_env_id,
    phaseBudgets.lifecycle_start_ms,
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
  return {
    environment,
    operationKey: `${environment.id}:${operation}`,
    prepared,
  };
}

async function lifecycleActionForEnvironment(page, label, operation, expectedOutcome) {
  const { operationKey, prepared } = await prepareLifecycleAction(page, label, operation);
  const confirmed = await page.evaluate(async ({ operationKey }) => (
    window.redevenDesktopLauncher.performAction({
      kind: 'confirm_runtime_operation',
      operation_key: operationKey,
    })
  ), { operationKey });
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
  const expectedStepCount = /Initialize and open|初始化并打开/u.test(actionLabel)
    ? 4
    : /Start and open|启动并打开/u.test(actionLabel)
      ? 3
      : 1;
  await action.click();
  const timeline = page.locator('.redeven-action-popover .redeven-environment-progress__steps').last();
  await timeline.waitFor({ state: 'visible', timeout: 30_000 });
  const stepCount = await timeline.locator('.redeven-environment-progress__step').count();
  const connectorCount = await timeline.locator('.redeven-environment-progress__step-line').count();
  const dotStatesBeforeConfirm = await timeline.locator('.redeven-environment-progress__step-dot').evaluateAll((dots) => (
    dots.map((dot) => dot.getAttribute('data-state'))
  ));
  if (stepCount !== expectedStepCount || connectorCount !== Math.max(0, expectedStepCount - 1)) {
    throw new Error(`${label} open-flow timeline shape was incomplete: steps=${stepCount}, connectors=${connectorCount}, expected=${expectedStepCount}`);
  }
  await delay(100);
  const dotStatesAfterConfirm = await timeline.locator('.redeven-environment-progress__step-dot').evaluateAll((dots) => (
    dots.map((dot) => dot.getAttribute('data-state'))
  )).catch(() => []);
  return {
    primaryLabel,
    actionLabel,
    panelText,
    timeline: {
      step_count: stepCount,
      connector_count: connectorCount,
      dot_states_before_confirm: dotStatesBeforeConfirm,
      dot_states_after_confirm: dotStatesAfterConfirm,
    },
  };
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
  let result = await page.evaluate(async (gateway_id) => window.redevenDesktopLauncher.performAction({
    kind: 'pair_gateway',
    gateway_id,
    start_policy: 'start_if_needed',
  }), current.environment.gateway_id);
  const needsGatewayUpdate = result?.code === 'gateway_start_required'
    || result?.failure?.code === 'gateway_start_required'
    || result?.gateway_start_required_payload !== undefined
    || (result?.next_actions ?? []).some((action) => action?.kind === 'update_gateway')
    || (result?.failure?.next_actions ?? []).some((action) => action?.kind === 'update_gateway');
  if (result?.ok !== true && needsGatewayUpdate) {
    const updated = await page.evaluate(async (gateway_id) => window.redevenDesktopLauncher.performAction({
      kind: 'update_gateway',
      gateway_id,
      impact_acknowledged: true,
    }), current.environment.gateway_id);
    if (updated?.ok !== true) {
      throw new Error(`${label} Gateway update required before pairing but update failed: ${JSON.stringify(updated)}`);
    }
    await waitForEnvironment(
      page,
      label,
      (environment) => environment.gateway_status === 'online',
      180_000,
    );
    result = await page.evaluate(async (gateway_id) => window.redevenDesktopLauncher.performAction({
      kind: 'pair_gateway',
      gateway_id,
      start_policy: 'start_if_needed',
    }), current.environment.gateway_id);
  }
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

async function closeWorkspacePages(browser) {
  await Promise.all(browserPages(browser).filter(isWorkspacePage).map((page) => page.close().catch(() => undefined)));
}

function desktopBundleTarget() {
  const architecture = process.arch === 'x64' ? 'amd64' : process.arch;
  return `${process.platform}-${architecture}`;
}

function bundledRuntimeRoot() {
  return path.join(rootDir, 'desktop', '.bundle', desktopBundleTarget());
}

function assertBudget(label, durationMs, budgetMs) {
  if (durationMs > budgetMs) {
    throw new Error(`${label} exceeded its ${budgetMs}ms budget: ${durationMs}ms`);
  }
}

async function gatewayLifecycleState(snapshot, gatewayID = '') {
  const source = (snapshot?.gateway_sources ?? []).find((candidate) => candidate.gateway_id === gatewayID)
    ?? snapshot?.gateway_sources?.[0];
  const gatewayStateRoot = source?.service_state?.service_state_root;
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

async function writeSSHSmokeGatewayCatalog(stateRoot, target) {
  const gatewayRoot = path.join(stateRoot, 'local-environment', 'gateway');
  await fs.mkdir(gatewayRoot, { recursive: true });
  const now = Date.now();
  const bindingAudience = `ssh://${target.destination}:${target.port}${target.runtimeRoot}`;
  const gateway = {
    schema_version: 2,
    gateway_id: `gw_${createHash('sha256').update(bindingAudience, 'utf8').digest('base64url').slice(0, 24)}`,
    display_name: 'SSH Remote Environment Gateway',
    runtime_environment_id: 'ssh-smoke-remote',
    local_enabled: true,
    connection: {
      kind: 'ssh_host',
      ssh_destination: target.destination,
      ssh_port: target.port,
      auth_mode: 'key_agent',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: '',
      connect_timeout_seconds: 10,
      runtime_root: target.runtimeRoot,
    },
    created_at_ms: now,
    updated_at_ms: now,
  };
  await fs.writeFile(
    path.join(gatewayRoot, 'gateways.json'),
    `${JSON.stringify({ schema_version: 2, gateways: [gateway] }, null, 2)}\n`,
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

  const bundledRuntime = path.join(bundledRuntimeRoot(), 'redeven');
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

async function stopSmokeGatewayServices(runtimeRoots) {
  const bundledGateway = path.join(bundledRuntimeRoot(), 'redeven-gateway');
  for (const runtimeRoot of runtimeRoots) {
    const managedExecutable = path.join(runtimeRoot, 'gateway', 'managed', 'bin', 'redeven-gateway');
    const executable = await fs.stat(bundledGateway).then((stat) => stat.isFile() ? bundledGateway : managedExecutable, () => managedExecutable);
    if (!await fs.stat(executable).then((stat) => stat.isFile(), () => false)) continue;
    const gatewaysRoot = path.join(runtimeRoot, 'gateways');
    const entries = await fs.readdir(gatewaysRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const serviceStateRoot = path.join(gatewaysRoot, entry.name, 'state');
      const stopped = await captureCommand(executable, [
        'service-stop', '--state-root', serviceStateRoot,
      ], { timeoutMs: 15_000 });
      if (stopped.exit_code !== 0) {
        throw new Error(`failed to stop smoke Gateway ${entry.name}: ${stopped.stderr || stopped.stdout}`);
      }
    }
  }
}

async function stopSmokeRuntimeProcesses(runtimeRoots) {
  const bundledRuntime = path.join(bundledRuntimeRoot(), 'redeven');
  for (const runtimeRoot of runtimeRoots) {
    const managedExecutable = path.join(runtimeRoot, 'runtime', 'managed', 'bin', 'redeven');
    const executable = await fs.stat(bundledRuntime).then((stat) => stat.isFile() ? bundledRuntime : managedExecutable, () => managedExecutable);
    if (!await fs.stat(executable).then((stat) => stat.isFile(), () => false)) continue;
    const stopped = await captureCommand(executable, [
      'desktop-runtime-stop',
      '--state-root', runtimeRoot,
      '--grace-period', '10s',
    ], { timeoutMs: 20_000 });
    if (stopped.exit_code !== 0) {
      throw new Error(`failed to stop smoke Runtime at ${runtimeRoot}: ${stopped.stderr || stopped.stdout}`);
    }
  }
}

function operationEvidence(lifecycleState, operationID) {
  const operation = lifecycleState?.store?.operations?.[operationID];
  if (!operation) return null;
  const events = [...(lifecycleState.store.events?.[operationID] ?? [])].sort((left, right) => left.sequence - right.sequence);
  return {
    operation_id: operationID,
    kind: operation.kind,
    state: operation.state,
    target: {
      lifecycle_target_id: operation.lifecycle_target_id,
      target_generation: operation.target_generation,
    },
    desired_runtime: operation.desired_runtime,
    artifact: operation.artifact,
    events: events.map((event, index) => ({
      sequence: event.sequence,
      state: event.state,
      timestamp_unix_ms: event.timestamp_unix_ms,
      elapsed_from_previous_ms: index === 0 ? 0 : event.timestamp_unix_ms - events[index - 1].timestamp_unix_ms,
    })),
  };
}

function latestOperationEvidence(lifecycleState, kind) {
  const matches = Object.entries(lifecycleState?.store?.operations ?? {})
    .filter(([, operation]) => operation.kind === kind)
    .sort(([, left], [, right]) => right.created_at_unix_ms - left.created_at_unix_ms);
  return matches.length > 0 ? operationEvidence(lifecycleState, matches[0][0]) : null;
}

function assertOperationStates(evidence, expectedStates) {
  if (!evidence) throw new Error(`missing ${expectedStates.join(' -> ')} operation evidence`);
  const actual = evidence.events.map((event) => event.state);
  if (JSON.stringify(actual) !== JSON.stringify(expectedStates)) {
    throw new Error(`${evidence.kind} event sequence mismatch: got=${JSON.stringify(actual)} want=${JSON.stringify(expectedStates)}`);
  }
}

async function assertNormalPathHasNoArtifactWork(snapshot, gatewayID, outputSinceDesktopStart) {
  const lifecycleState = await gatewayLifecycleState(snapshot, gatewayID);
  const operations = Object.values(lifecycleState?.store?.operations ?? {});
  const artifactEvents = Object.values(lifecycleState?.store?.events ?? {}).flat().filter((event) => (
    event.state === 'awaiting_artifact' || event.state === 'staging'
  ));
  if (operations.some((operation) => operation.kind === 'update_runtime') || artifactEvents.length > 0 || (lifecycleState?.staging_files?.length ?? 0) > 0) {
    throw new Error(`normal Desktop startup/open performed Runtime artifact work: ${JSON.stringify(lifecycleState)}`);
  }
  const forbiddenOutput = ['build_assets.sh', 'build_runtime_binary.sh', 'Preparing source Runtime upload asset', 'runtime.artifact.partial'];
  const matched = forbiddenOutput.find((value) => outputSinceDesktopStart.includes(value));
  if (matched) {
    throw new Error(`normal Desktop startup/open invoked forbidden source preparation: ${matched}`);
  }
  return lifecycleState;
}

async function runExplicitUpdate(page, label, snapshot, gatewayID) {
  const startedAt = Date.now();
  await lifecycleActionForEnvironment(page, label, 'update_runtime', 'updated_gateway_environment_runtime');
  const ready = await waitForEnvironment(
    page,
    label,
    (environment) => environment.runtime_health.status === 'online',
    phaseBudgets.lifecycle_update_ms,
  );
  const durationMs = Date.now() - startedAt;
  assertBudget(`${label} explicit Runtime update`, durationMs, phaseBudgets.lifecycle_update_ms);
  const lifecycleState = await gatewayLifecycleState(ready.snapshot ?? snapshot, gatewayID);
  const update = latestOperationEvidence(lifecycleState, 'update_runtime');
  assertOperationStates(update, [
    'preflighting', 'awaiting_confirmation', 'awaiting_artifact', 'staging',
    'commit_ready', 'fencing', 'committing', 'succeeded',
  ]);
  if (update.desired_runtime?.artifact_policy !== 'custom_build' || !update.artifact?.archive_sha256 || !update.artifact?.executable_sha256) {
    throw new Error(`${label} explicit update did not preserve custom-build artifact identity: ${JSON.stringify(update)}`);
  }
  return {
    duration_ms: durationMs,
    runtime_version: ready.environment.runtime_health.runtime_service?.runtime_version,
    operation: update,
  };
}

async function runLocalColdStartScenario({ page, browser, launchStartedAt, output, stateRoot }) {
  const ready = await waitForEnvironment(
    page,
    'Local Environment',
    (environment) => environment.gateway_status === 'online' && environment.runtime_health.status === 'online',
    phaseBudgets.desktop_cold_start_ms,
  );
  const coldStartDurationMS = Date.now() - launchStartedAt;
  assertBudget('Desktop cold startup', coldStartDurationMS, phaseBudgets.desktop_cold_start_ms);
  const pairing = await ensureGatewayPaired(page, 'Local Environment');
  const managedRuntime = path.join(stateRoot, 'local-environment', 'runtime', 'managed', 'bin', 'redeven');
  if (!await fs.stat(managedRuntime).then((stat) => stat.isFile(), () => false)) {
    throw new Error(`Desktop cold startup did not provision the bundled Runtime: ${managedRuntime}`);
  }
  const card = await environmentCard(page, 'Local Environment');
  const primaryLabel = (await card.locator('.redeven-split-action-primary button').first().innerText()).trim();
  if (ready.environment.open_action !== 'open' || !/^(Open|打开)$/u.test(primaryLabel)) {
    throw new Error(`ready Local Environment primary action was not Open: action=${ready.environment.open_action} label=${primaryLabel}`);
  }
  const lifecycleBeforeOpen = await assertNormalPathHasNoArtifactWork(
    ready.snapshot,
    ready.environment.gateway_id,
    output.join(''),
  );
  const openStartedAt = Date.now();
  const direct = await openDirectly(page, 'Local Environment');
  const workspace = await waitForWorkspace(browser);
  await waitForEnvironment(page, 'Local Environment', (environment) => environment.is_open === true, phaseBudgets.direct_open_ms);
  const directOpenDurationMS = Date.now() - openStartedAt;
  assertBudget('Local Environment direct open', directOpenDurationMS, phaseBudgets.direct_open_ms);
  await closeWorkspacePages(browser);
  await lifecycleActionForEnvironment(page, 'Local Environment', 'stop', 'stopped_gateway_environment_runtime');
  await waitForEnvironment(page, 'Local Environment', (environment) => environment.runtime_health.status !== 'online', phaseBudgets.lifecycle_start_ms);
  const pendingStart = await prepareLifecycleAction(page, 'Local Environment', 'start');
  const pendingState = await gatewayLifecycleState((await launcherSnapshot(page)), ready.environment.gateway_id);
  const pendingOperation = latestOperationEvidence(pendingState, 'start');
  if (!pendingOperation || pendingOperation.state !== 'awaiting_confirmation') {
    throw new Error(`start operation was not durable before Desktop restart: ${JSON.stringify(pendingOperation)}`);
  }
  return {
    environment: ready.environment,
    pendingStart,
    scenario: {
      label: 'Local Environment',
      gateway_pairing: pairing,
      cold_start_duration_ms: coldStartDurationMS,
      direct_open_duration_ms: directOpenDurationMS,
      direct_open: { ...direct, workspace_url: workspace.url() },
      lifecycle_before_open: lifecycleBeforeOpen,
      pending_start_before_restart: pendingOperation,
    },
  };
}

async function continueLocalScenarioAfterRestart({ page, browser, local, reportRoot }) {
  const confirmed = await page.evaluate(async (operationKey) => window.redevenDesktopLauncher.performAction({
    kind: 'confirm_runtime_operation',
    operation_key: operationKey,
  }), local.pendingStart.operationKey);
  if (confirmed?.ok !== true || confirmed.outcome !== 'started_gateway_environment_runtime') {
    throw new Error(`persisted start operation did not resume after Desktop restart: ${JSON.stringify(confirmed)}`);
  }
  await waitForEnvironment(page, 'Local Environment', (environment) => environment.runtime_health.status === 'online', phaseBudgets.lifecycle_start_ms);
  const recoveredOpen = await openDirectly(page, 'Local Environment');
  const recoveredWorkspace = await waitForWorkspace(browser);
  await waitForEnvironment(page, 'Local Environment', (environment) => environment.is_open === true, phaseBudgets.direct_open_ms);
  await closeWorkspacePages(browser);

  await lifecycleActionForEnvironment(page, 'Local Environment', 'stop', 'stopped_gateway_environment_runtime');
  await waitForEnvironment(page, 'Local Environment', (environment) => environment.runtime_health.status !== 'online', phaseBudgets.lifecycle_start_ms);
  const start = await openThroughGuidance(page, 'Local Environment', /Start and open|启动并打开/u);
  const startedWorkspace = await waitForWorkspace(browser);
  await waitForEnvironment(page, 'Local Environment', (environment) => environment.runtime_health.status === 'online' && environment.is_open === true, phaseBudgets.lifecycle_start_ms);
  await closeWorkspacePages(browser);

  await lifecycleActionForEnvironment(page, 'Local Environment', 'restart', 'restarted_gateway_environment_runtime');
  const restarted = await waitForEnvironment(page, 'Local Environment', (environment) => environment.runtime_health.status === 'online', phaseBudgets.lifecycle_start_ms);
  const coldUpdate = await runExplicitUpdate(page, 'Local Environment', restarted.snapshot, local.environment.gateway_id);
  const warmUpdate = await runExplicitUpdate(page, 'Local Environment', restarted.snapshot, local.environment.gateway_id);
  const direct = await openDirectly(page, 'Local Environment');
  const workspace = await waitForWorkspace(browser);
  await page.screenshot({ path: path.join(reportRoot, 'desktop-lifecycle-local.png'), fullPage: true });
  return {
    ...local.scenario,
    recovered_start: { confirmation: confirmed, ...recoveredOpen, workspace_url: recoveredWorkspace.url() },
    start_and_open: { ...start, workspace_url: startedWorkspace.url() },
    restart: { outcome: 'restarted_gateway_environment_runtime' },
    source_build_cache: { cold: coldUpdate, warm: warmUpdate },
    open_after_update: { ...direct, workspace_url: workspace.url() },
  };
}

async function runSSHScenario({ page, browser, reportRoot }) {
  const initial = await waitForEnvironment(page, 'SSH Remote Environment', (environment) => Boolean(environment.gateway_id), phaseBudgets.lifecycle_start_ms);
  const pairing = await ensureGatewayPaired(page, 'SSH Remote Environment');
  const initialUpdate = await runExplicitUpdate(page, 'SSH Remote Environment', initial.snapshot, initial.environment.gateway_id);
  const direct = await openDirectly(page, 'SSH Remote Environment');
  const workspace = await waitForWorkspace(browser);
  await waitForEnvironment(page, 'SSH Remote Environment', (environment) => environment.is_open === true, phaseBudgets.direct_open_ms);
  await closeWorkspacePages(browser);
  await lifecycleActionForEnvironment(page, 'SSH Remote Environment', 'stop', 'stopped_gateway_environment_runtime');
  await waitForEnvironment(page, 'SSH Remote Environment', (environment) => environment.runtime_health.status !== 'online', phaseBudgets.lifecycle_start_ms);
  const start = await openThroughGuidance(page, 'SSH Remote Environment', /Start and open|启动并打开/u);
  const startedWorkspace = await waitForWorkspace(browser);
  await waitForEnvironment(page, 'SSH Remote Environment', (environment) => environment.runtime_health.status === 'online' && environment.is_open === true, phaseBudgets.lifecycle_start_ms);
  await closeWorkspacePages(browser);
  await lifecycleActionForEnvironment(page, 'SSH Remote Environment', 'restart', 'restarted_gateway_environment_runtime');
  const restarted = await waitForEnvironment(page, 'SSH Remote Environment', (environment) => environment.runtime_health.status === 'online', phaseBudgets.lifecycle_start_ms);
  const update = await runExplicitUpdate(page, 'SSH Remote Environment', restarted.snapshot, initial.environment.gateway_id);
  const reopened = await openDirectly(page, 'SSH Remote Environment');
  const reopenedWorkspace = await waitForWorkspace(browser);
  await page.screenshot({ path: path.join(reportRoot, 'desktop-lifecycle-ssh-remote.png'), fullPage: true });
  return {
    label: 'SSH Remote Environment',
    gateway_pairing: pairing,
    initial_explicit_update: initialUpdate,
    open: { ...direct, workspace_url: workspace.url() },
    start_and_open: { ...start, workspace_url: startedWorkspace.url() },
    restart: { outcome: 'restarted_gateway_environment_runtime' },
    update,
    open_after_update: { ...reopened, workspace_url: reopenedWorkspace.url() },
  };
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

  const bundleRoot = bundledRuntimeRoot();
  const bundleManifestPath = path.join(bundleRoot, 'desktop-bundle-manifest.json');
  const bundleManifest = JSON.parse(await fs.readFile(bundleManifestPath, 'utf8').catch((error) => {
    throw new Error(`Desktop smoke requires a prebuilt bundle at ${bundleManifestPath}: ${error}`);
  }));
  const desktopMainPath = path.join(rootDir, 'desktop', 'dist', 'main', 'main.js');
  if (!await fs.stat(desktopMainPath).then((stat) => stat.isFile(), () => false)) {
    throw new Error(`Desktop smoke requires a prebuilt Desktop at ${desktopMainPath}`);
  }

  const ports = new Set();
  const cdpPort = await reservePort(ports); ports.add(cdpPort);
  const inspectorPort = await reservePort(ports); ports.add(inspectorPort);
  const sshTarget = await startSSHSmokeTarget(tempRoot, ports);
  await writeSSHSmokeCatalog(stateRoot, sshTarget);
  await writeSSHSmokeGatewayCatalog(stateRoot, sshTarget);
  const output = [];
  const desktopEnvironment = {
    ...process.env,
    ...sshTarget.agentEnv,
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    REDEVEN_STATE_ROOT: stateRoot,
    REDEVEN_DESKTOP_USER_DATA_ROOT: userDataRoot,
    REDEVEN_DESKTOP_CACHE_ROOT: cacheRoot,
    REDEVEN_DESKTOP_TEMP_ROOT: desktopTempRoot,
    REDEVEN_DESKTOP_LOCAL_UI_BIND: '127.0.0.1:0',
    REDEVEN_DESKTOP_AUTO_START_RUNTIME: '1',
    REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0',
    REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG: bundleManifest.version,
    REDEVEN_DESKTOP_BUNDLE_VERSION: bundleManifest.version,
    REDEVEN_DESKTOP_BUNDLE_COMMIT: bundleManifest.commit,
    REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT: rootDir,
  };
  const launchDesktop = () => {
    const launchedAt = Date.now();
    const launched = spawn(path.join(rootDir, 'desktop', 'node_modules', '.bin', 'electron'), [
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${cdpPort}`,
      `--inspect=127.0.0.1:${inspectorPort}`,
      '.',
    ], {
      cwd: path.join(rootDir, 'desktop'),
      detached: true,
      env: desktopEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    launched.stdout.on('data', (chunk) => output.push(chunk.toString()));
    launched.stderr.on('data', (chunk) => output.push(chunk.toString()));
    return { child: launched, launchedAt };
  };
  let launch = launchDesktop();
  let child = launch.child;

  let browser;
  let launcherPage;
  let failure;
  const evidence = {
    platform: process.platform,
    architecture: process.arch,
    root: tempRoot,
    state_root: stateRoot,
    electron_pid: child.pid,
    cdp_port: cdpPort,
    inspector_port: inspectorPort,
    ssh_remote: {
      destination: sshTarget.destination,
      port: sshTarget.port,
      runtime_root: sshTarget.runtimeRoot,
      platform: process.platform,
    },
    launch_started_at_unix_ms: launch.launchedAt,
    bundle: {
      manifest_path: bundleManifestPath,
      version: bundleManifest.version,
      commit: bundleManifest.commit,
      platform: bundleManifest.platform,
      architecture: bundleManifest.architecture,
      gateway_sha256: bundleManifest.gateway.sha256,
      runtime_sha256: bundleManifest.runtime_suite.find((artifact) => artifact.path === 'redeven')?.sha256,
    },
    startups: [],
    scenarios: {},
  };
  try {
    const connectDesktop = async (budgetMs) => {
      await waitFor(async () => {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new FatalSmokeError(`Desktop exited before CDP readiness: code=${child.exitCode} signal=${child.signalCode}`);
        }
        const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null);
        return response?.ok ? true : null;
      }, budgetMs, 'Desktop CDP endpoint');

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
      return page;
    };

    let page = await connectDesktop(phaseBudgets.desktop_cold_start_ms);
    const local = await runLocalColdStartScenario({
      page,
      browser,
      launchStartedAt: launch.launchedAt,
      output,
      stateRoot,
    });
    evidence.startups.push({ kind: 'cold', duration_ms: local.scenario.cold_start_duration_ms });
    evidence.scenarios.local = local.scenario;
    await browser.close();
    browser = undefined;
    await stopProcessGroup(child, output);
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null);
      return response ? null : true;
    }, 15_000, 'Desktop CDP shutdown');
    launch = launchDesktop();
    child = launch.child;
    evidence.electron_pid_after_pending_restart = child.pid;
    page = await connectDesktop(phaseBudgets.desktop_warm_start_ms);
    const gatewayRecovered = await waitForEnvironment(
      page,
      'Local Environment',
      (environment) => environment.gateway_status === 'online',
      phaseBudgets.desktop_warm_start_ms,
    );
    const warmStartDurationMS = Date.now() - launch.launchedAt;
    assertBudget('Desktop pending-operation recovery', warmStartDurationMS, phaseBudgets.desktop_warm_start_ms);
    evidence.startups.push({ kind: 'pending_operation_recovery', duration_ms: warmStartDurationMS });
    const recoveredLifecycle = await gatewayLifecycleState(gatewayRecovered.snapshot, local.environment.gateway_id);
    const recoveredStart = latestOperationEvidence(recoveredLifecycle, 'start');
    if (!recoveredStart || recoveredStart.operation_id !== local.scenario.pending_start_before_restart.operation_id || recoveredStart.state !== 'awaiting_confirmation') {
      throw new Error(`Desktop/Gateway did not recover the exact pending start operation: ${JSON.stringify(recoveredStart)}`);
    }
    const recoveredAttachment = await waitFor(async () => {
      const snapshot = await launcherSnapshot(page);
      return snapshot.operations.find((operation) => (
        operation.operation_key === local.pendingStart.operationKey
        && operation.status === 'needs_confirmation'
        && operation.runtime_confirmation?.operation === 'start'
      )) ?? null;
    }, phaseBudgets.desktop_warm_start_ms, 'Desktop pending Runtime operation attachment');
    evidence.scenarios.local = await continueLocalScenarioAfterRestart({ page, browser, local, reportRoot });
    evidence.scenarios.local.pending_start_after_restart = recoveredStart;
    evidence.scenarios.local.pending_start_attachment_after_restart = recoveredAttachment;
    evidence.scenarios.ssh_remote = await runSSHScenario({ page, browser, reportRoot });

    await closeWorkspacePages(browser);
    await browser.close();
    browser = undefined;
    await stopProcessGroup(child, output);
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null);
      return response ? null : true;
    }, 15_000, 'Desktop CDP shutdown after updates');
    launch = launchDesktop();
    child = launch.child;
    page = await connectDesktop(phaseBudgets.desktop_warm_start_ms);
    const readyAfterUpdateRestart = await waitForEnvironment(
      page,
      'Local Environment',
      (environment) => environment.gateway_status === 'online' && environment.runtime_health.status === 'online',
      phaseBudgets.desktop_warm_start_ms,
    );
    const updateRecoveryDurationMS = Date.now() - launch.launchedAt;
    assertBudget('Desktop verified-update recovery', updateRecoveryDurationMS, phaseBudgets.desktop_warm_start_ms);
    evidence.startups.push({ kind: 'verified_update_recovery', duration_ms: updateRecoveryDurationMS });
    const openAfterDesktopRestart = await openDirectly(page, 'Local Environment');
    const workspaceAfterDesktopRestart = await waitForWorkspace(browser);
    evidence.scenarios.local.desktop_restart_after_update = {
      duration_ms: updateRecoveryDurationMS,
      runtime_version: readyAfterUpdateRestart.environment.runtime_health.runtime_service?.runtime_version,
      ...openAfterDesktopRestart,
      workspace_url: workspaceAfterDesktopRestart.url(),
    };
    evidence.completed_at_unix_ms = Date.now();
    evidence.duration_ms = evidence.completed_at_unix_ms - evidence.launch_started_at_unix_ms;
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
    await stopSmokeRuntimeProcesses([
      path.join(stateRoot, 'local-environment'),
      sshTarget.runtimeRoot,
    ]).catch((error) => {
      failure ??= error;
    });
    await stopSmokeGatewayServices([
      path.join(stateRoot, 'local-environment'),
      sshTarget.runtimeRoot,
    ]).catch((error) => {
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
