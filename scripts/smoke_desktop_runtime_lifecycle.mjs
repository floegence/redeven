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
const workspaceReadinessEvidence = new WeakMap();

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
  const directRuntimeKind = operation === 'update_runtime'
    ? 'update_environment_runtime'
    : `${operation}_environment_runtime`;
  const request = environment.kind === 'local_environment' || environment.kind === 'ssh_environment'
    ? {
        kind: directRuntimeKind,
        environment_id: environment.id,
        label: environment.label,
        ...(environment.managed_runtime_target_id ? { runtime_target_id: environment.managed_runtime_target_id } : {}),
        ...(environment.managed_runtime_placement_target_id ? { placement_target_id: environment.managed_runtime_placement_target_id } : {}),
        ...(environment.managed_runtime_host_access ? { host_access: environment.managed_runtime_host_access } : {}),
        ...(environment.managed_runtime_placement ? { placement: environment.managed_runtime_placement } : {}),
        ...(environment.ssh_details ?? {}),
        ...(operation === 'update_runtime' ? { force_runtime_update: true } : {}),
      }
    : {
        kind: 'run_gateway_environment_lifecycle',
        environment_id: environment.id,
        gateway_id: environment.gateway_id,
        gateway_env_id: environment.gateway_env_id,
        operation,
        label: environment.label,
      };
  const prepared = await page.evaluate(async (action) => (
    window.redevenDesktopLauncher.performAction(action)
  ), request);
  if (prepared?.ok !== true && prepared?.code !== 'confirmation_required') {
    throw new Error(`${operation} did not start successfully or stop for confirmation: ${JSON.stringify(prepared)}`);
  }
  return {
    environment,
    operationKey: `${environment.id}:${operation}`,
    prepared,
  };
}

async function lifecycleActionForEnvironment(page, label, operation, expectedOutcome) {
  const { operationKey, prepared } = await prepareLifecycleAction(page, label, operation);
  const confirmed = prepared.ok === true
    ? prepared
    : await page.evaluate(async ({ operationKey }) => (
      window.redevenDesktopLauncher.performAction({
        kind: 'confirm_runtime_operation',
        operation_key: operationKey,
      })
    ), { operationKey });
  const directOutcome = operation === 'update_runtime'
    ? 'updated_environment_runtime'
    : operation === 'start'
      ? 'started_environment_runtime'
      : operation === 'stop'
        ? 'stopped_environment_runtime'
        : 'restarted_environment_runtime';
  if (
    confirmed?.ok !== true
    || (!new Set([expectedOutcome, directOutcome]).has(confirmed.outcome) && prepared.ok !== true)
  ) {
    throw new Error(`${operation} failed after lifecycle preflight: ${JSON.stringify(confirmed)}`);
  }
  const completed = await waitFor(async () => {
    const snapshot = await launcherSnapshot(page);
    const operationSnapshot = snapshot.operations.find((candidate) => candidate.operation_key === operationKey);
    const progress = operationSnapshot?.lifecycle_progress;
    if (operationSnapshot?.status === 'succeeded'
      && progress?.plan_state === 'terminal'
      && progress.steps.length > 0
      && progress.steps.every((step) => step.status === 'succeeded')
    ) {
      return operationSnapshot;
    }
    // Successful operations are intentionally removed after a short
    // retention window. If the operation has already been evicted, the
    // authoritative Runtime health is the durable completion evidence.
    const environment = environmentByLabel(snapshot, label);
    const runtimeReady = environment?.runtime_health.status === 'online';
    const runtimeStopped = environment?.runtime_health.status === 'offline';
    if ((operation === 'stop' ? runtimeStopped : runtimeReady) && !operationSnapshot) {
      return {
        operation_key: operationKey,
        status: 'succeeded',
        lifecycle_progress: null,
        retained: false,
      };
    }
    return null;
  }, phaseBudgets.lifecycle_start_ms, `${label} ${operation} lifecycle completion`);
  return { prepared, confirmed, completed };
}

async function assertFailedOperationHasGuidance(page, result, label, expectedTarget = {}) {
  if (result?.ok !== false) {
    throw new Error(`${label} unexpectedly succeeded: ${JSON.stringify(result)}`);
  }
  const operationKey = String(result.operation_key ?? '').trim();
  if (!operationKey) {
    throw new Error(`${label} did not return a retained operation key: ${JSON.stringify(result)}`);
  }
  const retained = await waitFor(async () => {
    const snapshot = await launcherSnapshot(page);
    const operation = snapshot.operations.find((candidate) => candidate.operation_key === operationKey);
    return operation?.status === 'failed' ? { operation, snapshot } : null;
  }, 10_000, `${label} failed operation`);
  const operation = retained.operation;
  const summary = String(result.failure?.summary ?? operation.failure?.summary ?? result.message ?? '').trim();
  if (!summary) {
    throw new Error(`${label} failed without a user-facing summary: ${JSON.stringify({ result, operation })}`);
  }
  const lifecycleProgress = operation.lifecycle_progress;
  const failedSteps = lifecycleProgress?.steps.filter((step) => step.status === 'failed') ?? [];
  if (lifecycleProgress) {
    if (
      lifecycleProgress.plan_state !== 'terminal'
      || !lifecycleProgress.failed_step_id
      || failedSteps.length !== 1
      || failedSteps[0]?.id !== lifecycleProgress.failed_step_id
    ) {
      throw new Error(`${label} did not retain one terminal failed lifecycle step: ${JSON.stringify(operation)}`);
    }
  } else if (operation.open_progress) {
    const open = operation.open_progress;
    if (
      open.phase === 'failed'
      || open.phase === 'canceled'
      || !Number.isInteger(open.stage_index)
      || !Number.isInteger(open.stage_count)
      || open.stage_index < 1
      || open.stage_index > open.stage_count
    ) {
      throw new Error(`${label} did not retain the real failed Open step: ${JSON.stringify(operation)}`);
    }
  } else {
    throw new Error(`${label} failed without lifecycle or Open step progress: ${JSON.stringify(operation)}`);
  }
  const nextActions = operation.next_actions ?? [];
  const actionKinds = new Set(nextActions.map((action) => action.kind));
  for (const requiredKind of ['retry', 'refresh_status', 'copy_diagnostics', 'dismiss']) {
    if (!actionKinds.has(requiredKind)) {
      throw new Error(`${label} failure guidance omitted ${requiredKind}: ${JSON.stringify(operation)}`);
    }
  }
  const retryAction = nextActions.find((action) => action.kind === 'retry')?.retry_action;
  if (!retryAction) {
    throw new Error(`${label} failure guidance did not retain a retry request: ${JSON.stringify(operation)}`);
  }
  for (const [key, expected] of Object.entries(expectedTarget)) {
    if (JSON.stringify(retryAction[key]) !== JSON.stringify(expected)) {
      throw new Error(`${label} retry request changed ${key}: got=${JSON.stringify(retryAction[key])} want=${JSON.stringify(expected)}`);
    }
  }
  const visibleText = [operation.title, operation.detail, summary].filter(Boolean).join(' ');
  if (/\b(?:Gateway|Provider)\b/iu.test(visibleText)) {
    throw new Error(`${label} exposed an internal Gateway/Provider label in user-facing failure text: ${visibleText}`);
  }
  return {
    operation_key: operationKey,
    code: result.code,
    summary,
    next_actions: nextActions.map((action) => action.kind),
    retry_action: retryAction,
  };
}

async function confirmPendingRuntimeOperation(page, environmentLabel, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let confirmationCount = 0;
  while (Date.now() < deadline) {
    const snapshot = await launcherSnapshot(page);
    const pending = snapshot.operations.find((operation) => (
      operation.environment_label === environmentLabel
      && operation.status === 'needs_confirmation'
      && operation.runtime_confirmation?.operation
    ));
    if (pending) {
      const result = await page.evaluate(async (operationKey) => (
        window.redevenDesktopLauncher.performAction({
          kind: 'confirm_runtime_operation',
          operation_key: operationKey,
        })
      ), pending.operation_key);
      confirmationCount += 1;
      if (result?.ok === true && result?.code !== 'confirmation_required') {
        return { ...result, confirmation_count: confirmationCount };
      }
      continue;
    }
    const failed = snapshot.operations.find((operation) => (
      operation.environment_label === environmentLabel
      && operation.status === 'failed'
      && operation.failure
    ));
    if (failed) {
      throw new Error(`${environmentLabel} open operation failed before confirmation: ${JSON.stringify(failed)}`);
    }
    await delay(100);
  }
  return confirmationCount > 0 ? { ok: true, confirmation_count: confirmationCount } : null;
}

async function runContainerFailureScenarios(page, sshTarget) {
  const sshHost = {
    kind: 'ssh_host',
    ssh: {
      ssh_destination: sshTarget.destination,
      ssh_port: sshTarget.port,
      auth_mode: 'key_agent',
      connect_timeout_seconds: 10,
    },
  };
  const missingSSHContainer = {
    kind: 'container_process',
    container_engine: 'docker',
    container_id: 'redeven-smoke-missing-id',
    container_ref: 'redeven-smoke-missing',
    container_label: 'redeven-smoke-missing',
    runtime_root: sshTarget.runtimeRoot,
    runtime_state_root: sshTarget.runtimeRoot,
    bridge_strategy: 'exec_stream',
  };
  const sshTargetFields = {
    host_access: sshHost,
    placement: missingSSHContainer,
    runtime_target_id: 'ssh:container:smoke-missing',
    placement_target_id: 'ssh:container:smoke-missing',
    ssh_destination: sshTarget.destination,
    ssh_port: sshTarget.port,
    auth_mode: 'key_agent',
    runtime_root: sshTarget.runtimeRoot,
    bootstrap_strategy: 'desktop_upload',
    release_base_url: '',
    connect_timeout_seconds: 10,
  };
  const sshOpenResult = await page.evaluate(async (request) => (
    window.redevenDesktopLauncher.performAction(request)
  ), {
    kind: 'open_ssh_environment',
    environment_id: 'ssh-container-smoke-missing',
    label: 'SSH Container Missing',
    ...sshTargetFields,
  });
  const sshOpen = await assertFailedOperationHasGuidance(
    page,
    sshOpenResult,
    'SSH container Open with missing container',
    {
      placement: missingSSHContainer,
      host_access: sshHost,
    },
  );

  const sshUpdateResult = await page.evaluate(async (request) => (
    window.redevenDesktopLauncher.performAction(request)
  ), {
    kind: 'update_environment_runtime',
    environment_id: 'ssh-container-smoke-update-missing',
    label: 'SSH Container Update Missing',
    ...sshTargetFields,
  });
  const sshUpdate = await assertFailedOperationHasGuidance(
    page,
    sshUpdateResult,
    'SSH container Update with missing container',
    {
      placement: missingSSHContainer,
      host_access: sshHost,
    },
  );

  const localHost = { kind: 'local_host' };
  const missingLocalContainer = {
    kind: 'container_process',
    container_engine: 'docker',
    container_id: 'redeven-smoke-local-missing-id',
    container_ref: 'redeven-smoke-local-missing',
    container_label: 'redeven-smoke-local-missing',
    runtime_root: path.join(os.tmpdir(), 'redeven-smoke-local-container'),
    runtime_state_root: path.join(os.tmpdir(), 'redeven-smoke-local-container'),
    bridge_strategy: 'exec_stream',
  };
  const localRestartRequest = {
    kind: 'restart_environment_runtime',
    environment_id: 'local-container-smoke-missing',
    label: 'Local Container Missing',
    runtime_target_id: 'local:container:smoke-missing',
    placement_target_id: 'local:container:smoke-missing',
    host_access: localHost,
    placement: missingLocalContainer,
  };
  const localRestartResult = await page.evaluate(async (request) => (
    window.redevenDesktopLauncher.performAction(request)
  ), localRestartRequest);
  const localRestart = await assertFailedOperationHasGuidance(
    page,
    localRestartResult,
    'Local container Restart with missing container',
    {
      placement: missingLocalContainer,
      host_access: localHost,
    },
  );
  return { ssh_open: sshOpen, ssh_update: sshUpdate, local_restart: localRestart };
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
  const before = await launcherSnapshot(page);
  const beforeEnvironment = environmentByLabel(before, label);
  await primary.click();
  const panel = page.locator('.redeven-action-popover').filter({ hasText: expectedGuidance }).first();
  try {
    await panel.waitFor({ state: 'visible', timeout: 5_000 });
  } catch (error) {
    // A background probe can finish between card render and click. In that
    // case the primary action legitimately becomes a direct Open and should
    // still converge to a workspace without exposing a dead-end error.
    if (beforeEnvironment?.is_open === false) {
      const converged = await waitFor(async () => {
        const snapshot = await launcherSnapshot(page);
        const environment = environmentByLabel(snapshot, label);
        const operation = (snapshot?.operations ?? []).find((candidate) => (
          candidate?.environment_label === label
          && candidate?.action === 'open_local_environment'
        ));
        return environment?.runtime_health.status === 'online'
          && environment.is_open === true
          && operation?.status === 'succeeded'
          && operation?.phase === 'open_ready'
          ? { environment, operation }
          : null;
      }, 25_000, `${label} direct open after readiness convergence`).catch(() => null);
      if (converged) {
        return {
          primaryLabel,
          actionLabel: primaryLabel,
          panelText: '',
          direct_after_readiness_convergence: true,
          timeline: null,
          confirmation: null,
        };
      }
    }
    throw error;
  }
  const action = panel.locator('.redeven-action-popover__actions button').first();
  await action.waitFor({ state: 'visible', timeout: 30_000 });
  const actionLabel = (await action.innerText()).trim();
  const panelText = (await panel.innerText()).trim();
  await action.click();
  const timeline = page.locator('.redeven-action-popover .redeven-environment-progress__steps').last();
  await timeline.waitFor({ state: 'visible', timeout: 30_000 });
  const stepCount = await timeline.locator('.redeven-environment-progress__step').count();
  const connectorCount = await timeline.locator('.redeven-environment-progress__step-line').count();
  // The target is re-probed after the card is rendered. If it becomes
  // initialized between render and click, an Initialize-and-open request
  // legitimately converges to the shorter Start-and-open flow.
  const expectedStepCounts = /Initialize and open|初始化并打开/u.test(actionLabel)
    ? [3, 4]
    : /Start and open|启动并打开/u.test(actionLabel)
      ? [3]
      : [1];
  const dotStatesBeforeConfirm = await timeline.locator('.redeven-environment-progress__step-dot').evaluateAll((dots) => (
    dots.map((dot) => dot.getAttribute('data-state'))
  ));
  if (!expectedStepCounts.includes(stepCount) || connectorCount !== Math.max(0, stepCount - 1)) {
    throw new Error(`${label} open-flow timeline shape was incomplete: steps=${stepCount}, connectors=${connectorCount}, expected=${expectedStepCounts.join(' or ')}`);
  }
  await delay(100);
  const dotStatesAfterConfirm = await timeline.locator('.redeven-environment-progress__step-dot').evaluateAll((dots) => (
    dots.map((dot) => dot.getAttribute('data-state'))
  )).catch(() => []);
  const confirmation = await confirmPendingRuntimeOperation(page, label);
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
    confirmation,
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
  const confirmation = await confirmPendingRuntimeOperation(page, label);
  return { label: labelBeforeClick, confirmation };
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

async function filesNamed(root, expectedName, depth = 0) {
  if (depth > 8) return [];
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const matches = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === expectedName) {
      matches.push(entryPath);
    } else if (entry.isDirectory()) {
      matches.push(...await filesNamed(entryPath, expectedName, depth + 1));
    }
  }
  return matches;
}

function eventCreatedAtUnixMS(event) {
  if (Number.isFinite(Number(event?.created_at_unix_ms))) return Number(event.created_at_unix_ms);
  if (Number.isFinite(Number(event?.created_at))) return Number(event.created_at);
  const parsed = Date.parse(String(event?.created_at ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function runtimeConnectedDiagnostic(roots, openedAfterUnixMS) {
  const paths = (await Promise.all(roots.map((root) => filesNamed(root, 'desktop-events.jsonl')))).flat();
  for (const diagnosticPath of paths) {
    const raw = await fs.readFile(diagnosticPath, 'utf8').catch(() => '');
    const events = raw.split('\n').flatMap((line) => {
      try {
        return line.trim() ? [JSON.parse(line)] : [];
      } catch {
        return [];
      }
    });
    const event = events.findLast((candidate) => (
      candidate?.kind === 'session_app_ready'
      && candidate?.detail?.state === 'runtime_connected'
      && eventCreatedAtUnixMS(candidate) >= openedAfterUnixMS
    ));
    if (event) return { path: diagnosticPath, event: redactDiagnosticValue(event) };
  }
  return null;
}

async function waitForWorkspace(browser, options = {}) {
  const excludedPages = options.excludedPages ?? new Set();
  let page;
  try {
    page = await waitFor(
      async () => {
        for (const candidate of browserPages(browser)) {
          if (excludedPages.has(candidate) || candidate.isClosed() || !isWorkspacePage(candidate)) continue;
          if (options.label) {
            const label = await candidate.evaluate(() => (
              window.redevenDesktopSessionContext?.getSnapshot?.()?.label ?? ''
            )).catch(() => '');
            if (label !== options.label) continue;
          }
          return candidate;
        }
        if (options.label) {
          const launcher = browserPages(browser).find((candidate) => candidate.url().includes('/welcome/index.html'));
          const snapshot = launcher
            ? await launcher.evaluate(async () => window.redevenDesktopLauncher?.getSnapshot?.() ?? null).catch(() => null)
            : null;
          const failedOpen = (snapshot?.operations ?? []).find((operation) => (
            operation?.environment_label === options.label
            && operation?.action === 'open_local_environment'
            && (operation?.status === 'failed' || operation?.status === 'canceled')
          ));
          if (failedOpen) {
            throw new FatalSmokeError(`${options.label} Open stopped before a workspace was ready: ${JSON.stringify({
              status: failedOpen.status,
              phase: failedOpen.phase,
              detail: failedOpen.detail,
              failure: failedOpen.failure,
              next_actions: failedOpen.next_actions,
            })}`);
          }
        }
        return null;
      },
      120_000,
      `${options.label ?? 'Desktop'} workspace window`,
    );
  } catch (error) {
    const launcher = browserPages(browser).find((candidate) => candidate.url().includes('/welcome/index.html'));
    const pages = browserPages(browser).map((candidate) => ({
      url: candidate.url(),
      closed: candidate.isClosed(),
      context: candidate.evaluate(() => window.redevenDesktopSessionContext?.getSnapshot?.() ?? null).catch(() => null),
    }));
    const resolvedPages = await Promise.all(pages);
    const launcherSnapshotValue = launcher
      ? await launcher.evaluate(async () => window.redevenDesktopLauncher?.getSnapshot?.() ?? null).catch(() => null)
      : null;
    const labelOperations = (launcherSnapshotValue?.operations ?? [])
      .filter((operation) => operation?.environment_label === options.label)
      .map((operation) => ({
        operation_key: operation.operation_key,
        action: operation.action,
        status: operation.status,
        phase: operation.phase,
        title: operation.title,
        detail: operation.detail,
        lifecycle_progress: operation.lifecycle_progress,
        open_progress: operation.open_progress,
        failure: operation.failure,
        next_actions: operation.next_actions,
      }));
    throw new Error(`${error.message}; browser pages=${JSON.stringify(resolvedPages)}; operations=${JSON.stringify(labelOperations)}`);
  }
  const rendered = await waitFor(async () => {
    if (page.isClosed()) return null;
    const evidence = await page.evaluate(() => {
      const body = document.body;
      const bodyText = String(body?.innerText ?? '').trim();
      const context = window.redevenDesktopSessionContext?.getSnapshot?.() ?? null;
      return {
        ready_state: document.readyState,
        title: document.title,
        body_text_length: bodyText.length,
        body_width: Math.round(body?.getBoundingClientRect().width ?? 0),
        body_height: Math.round(body?.getBoundingClientRect().height ?? 0),
        root_child_count: document.querySelector('#root')?.childElementCount ?? 0,
        session_context: context,
      };
    });
    if (
      evidence.ready_state !== 'complete'
      || evidence.body_text_length < 20
      || evidence.body_width < 100
      || evidence.body_height < 100
      || evidence.root_child_count < 1
      || !evidence.session_context
      || (options.label && evidence.session_context.label !== options.label)
    ) {
      return null;
    }
    return evidence;
  }, 120_000, `${options.label ?? 'Desktop'} rendered workspace`);
  const diagnostic = await waitFor(
    () => runtimeConnectedDiagnostic(options.diagnosticRoots ?? [], options.openedAfterUnixMS ?? 0),
    120_000,
    `${options.label ?? 'Desktop'} runtime protocol connection`,
  );
  workspaceReadinessEvidence.set(page, { rendered, runtime_connected: diagnostic });
  return page;
}

function workspaceEvidence(page) {
  return {
    workspace_url: page.url(),
    readiness: workspaceReadinessEvidence.get(page) ?? null,
  };
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

async function sha256File(filePath) {
  const value = await fs.readFile(filePath);
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function makeImmutableBundleSnapshot(sourceRoot, snapshotsRoot, name, provenance) {
  const snapshotRoot = path.join(snapshotsRoot, name);
  await fs.cp(sourceRoot, snapshotRoot, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true });
  const manifestPath = path.join(snapshotRoot, 'desktop-bundle-manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.schema_version !== 2) {
    throw new Error(`Desktop smoke requires bundle manifest schema 2, got ${manifest.schema_version}`);
  }
  manifest.provenance = provenance;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  for (const artifact of [manifest.gateway, ...(manifest.runtime_suite ?? [])]) {
    await fs.chmod(path.join(snapshotRoot, artifact.path), artifact.executable ? 0o500 : 0o400);
  }
  await fs.chmod(manifestPath, 0o400);
  await fs.chmod(snapshotRoot, 0o500);
  return {
    root: snapshotRoot,
    manifest_path: manifestPath,
    manifest,
    manifest_sha256: await sha256File(manifestPath),
    runtime_sha256: await sha256File(path.join(snapshotRoot, 'redeven')),
  };
}

function assertBudget(label, durationMs, budgetMs) {
  if (durationMs > budgetMs) {
    throw new Error(`${label} exceeded its ${budgetMs}ms budget: ${durationMs}ms`);
  }
}

async function gatewayLifecycleState(snapshot, gatewayID = '') {
  const gatewayStateRoot = gatewayStateRootFor(snapshot, gatewayID);
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

function gatewayStateRootFor(snapshot, gatewayID = '') {
  const source = (snapshot?.gateway_sources ?? []).find((candidate) => candidate.gateway_id === gatewayID)
    ?? snapshot?.gateway_sources?.[0];
  const serviceStateRoot = source?.service_state?.service_state_root;
  if (serviceStateRoot) return serviceStateRoot;

  // A stopped Gateway may omit its transient service descriptor from the
  // launcher snapshot. The managed Runtime root remains authoritative for
  // local smoke evidence, so derive the persisted Gateway state directory
  // from that root when it is available.
  const environment = (snapshot?.environments ?? []).find((candidate) => (
    candidate.gateway_id === gatewayID
  ));
  const runtimeRoot = environment?.managed_runtime_placement?.runtime_root;
  return runtimeRoot && gatewayID ? path.join(runtimeRoot, 'gateways', gatewayID, 'state') : '';
}

async function readRuntimeTargetBinding(snapshot, gatewayID = '') {
  const gatewayStateRoot = gatewayStateRootFor(snapshot, gatewayID);
  if (!gatewayStateRoot) throw new Error(`Gateway state root is unavailable for ${gatewayID || 'the selected Gateway'}`);
  const bindingPath = path.join(gatewayStateRoot, 'runtime-target-binding-v1.json');
  const raw = await fs.readFile(bindingPath, 'utf8');
  return { gateway_state_root: gatewayStateRoot, binding_path: bindingPath, raw, value: JSON.parse(raw) };
}

async function seedLegacyRuntimeBinding({ stateRoot, snapshot, gatewayID }) {
  const persisted = await readRuntimeTargetBinding(snapshot, gatewayID);
  if (persisted.value.schema_version !== 2 || !persisted.value.binding?.validated_runtime?.managed_suite_sha256) {
    throw new Error(`clean bootstrap did not create a schema-2 Runtime binding: ${JSON.stringify(redactDiagnosticValue(persisted.value))}`);
  }
  const runtimeRoot = path.join(stateRoot, 'local-environment');
  const managedRuntime = path.join(runtimeRoot, 'runtime', 'managed', 'bin', 'redeven');
  const previousDigest = await sha256File(managedRuntime);
  await fs.appendFile(managedRuntime, `\nREDEVEN_LEGACY_RUNTIME_SMOKE_${Date.now()}\n`);
  await fs.chmod(managedRuntime, 0o700);
  const legacyDigest = await sha256File(managedRuntime);
  if (legacyDigest === previousDigest) throw new Error('legacy Runtime fixture did not change the executable digest');
  const versionProbe = await captureCommand(managedRuntime, ['version'], { timeoutMs: 15_000 });
  if (versionProbe.exit_code !== 0) {
    throw new Error(`legacy Runtime fixture is not executable after identity change: ${versionProbe.stderr || versionProbe.stdout}`);
  }
  const statusProbe = await captureCommand(managedRuntime, ['desktop-runtime-status', '--state-root', runtimeRoot], { timeoutMs: 15_000 });
  if (statusProbe.exit_code !== 0) {
    throw new Error(`legacy Runtime fixture cannot prove its stopped inventory: ${statusProbe.stderr || statusProbe.stdout}`);
  }
  const legacy = structuredClone(persisted.value);
  legacy.schema_version = 1;
  legacy.binding.validated_runtime.artifact_sha256 = legacyDigest;
  delete legacy.binding.validated_runtime.managed_suite_sha256;
  delete legacy.binding.validated_runtime.installation_provenance;
  const legacyRaw = `${JSON.stringify(legacy, null, 2)}\n`;
  const temporaryPath = `${persisted.binding_path}.smoke-tmp`;
  await fs.writeFile(temporaryPath, legacyRaw, { mode: 0o600 });
  await fs.rename(temporaryPath, persisted.binding_path);
  const roundTrip = await fs.readFile(persisted.binding_path, 'utf8');
  if (roundTrip !== legacyRaw) throw new Error('legacy Runtime binding fixture was not written exactly');
  return {
    binding_path: persisted.binding_path,
    gateway_state_root: persisted.gateway_state_root,
    schema_version: 1,
    original_binding_sha256: `sha256:${createHash('sha256').update(persisted.raw).digest('hex')}`,
    legacy_binding_sha256: `sha256:${createHash('sha256').update(legacyRaw).digest('hex')}`,
    original_runtime_sha256: previousDigest,
    legacy_runtime_sha256: legacyDigest,
    version_probe: versionProbe.stdout.trim(),
  };
}

async function assertDevelopmentRuntimeConvergence({ stateRoot, ready, bundle, legacyFixture, output }) {
  const targetDigest = bundle.runtime_sha256;
  if (legacyFixture.legacy_runtime_sha256 === targetDigest) {
    throw new Error('legacy Runtime fixture unexpectedly matches the development target digest');
  }
  const managedRuntime = path.join(stateRoot, 'local-environment', 'runtime', 'managed', 'bin', 'redeven');
  const managedDigest = await sha256File(managedRuntime);
  if (managedDigest !== targetDigest) {
    throw new Error(`managed Runtime did not converge to the development target: got=${managedDigest} want=${targetDigest}`);
  }
  const persisted = await readRuntimeTargetBinding(ready.snapshot, ready.environment.gateway_id);
  const validation = persisted.value.binding?.validated_runtime;
  if (
    persisted.value.schema_version !== 2
    || validation?.artifact_sha256 !== targetDigest
    || validation?.managed_suite_sha256 !== bundle.manifest.runtime_suite_sha256
    || validation?.installation_provenance?.kind !== 'development_bundle'
    || validation?.installation_provenance?.bundle_commit !== bundle.manifest.commit
  ) {
    throw new Error(`development Runtime binding identity is incomplete: ${JSON.stringify(redactDiagnosticValue(persisted.value))}`);
  }
  const runtimeService = ready.environment.runtime_health.runtime_service;
  if (runtimeService?.runtime_commit !== bundle.manifest.commit) {
    throw new Error(`running Runtime commit does not match the development target: got=${runtimeService?.runtime_commit} want=${bundle.manifest.commit}`);
  }
  await waitFor(
    () => output.join('').toLowerCase().includes(targetDigest.toLowerCase()) ? true : null,
    30_000,
    'actual Runtime digest startup log',
  );
  const status = await captureCommand(managedRuntime, ['desktop-runtime-status', '--state-root', path.join(stateRoot, 'local-environment')], { timeoutMs: 15_000 });
  if (status.exit_code !== 0) {
    throw new Error(`converged managed Runtime status failed: ${status.stderr || status.stdout}`);
  }
  let parsedStatus;
  try {
    parsedStatus = JSON.parse(status.stdout);
  } catch {
    parsedStatus = { raw: status.stdout.trim() };
  }
  return {
    target_runtime_sha256: targetDigest,
    managed_runtime_sha256: managedDigest,
    running_runtime_commit: runtimeService.runtime_commit,
    running_runtime_version: runtimeService.runtime_version,
    binding_path: persisted.binding_path,
    binding_schema_version: persisted.value.schema_version,
    validated_runtime: redactDiagnosticValue(validation),
    runtime_status: redactDiagnosticValue(parsedStatus),
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

async function stopSmokeGatewayServices(runtimeRoots, bundleRoot = bundledRuntimeRoot()) {
  const bundledGateway = path.join(bundleRoot, 'redeven-gateway');
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

async function stopSmokeRuntimeProcesses(runtimeRoots, bundleRoot = bundledRuntimeRoot()) {
  const bundledRuntime = path.join(bundleRoot, 'redeven');
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
  const updateStates = update?.events?.map((event) => event.state) ?? [];
  assertOperationStates(update, [
    'preflighting', ...(updateStates.includes('awaiting_confirmation') ? ['awaiting_confirmation'] : []),
    'awaiting_artifact', 'staging',
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

async function runCleanBundleBootstrapScenario({ page, browser, launchStartedAt, output, stateRoot, bundle, diagnosticRoots }) {
  const ready = await waitForEnvironment(
    page,
    'Local Environment',
    (environment, snapshot) => environment.gateway_status === 'online'
      && environment.gateway_trust_state === 'paired'
      && environment.runtime_health.status === 'online'
      && snapshot.issue?.scope !== 'startup',
    phaseBudgets.desktop_cold_start_ms,
  );
  const durationMS = Date.now() - launchStartedAt;
  assertBudget('clean Desktop cold startup', durationMS, phaseBudgets.desktop_cold_start_ms);
  const pairing = await ensureGatewayPaired(page, 'Local Environment');
  const managedRuntime = path.join(stateRoot, 'local-environment', 'runtime', 'managed', 'bin', 'redeven');
  const managedDigest = await sha256File(managedRuntime);
  if (managedDigest !== bundle.runtime_sha256) {
    throw new Error(`clean managed Runtime digest mismatch: got=${managedDigest} want=${bundle.runtime_sha256}`);
  }
  const lifecycleBeforeOpen = await assertNormalPathHasNoArtifactWork(
    ready.snapshot,
    ready.environment.gateway_id,
    output.join(''),
  );
  const openedAfterUnixMS = Date.now();
  const direct = await openDirectly(page, 'Local Environment');
  const workspace = await waitForWorkspace(browser, {
    label: 'Local Environment', diagnosticRoots, openedAfterUnixMS,
  });
  await waitForEnvironment(page, 'Local Environment', (environment) => environment.is_open === true, phaseBudgets.direct_open_ms);
  await closeWorkspacePages(browser);
  await lifecycleActionForEnvironment(page, 'Local Environment', 'stop', 'stopped_gateway_environment_runtime');
  await waitForEnvironment(page, 'Local Environment', (environment) => (
    environment.runtime_health.status !== 'online' && !environment.is_open && !environment.is_opening
  ), phaseBudgets.lifecycle_start_ms);
  return {
    environment: ready.environment,
    snapshot: await launcherSnapshot(page),
    evidence: {
      duration_ms: durationMS,
      gateway_pairing: pairing,
      managed_runtime_sha256: managedDigest,
      lifecycle_before_open: lifecycleBeforeOpen,
      open: { ...direct, ...workspaceEvidence(workspace) },
      stopped_through_gateway: true,
    },
  };
}

async function runLocalColdStartScenario({ page, browser, launchStartedAt, output, stateRoot, bundle, legacyFixture, diagnosticRoots }) {
  const ready = await waitForEnvironment(
    page,
    'Local Environment',
    (environment, snapshot) => environment.gateway_status === 'online'
      && environment.gateway_trust_state === 'paired'
      && environment.runtime_health.status === 'online'
      && snapshot.issue?.scope !== 'startup',
    phaseBudgets.desktop_cold_start_ms,
  );
  const coldStartDurationMS = Date.now() - launchStartedAt;
  assertBudget('Desktop cold startup', coldStartDurationMS, phaseBudgets.desktop_cold_start_ms);
  const pairing = await ensureGatewayPaired(page, 'Local Environment');
  const targetConvergence = await assertDevelopmentRuntimeConvergence({
    stateRoot, ready, bundle, legacyFixture, output,
  });
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
  const workspace = await waitForWorkspace(browser, {
    label: 'Local Environment', diagnosticRoots, openedAfterUnixMS: openStartedAt,
  });
  await waitForEnvironment(page, 'Local Environment', (environment) => environment.is_open === true, phaseBudgets.direct_open_ms);
  const directOpenDurationMS = Date.now() - openStartedAt;
  assertBudget('Local Environment direct open', directOpenDurationMS, phaseBudgets.direct_open_ms);
  await closeWorkspacePages(browser);
  await lifecycleActionForEnvironment(page, 'Local Environment', 'stop', 'stopped_gateway_environment_runtime');
  await waitForEnvironment(page, 'Local Environment', (environment) => (
    environment.runtime_health.status !== 'online' && !environment.is_open && !environment.is_opening
  ), phaseBudgets.lifecycle_start_ms);
  const pendingStart = await prepareLifecycleAction(page, 'Local Environment', 'start');
  if (pendingStart.prepared?.ok === true) {
    await waitForEnvironment(
      page,
      'Local Environment',
      (environment) => environment.runtime_health.status === 'online',
      phaseBudgets.lifecycle_start_ms,
    );
  }
  const pendingSnapshot = await launcherSnapshot(page);
  const pendingState = await gatewayLifecycleState(pendingSnapshot, ready.environment.gateway_id);
  const pendingOperation = latestOperationEvidence(pendingState, 'start');
  const pendingConfirmation = pendingStart.prepared?.code === 'confirmation_required';
  if (pendingConfirmation && (!pendingOperation || pendingOperation.state !== 'awaiting_confirmation')) {
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
      direct_open: { ...direct, ...workspaceEvidence(workspace) },
      lifecycle_before_open: lifecycleBeforeOpen,
      development_target_convergence: targetConvergence,
      pending_start_before_restart: pendingConfirmation ? pendingOperation : null,
      start_without_confirmation: pendingConfirmation ? null : {
        operation: pendingOperation,
        confirmation_count: 0,
      },
    },
  };
}

async function continueLocalScenarioAfterRestart({ page, browser, local, reportRoot, diagnosticRoots }) {
  const confirmed = local.scenario.pending_start_before_restart
    ? await page.evaluate(async (operationKey) => window.redevenDesktopLauncher.performAction({
      kind: 'confirm_runtime_operation',
      operation_key: operationKey,
    }), local.pendingStart.operationKey)
    : {
      ok: true,
      outcome: 'started_gateway_environment_runtime',
      confirmation_count: 0,
      direct_execution: true,
    };
  if (confirmed?.ok !== true || confirmed.outcome !== 'started_gateway_environment_runtime') {
    throw new Error(`persisted start operation did not resume after Desktop restart: ${JSON.stringify(confirmed)}`);
  }
  await waitForEnvironment(page, 'Local Environment', (environment) => environment.runtime_health.status === 'online', phaseBudgets.lifecycle_start_ms);
  const recoveredOpenedAt = Date.now();
  const recoveredOpen = await openDirectly(page, 'Local Environment');
  const recoveredWorkspace = await waitForWorkspace(browser, {
    label: 'Local Environment', diagnosticRoots, openedAfterUnixMS: recoveredOpenedAt,
  });
  await waitForEnvironment(page, 'Local Environment', (environment) => environment.is_open === true, phaseBudgets.direct_open_ms);
  await closeWorkspacePages(browser);

  await lifecycleActionForEnvironment(page, 'Local Environment', 'stop', 'stopped_gateway_environment_runtime');
  await waitForEnvironment(page, 'Local Environment', (environment) => (
    environment.runtime_health.status !== 'online' && !environment.is_open && !environment.is_opening
  ), phaseBudgets.lifecycle_start_ms);
  const startedOpenedAt = Date.now();
  const start = await openThroughGuidance(page, 'Local Environment', /Start and open|Initialize and open|启动并打开|初始化并打开/u);
  const startedWorkspace = await waitForWorkspace(browser, {
    label: 'Local Environment', diagnosticRoots, openedAfterUnixMS: startedOpenedAt,
  });
  await waitForEnvironment(page, 'Local Environment', (environment) => environment.runtime_health.status === 'online' && environment.is_open === true, phaseBudgets.lifecycle_start_ms);
  await closeWorkspacePages(browser);

  await lifecycleActionForEnvironment(page, 'Local Environment', 'restart', 'restarted_gateway_environment_runtime');
  const restarted = await waitForEnvironment(page, 'Local Environment', (environment) => environment.runtime_health.status === 'online', phaseBudgets.lifecycle_start_ms);
  const coldUpdate = await runExplicitUpdate(page, 'Local Environment', restarted.snapshot, local.environment.gateway_id);
  const warmUpdate = await runExplicitUpdate(page, 'Local Environment', restarted.snapshot, local.environment.gateway_id);
  const updatedOpenedAt = Date.now();
  const direct = await openDirectly(page, 'Local Environment');
  const workspace = await waitForWorkspace(browser, {
    label: 'Local Environment', diagnosticRoots, openedAfterUnixMS: updatedOpenedAt,
  });
  await page.screenshot({ path: path.join(reportRoot, 'desktop-lifecycle-local.png'), fullPage: true });
  return {
    ...local.scenario,
    recovered_start: { confirmation: confirmed, ...recoveredOpen, ...workspaceEvidence(recoveredWorkspace) },
    start_and_open: { ...start, ...workspaceEvidence(startedWorkspace) },
    restart: { outcome: 'restarted_gateway_environment_runtime' },
    source_build_cache: { cold: coldUpdate, warm: warmUpdate },
    open_after_update: { ...direct, ...workspaceEvidence(workspace) },
  };
}

async function runSSHScenario({ page, browser, reportRoot, diagnosticRoots }) {
  const initial = await waitForEnvironment(page, 'SSH Remote Environment', (environment) => Boolean(environment.gateway_id), phaseBudgets.lifecycle_start_ms);
  const pairing = await ensureGatewayPaired(page, 'SSH Remote Environment');
  const initialUpdate = await runExplicitUpdate(page, 'SSH Remote Environment', initial.snapshot, initial.environment.gateway_id);
  const directOpenedAt = Date.now();
  const direct = await openDirectly(page, 'SSH Remote Environment');
  const workspace = await waitForWorkspace(browser, {
    label: 'SSH Remote Environment', diagnosticRoots, openedAfterUnixMS: directOpenedAt,
  });
  await waitForEnvironment(page, 'SSH Remote Environment', (environment) => environment.is_open === true, phaseBudgets.direct_open_ms);
  await closeWorkspacePages(browser);
  await lifecycleActionForEnvironment(page, 'SSH Remote Environment', 'stop', 'stopped_gateway_environment_runtime');
  await waitForEnvironment(page, 'SSH Remote Environment', (environment) => (
    environment.runtime_health.status !== 'online' && !environment.is_open && !environment.is_opening
  ), phaseBudgets.lifecycle_start_ms);
  const startedOpenedAt = Date.now();
  const start = await openThroughGuidance(page, 'SSH Remote Environment', /Start and open|Initialize and open|启动并打开|初始化并打开/u);
  const startedWorkspace = await waitForWorkspace(browser, {
    label: 'SSH Remote Environment', diagnosticRoots, openedAfterUnixMS: startedOpenedAt,
  });
  await waitForEnvironment(page, 'SSH Remote Environment', (environment) => environment.runtime_health.status === 'online' && environment.is_open === true, phaseBudgets.lifecycle_start_ms);
  await closeWorkspacePages(browser);
  await lifecycleActionForEnvironment(page, 'SSH Remote Environment', 'restart', 'restarted_gateway_environment_runtime');
  const restarted = await waitForEnvironment(page, 'SSH Remote Environment', (environment) => environment.runtime_health.status === 'online', phaseBudgets.lifecycle_start_ms);
  const update = await runExplicitUpdate(page, 'SSH Remote Environment', restarted.snapshot, initial.environment.gateway_id);
  const reopenedAt = Date.now();
  const reopened = await openDirectly(page, 'SSH Remote Environment');
  const reopenedWorkspace = await waitForWorkspace(browser, {
    label: 'SSH Remote Environment', diagnosticRoots, openedAfterUnixMS: reopenedAt,
  });
  await page.screenshot({ path: path.join(reportRoot, 'desktop-lifecycle-ssh-remote.png'), fullPage: true });
  return {
    label: 'SSH Remote Environment',
    gateway_pairing: pairing,
    initial_explicit_update: initialUpdate,
    open: { ...direct, ...workspaceEvidence(workspace) },
    start_and_open: { ...start, ...workspaceEvidence(startedWorkspace) },
    restart: { outcome: 'restarted_gateway_environment_runtime' },
    update,
    open_after_update: { ...reopened, ...workspaceEvidence(reopenedWorkspace) },
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
  const snapshotsRoot = path.join(tempRoot, 'bundle-snapshots');
  await Promise.all([stateRoot, userDataRoot, cacheRoot, desktopTempRoot, reportRoot, snapshotsRoot].map((directory) => fs.mkdir(directory, { recursive: true })));

  const sourceBundleRoot = bundledRuntimeRoot();
  const sourceBundleManifestPath = path.join(sourceBundleRoot, 'desktop-bundle-manifest.json');
  await fs.readFile(sourceBundleManifestPath, 'utf8').catch((error) => {
    throw new Error(`Desktop smoke requires a prebuilt bundle at ${sourceBundleManifestPath}: ${error}`);
  });
  const packagedBundle = await makeImmutableBundleSnapshot(sourceBundleRoot, snapshotsRoot, 'packaged', 'packaged_bundle');
  const developmentBundle = await makeImmutableBundleSnapshot(sourceBundleRoot, snapshotsRoot, 'development', 'development_bundle');
  const bundleManifest = packagedBundle.manifest;
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
  const launchDesktop = (bundle) => {
    const launchedAt = Date.now();
    const launched = spawn(path.join(rootDir, 'desktop', 'node_modules', '.bin', 'electron'), [
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${cdpPort}`,
      `--inspect=127.0.0.1:${inspectorPort}`,
      '.',
    ], {
      cwd: path.join(rootDir, 'desktop'),
      detached: true,
      env: { ...desktopEnvironment, REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: bundle.root },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    launched.stdout.on('data', (chunk) => output.push(chunk.toString()));
    launched.stderr.on('data', (chunk) => output.push(chunk.toString()));
    return { child: launched, launchedAt, bundle };
  };
  let launch = launchDesktop(packagedBundle);
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
      source_manifest_path: sourceBundleManifestPath,
      version: bundleManifest.version,
      commit: bundleManifest.commit,
      platform: bundleManifest.platform,
      architecture: bundleManifest.architecture,
      gateway_sha256: bundleManifest.gateway.sha256,
      runtime_sha256: packagedBundle.runtime_sha256,
      snapshots: {
        packaged: redactDiagnosticValue(packagedBundle),
        development: redactDiagnosticValue(developmentBundle),
      },
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

    const diagnosticRoots = [stateRoot, userDataRoot];
    let page = await connectDesktop(phaseBudgets.desktop_cold_start_ms);
    const cleanBootstrap = await runCleanBundleBootstrapScenario({
      page,
      browser,
      launchStartedAt: launch.launchedAt,
      output,
      stateRoot,
      bundle: packagedBundle,
      diagnosticRoots,
    });
    evidence.startups.push({ kind: 'clean_packaged_bundle', duration_ms: cleanBootstrap.evidence.duration_ms });
    evidence.scenarios.clean_local = cleanBootstrap.evidence;
    await browser.close();
    browser = undefined;
    await stopProcessGroup(child, output);
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null);
      return response ? null : true;
    }, 15_000, 'clean Desktop CDP shutdown');
    await stopSmokeGatewayServices([path.join(stateRoot, 'local-environment')], packagedBundle.root);
    const legacyFixture = await seedLegacyRuntimeBinding({
      stateRoot,
      snapshot: cleanBootstrap.snapshot,
      gatewayID: cleanBootstrap.environment.gateway_id,
    });
    evidence.legacy_v1_fixture = legacyFixture;

    launch = launchDesktop(developmentBundle);
    child = launch.child;
    evidence.electron_pid_after_legacy_fixture = child.pid;
    page = await connectDesktop(phaseBudgets.desktop_cold_start_ms);
    const local = await runLocalColdStartScenario({
      page,
      browser,
      launchStartedAt: launch.launchedAt,
      output,
      stateRoot,
      bundle: developmentBundle,
      legacyFixture,
      diagnosticRoots,
    });
    evidence.startups.push({ kind: 'legacy_v1_development_convergence', duration_ms: local.scenario.cold_start_duration_ms });
    evidence.scenarios.local = local.scenario;
    await browser.close();
    browser = undefined;
    await stopProcessGroup(child, output);
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null);
      return response ? null : true;
    }, 15_000, 'Desktop CDP shutdown');
    launch = launchDesktop(developmentBundle);
    child = launch.child;
    evidence.electron_pid_after_pending_restart = child.pid;
    page = await connectDesktop(phaseBudgets.desktop_warm_start_ms);
    await ensureGatewayPaired(page, 'Local Environment');
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
    if (
      local.scenario.pending_start_before_restart
      && (!recoveredStart
        || recoveredStart.operation_id !== local.scenario.pending_start_before_restart.operation_id
        || recoveredStart.state !== 'awaiting_confirmation')
    ) {
      throw new Error(`Desktop/Gateway did not recover the exact pending start operation: ${JSON.stringify(recoveredStart)}`);
    }
    const recoveredAttachment = local.scenario.pending_start_before_restart
      ? await waitFor(async () => {
        const snapshot = await launcherSnapshot(page);
        return snapshot.operations.find((operation) => (
          operation.operation_key === local.pendingStart.operationKey
          && operation.status === 'needs_confirmation'
          && operation.runtime_confirmation?.operation === 'start'
        )) ?? null;
      }, phaseBudgets.desktop_warm_start_ms, 'Desktop pending Runtime operation attachment')
      : null;
    evidence.scenarios.local = await continueLocalScenarioAfterRestart({ page, browser, local, reportRoot, diagnosticRoots });
    evidence.scenarios.local.pending_start_after_restart = recoveredStart;
    evidence.scenarios.local.pending_start_attachment_after_restart = recoveredAttachment;
    evidence.scenarios.ssh_remote = await runSSHScenario({ page, browser, reportRoot, diagnosticRoots });
    evidence.scenarios.container_failures = await runContainerFailureScenarios(page, sshTarget);

    const bindingBeforePackagedRestart = await readRuntimeTargetBinding(
      await launcherSnapshot(page),
      local.environment.gateway_id,
    );
    const provenanceBeforePackagedRestart = bindingBeforePackagedRestart.value.binding?.validated_runtime?.installation_provenance;
    if (provenanceBeforePackagedRestart?.kind !== 'verified_lifecycle_update') {
      throw new Error(`explicit update did not persist verified lifecycle provenance: ${JSON.stringify(redactDiagnosticValue(bindingBeforePackagedRestart.value))}`);
    }

    await closeWorkspacePages(browser);
    await browser.close();
    browser = undefined;
    await stopProcessGroup(child, output);
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null);
      return response ? null : true;
    }, 15_000, 'Desktop CDP shutdown after updates');
    await stopSmokeGatewayServices([path.join(stateRoot, 'local-environment')], developmentBundle.root);
    launch = launchDesktop(packagedBundle);
    child = launch.child;
    page = await connectDesktop(phaseBudgets.desktop_warm_start_ms);
    await ensureGatewayPaired(page, 'Local Environment');
    const readyAfterUpdateRestart = await waitForEnvironment(
      page,
      'Local Environment',
      (environment) => environment.gateway_status === 'online' && environment.runtime_health.status === 'online',
      phaseBudgets.desktop_warm_start_ms,
    );
    const updateRecoveryDurationMS = Date.now() - launch.launchedAt;
    assertBudget('Desktop verified-update recovery', updateRecoveryDurationMS, phaseBudgets.desktop_warm_start_ms);
    evidence.startups.push({ kind: 'verified_update_recovery', duration_ms: updateRecoveryDurationMS });
    const bindingAfterPackagedRestart = await readRuntimeTargetBinding(
      readyAfterUpdateRestart.snapshot,
      local.environment.gateway_id,
    );
    const provenanceAfterPackagedRestart = bindingAfterPackagedRestart.value.binding?.validated_runtime?.installation_provenance;
    if (JSON.stringify(provenanceAfterPackagedRestart) !== JSON.stringify(provenanceBeforePackagedRestart)) {
      throw new Error(`packaged restart changed verified update provenance: before=${JSON.stringify(provenanceBeforePackagedRestart)} after=${JSON.stringify(provenanceAfterPackagedRestart)}`);
    }
    evidence.scenarios.local.packaged_restart_preserved_update = {
      before: provenanceBeforePackagedRestart,
      after: provenanceAfterPackagedRestart,
      binding_path: bindingAfterPackagedRestart.binding_path,
    };
    const reopenedAfterRestartAt = Date.now();
    const openAfterDesktopRestart = await openDirectly(page, 'Local Environment');
    const workspaceAfterDesktopRestart = await waitForWorkspace(browser, {
      label: 'Local Environment', diagnosticRoots, openedAfterUnixMS: reopenedAfterRestartAt,
    });
    evidence.scenarios.local.desktop_restart_after_update = {
      duration_ms: updateRecoveryDurationMS,
      runtime_version: readyAfterUpdateRestart.environment.runtime_health.runtime_service?.runtime_version,
      ...openAfterDesktopRestart,
      ...workspaceEvidence(workspaceAfterDesktopRestart),
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
    ], packagedBundle.root).catch((error) => {
      failure ??= error;
    });
    await stopSmokeGatewayServices([
      path.join(stateRoot, 'local-environment'),
      sshTarget.runtimeRoot,
    ], packagedBundle.root).catch((error) => {
      failure ??= error;
    });
    await sshTarget.stop().catch((error) => {
      failure ??= error;
    });
    if (!failure || process.env.REDEVEN_KEEP_FAILED_SMOKE_STATE !== '1') {
      await Promise.all([
        fs.chmod(packagedBundle.root, 0o700).catch(() => undefined),
        fs.chmod(developmentBundle.root, 0o700).catch(() => undefined),
      ]);
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
  if (failure) throw failure;
}

await run();
