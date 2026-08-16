import { constants as fsConstants, existsSync, realpathSync } from 'node:fs';
import {
  access, chmod, mkdir, readFile, readdir, rm, stat, writeFile,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const SMOKE_ROOT = '/tmp/redeven-flower-smoke-01a00852';
export const SMOKE_WORKSPACE = `${SMOKE_ROOT}/workspace`;
export const SMOKE_MODEL = 'deepseek-v4-flash';
export const SMOKE_PORTS = Object.freeze({ localUI: 43924, cdp: 43925, inspector: 43926 });

export function assertSmokeConfiguration(config) {
  const expected = {
    root: SMOKE_ROOT,
    workspace: SMOKE_WORKSPACE,
    model: SMOKE_MODEL,
    localUIPort: SMOKE_PORTS.localUI,
    cdpPort: SMOKE_PORTS.cdp,
    inspectorPort: SMOKE_PORTS.inspector,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (config?.[field] !== value) {
      throw new Error(`Flower smoke ${field} is locked to ${String(value)}`);
    }
  }
  return config;
}

export async function dragQueuedTurnAfter(page, source, target) {
  const targetBounds = await target.boundingBox();
  if (!targetBounds) throw new Error('queue reorder target has no geometry');
  const clientY = targetBounds.y + Math.max(targetBounds.height / 2 + 1, targetBounds.height - 2);
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  try {
    await source.dispatchEvent('dragstart', { dataTransfer });
    if (await source.getAttribute('data-flower-queued-turn-dragging') !== 'true') {
      throw new Error('queue reorder dragstart did not enter the dragging state');
    }
    await target.dispatchEvent('dragover', { dataTransfer, clientY });
    await target.dispatchEvent('drop', { dataTransfer, clientY });
  } finally {
    await dataTransfer.dispose();
  }
}

export function isExpectedQueueOrderResponse(response, threadID, expectedQueueIDs) {
  if (response.request().method() !== 'PATCH') return false;
  const pathname = new URL(response.url()).pathname;
  if (!pathname.endsWith(`/threads/${threadID}/queue/order`)) return false;
  const orderedQueueIDs = response.request().postDataJSON()?.ordered_queue_ids ?? [];
  return JSON.stringify(orderedQueueIDs) === JSON.stringify(expectedQueueIDs);
}

function aiConfig(value) {
  return value?.ai && typeof value.ai === 'object' ? value.ai : value;
}

export function findDeepSeekProvider(config, secrets) {
  const ai = aiConfig(config) ?? {};
  const secretAI = aiConfig(secrets) ?? {};
  const providers = Array.isArray(ai.providers) ? ai.providers : [];
  const candidates = providers.filter((provider) => String(provider?.type ?? '').trim().toLowerCase() === 'deepseek');
  if (candidates.length !== 1) {
    throw new Error(`exactly one DeepSeek provider is required; found ${candidates.length}`);
  }
  const provider = candidates[0];
  const providerID = String(provider?.id ?? '').trim();
  if (!providerID) throw new Error('DeepSeek provider ID is missing');
  const models = Array.isArray(provider.models) ? provider.models : [];
  if (!models.some((model) => String(model?.model_name ?? '').trim() === SMOKE_MODEL)) {
    throw new Error(`DeepSeek provider does not configure locked model ${SMOKE_MODEL}`);
  }
  const apiKey = String(secretAI?.provider_api_keys?.[providerID] ?? '');
  if (!apiKey) throw new Error('DeepSeek provider API key is missing');
  return { provider: structuredClone(provider), apiKey, currentModelID: `${providerID}/${SMOKE_MODEL}` };
}

function listenProbe(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => reject(new Error(`port ${port} is already in use: ${error.code ?? 'listen error'}`)));
    server.listen(port, host, () => server.close(resolve));
  });
}

export async function assertPortsFree(ports, host = '127.0.0.1') {
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid smoke port ${port}`);
    await listenProbe(port, host);
  }
}

function canonicalPath(candidate) {
  let cursor = path.resolve(String(candidate ?? ''));
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.join(realpathSync.native(cursor), ...suffix);
}

export function ownedManifestPIDs(manifest, observed) {
  const allowed = new Set((manifest?.pids ?? []).filter(Number.isInteger));
  const rawWorktree = path.resolve(String(manifest?.worktree ?? ''));
  const rawStateRoot = path.resolve(String(manifest?.stateRoot ?? ''));
  const worktree = canonicalPath(rawWorktree);
  const stateRoot = canonicalPath(rawStateRoot);
  const smokeRoot = path.dirname(stateRoot);
  const expectedSmokeRoot = canonicalPath(SMOKE_ROOT);
  if (!worktree || worktree === '/' || !stateRoot.startsWith(`${expectedSmokeRoot}/`)) return [];
  return observed.filter((entry) => {
    if (!allowed.has(entry?.pid)) return false;
    const cwd = canonicalPath(String(entry?.cwd ?? '/'));
    const command = String(entry?.command ?? '');
    const worktreeMatch = cwd === worktree || cwd.startsWith(`${worktree}${path.sep}`);
    const commandWorktreeMatch = command.includes(rawWorktree) || command.includes(worktree);
    const commandStateMatch = command.includes(rawStateRoot) || command.includes(stateRoot)
      || command.includes(path.dirname(rawStateRoot)) || command.includes(smokeRoot);
    return worktreeMatch && commandWorktreeMatch && commandStateMatch;
  }).map((entry) => entry.pid).sort((left, right) => left - right);
}

async function walkFiles(root, output) {
  let rootStat;
  try {
    rootStat = await stat(root);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (rootStat.isFile()) {
    output.push(root);
    return;
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) await walkFiles(target, output);
    else if (entry.isFile()) output.push(target);
  }
}

export async function scanSecretLeaks(roots, secret) {
  if (!secret) throw new Error('secret leak scan requires a non-empty secret');
  const files = [];
  for (const root of roots) await walkFiles(root, files);
  const needle = Buffer.from(secret);
  const leaks = [];
  for (const file of files) {
    const content = await readFile(file);
    if (content.includes(needle)) leaks.push(file);
  }
  return leaks.sort();
}

function commandOutput(command, args, options = {}) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', ...options });
  } catch (error) {
    if (options.allowFailure) return '';
    throw error;
  }
}

function observedManifestProcesses(manifest) {
  return (manifest?.pids ?? []).filter(Number.isInteger).map((pid) => {
    const command = commandOutput('ps', ['eww', '-p', String(pid), '-o', 'command='], { allowFailure: true }).trim();
    const cwdLines = commandOutput('lsof', ['-nP', '-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { allowFailure: true });
    const cwd = cwdLines.split('\n').find((line) => line.startsWith('n'))?.slice(1) ?? '';
    return { pid, command, cwd };
  });
}

async function scanWorktreeDiffForSecret(worktree, secret) {
  const needle = Buffer.from(secret);
  const diff = execFileSync('git', ['diff', '--no-ext-diff', '--binary', 'HEAD'], { cwd: worktree });
  const leaks = [];
  if (diff.includes(needle)) leaks.push(`${worktree}:git-diff`);
  const untracked = commandOutput('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: worktree })
    .split('\0').filter(Boolean);
  for (const relative of untracked) {
    const file = path.join(worktree, relative);
    const fileStat = await stat(file).catch(() => null);
    if (fileStat?.isFile() && (await readFile(file)).includes(needle)) leaks.push(file);
  }
  return leaks;
}

async function sourceDeepSeekSecret(sourceRoot) {
  const sourceConfig = JSON.parse(await readFile(path.join(sourceRoot, 'config.json'), 'utf8'));
  const sourceSecrets = JSON.parse(await readFile(path.join(sourceRoot, 'secrets.json'), 'utf8'));
  return findDeepSeekProvider(sourceConfig, sourceSecrets).apiKey;
}

async function removeSensitiveFiles(root) {
  await Promise.all([
    rm(path.join(root, 'config.json'), { force: true }),
    rm(path.join(root, 'secrets.json'), { force: true }),
  ]);
}

export async function withSensitiveState(root, payload, operation) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const configFile = path.join(root, 'config.json');
  const secretsFile = path.join(root, 'secrets.json');
  await writeFile(configFile, `${JSON.stringify(payload.config, null, 2)}\n`, { mode: 0o600 });
  await writeFile(secretsFile, `${JSON.stringify(payload.secrets, null, 2)}\n`, { mode: 0o600 });
  await chmod(configFile, 0o600);
  await chmod(secretsFile, 0o600);
  try {
    return await operation({ configFile, secretsFile });
  } finally {
    await removeSensitiveFiles(root);
  }
}

export async function prepareIsolatedProviderState(sourceRoot, runtimeStateRoot, metadataFile) {
  const sourceConfigFile = path.join(sourceRoot, 'config.json');
  const sourceSecretsFile = path.join(sourceRoot, 'secrets.json');
  await access(sourceConfigFile, fsConstants.R_OK);
  await access(sourceSecretsFile, fsConstants.R_OK);
  const sourceConfig = JSON.parse(await readFile(sourceConfigFile, 'utf8'));
  const sourceSecrets = JSON.parse(await readFile(sourceSecretsFile, 'utf8'));
  const selected = findDeepSeekProvider(sourceConfig, sourceSecrets);
  const targetConfig = structuredClone(sourceConfig);
  targetConfig.agent_home_dir = SMOKE_WORKSPACE;
  targetConfig.ai = {
    ...(targetConfig.ai ?? {}),
    providers: [selected.provider],
    current_model_id: selected.currentModelID,
  };
  const targetSecrets = {
    schema_version: sourceSecrets.schema_version ?? 1,
    ai: { provider_api_keys: { [selected.provider.id]: selected.apiKey } },
    web_search: {},
  };
  await mkdir(runtimeStateRoot, { recursive: true, mode: 0o700 });
  const configFile = path.join(runtimeStateRoot, 'config.json');
  const secretsFile = path.join(runtimeStateRoot, 'secrets.json');
  await writeFile(configFile, `${JSON.stringify(targetConfig, null, 2)}\n`, { mode: 0o600 });
  await writeFile(secretsFile, `${JSON.stringify(targetSecrets, null, 2)}\n`, { mode: 0o600 });
  await chmod(configFile, 0o600);
  await chmod(secretsFile, 0o600);
  await writeFile(metadataFile, `${JSON.stringify({
    schema_version: 1,
    model: SMOKE_MODEL,
    provider: { configured: true },
  }, null, 2)}\n`, { mode: 0o600 });
  return { apiKey: selected.apiKey, currentModelID: selected.currentModelID };
}

export async function removeIsolatedProviderState(runtimeStateRoot) {
  await removeSensitiveFiles(runtimeStateRoot);
}

const require = createRequire(import.meta.url);

async function waitFor(check, timeoutMS, label, intervalMS = 100) {
  const deadline = Date.now() + timeoutMS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMS));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

function browserPages(browser) {
  return browser.contexts().flatMap((context) => context.pages());
}

function isEnvPage(page) {
  try {
    return new URL(page.url()).pathname.startsWith('/_redeven_proxy/env/');
  } catch {
    return false;
  }
}

async function ensureFlowerSurface(page) {
  const surface = flowerSurface(page);
  if (await surface.isVisible().catch(() => false)) return;
  const activityMode = page.getByRole('tab', { name: /^Activity$/u });
  await activityMode.waitFor({ state: 'visible', timeout: 60_000 });
  if (await activityMode.getAttribute('aria-selected') !== 'true') {
    await activityMode.click();
  }
  const entry = page.getByRole('button', { name: 'Flower', exact: true });
  await entry.waitFor({ state: 'visible', timeout: 60_000 });
  await entry.click();
  await surface.waitFor({ state: 'visible', timeout: 60_000 });
}

function flowerSurface(page) {
  return page.locator('[data-activity-flower-full-page-host] #redeven-flower-surface');
}

async function acquireEnvPage(browser, reconnect, reportRoot) {
  const initial = await waitFor(
    () => browserPages(browser).find((page) => !page.url().startsWith('devtools://') && page.url() !== 'about:blank'),
    60_000,
    'Desktop page',
  );
  let page = browserPages(browser).find(isEnvPage);
  if (!page) {
    const open = initial.getByRole('button', { name: /^(?:Open|打开)$/u }).last();
    await open.waitFor({ state: 'visible', timeout: 60_000 });
    await open.click();
    browser = await reconnect();
    page = await waitFor(() => browserPages(browser).find(isEnvPage), 90_000, 'Env App page');
  }
  await page.bringToFront();
  try {
    await ensureFlowerSurface(page);
  } catch (error) {
    await page.screenshot({ path: path.join(reportRoot, 'navigation-failure.png') }).catch(() => {});
    throw error;
  }
  await page.screenshot({ path: path.join(reportRoot, 'startup.png') });
  return { browser, page };
}

function marker(label) {
  return `FLOWER_SMOKE_${label}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

async function selectedThreadID(page) {
  return String(await flowerSurface(page).getAttribute('data-flower-selected-thread-id') ?? '').trim();
}

async function selectedStatus(page) {
  return String(await flowerSurface(page).getAttribute('data-flower-selected-thread-status') ?? '').trim();
}

async function canonicalThread(page, threadID) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(id)}`, { credentials: 'include' });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    return { status: response.status, body };
  }, threadID);
}

export function canonicalEvidence(response) {
  const body = response?.body ?? {};
  const root = body.data ?? body;
  const current = root.current ?? root;
  const thread = root.thread ?? current.thread ?? {};
  const items = Array.isArray(current.items) ? current.items : [];
  return {
    http_status: response?.status,
    thread_id: current.thread_id ?? thread.thread_id ?? '',
    run_id: thread.active_run_id ?? current.active_run_id ?? current.run_id ?? '',
    turn_id: current.active_turn_id ?? current.turn_id ?? '',
    status: thread.run_status ?? current.status ?? thread.status ?? '',
    activity: current.activity ?? '',
    item_ids: items.map((item) => item?.id ?? item?.item_id).filter(Boolean),
    message_ids: items.filter((item) => item?.kind === 'user' || item?.kind === 'assistant').map((item) => item?.id).filter(Boolean),
    interaction_ids: (current.interactions ?? []).map((item) => item?.id).filter(Boolean),
    error_code: thread.run_error_code ?? current.error?.code ?? thread.error?.code ?? '',
  };
}

export function assertAcceptedReceipt(status, body) {
  const accepted = Number.isInteger(status) && status >= 200 && status < 300 && body?.ok !== false;
  if (accepted) return body?.data ?? body ?? {};
  const errorCode = String(body?.error_code ?? '').trim();
  const error = String(body?.error ?? 'unknown error').trim().slice(0, 1000);
  throw new Error(`Flower send rejected: status=${status}${errorCode ? ` code=${errorCode}` : ''} error=${error}`);
}

async function setPermission(page, permission) {
  const surface = flowerSurface(page);
  const trigger = surface.locator('.flower-permission-trigger').filter({ visible: true }).first();
  await trigger.waitFor({ state: 'visible', timeout: 20_000 });
  if (await trigger.getAttribute('data-permission-type') === permission) return;
  await trigger.click();
  const option = surface.locator(`#flower-composer-permission-${permission}`);
  await option.waitFor({ state: 'visible', timeout: 10_000 });
  await option.click();
  await waitFor(async () => await trigger.getAttribute('data-permission-type') === permission, 15_000, `permission ${permission}`);
}

async function startNewThread(page) {
  const surface = flowerSurface(page);
  await surface.locator('.flower-new-chat-button').click();
  await waitFor(async () => await selectedThreadID(page) === '', 20_000, 'new thread selection');
  const textarea = surface.locator('.flower-composer textarea');
  await textarea.waitFor({ state: 'visible', timeout: 20_000 });
  await surface.locator('[data-flower-primary-action="send"]').waitFor({ state: 'visible', timeout: 20_000 });
  await waitFor(async () => (
    await selectedThreadID(page) === ''
    && await surface.getAttribute('data-flower-warmup') !== 'true'
    && await surface.getAttribute('data-flower-selected-thread-loading') !== 'true'
    && await textarea.isEnabled()
    && await surface.locator('.flower-handler-error-card').count() === 0
  ), 20_000, 'new thread composer readiness');
}

async function sendPrompt(page, prompt, options = {}) {
  const surface = flowerSurface(page);
  const textarea = surface.locator('.flower-composer textarea');
  await textarea.waitFor({ state: 'visible', timeout: 20_000 });
  await textarea.fill(prompt);
  const action = surface.locator('[data-flower-primary-action="send"]');
  await action.waitFor({ state: 'visible', timeout: 20_000 });
  const receiptResponse = page.waitForResponse((response) => {
    if (response.request().method() !== 'POST') return false;
    try {
      const pathname = new URL(response.url()).pathname;
      if (!(pathname.endsWith('/api/ai/turns') || /\/api\/ai\/threads\/[^/]+\/turns$/u.test(pathname))) return false;
      const body = response.request().postDataJSON?.();
      return body?.input?.text === prompt;
    } catch {
      return false;
    }
  }, { timeout: 20_000 });
  const clickedAt = performance.now();
  await action.click();
  const response = await receiptResponse;
  const receiptBody = await response.json();
  const receipt = assertAcceptedReceipt(response.status(), receiptBody);
  const receiptThreadID = String(receipt.thread_id ?? '').trim();
  const user = surface.locator('[data-flower-message-role="user"]').filter({ hasText: options.visibleMarker ?? prompt.slice(0, 40) });
  if (receiptThreadID) {
    await waitFor(async () => await threadCard(page, receiptThreadID).then(() => true).catch(() => false), 20_000, 'receipt thread rail card');
    await waitFor(async () => {
      const response = await canonicalThread(page, receiptThreadID);
      return JSON.stringify(response.body ?? '').includes(options.visibleMarker ?? prompt.slice(0, 40));
    }, 20_000, 'receipt canonical user item');
    if (!await user.isVisible().catch(() => false)) await selectThread(page, receiptThreadID);
  }
  await user.waitFor({ state: 'visible', timeout: 20_000 });
  const userVisibleMS = performance.now() - clickedAt;
  const threadID = await waitFor(() => selectedThreadID(page), 20_000, 'selected thread identity');
  const runningMS = await waitFor(async () => {
    const status = await selectedStatus(page);
    return ['running', 'waiting_approval', 'waiting_user', 'success', 'failed', 'canceled'].includes(status)
      ? performance.now() - clickedAt : 0;
  }, 20_000, 'running status');
  const startedCanonical = canonicalEvidence(await canonicalThread(page, threadID));
  const runID = String(receipt.run_id ?? startedCanonical.run_id ?? '').trim();
  const turnID = String(receipt.turn_id ?? startedCanonical.turn_id ?? '').trim();
  if (!runID || !turnID) throw new Error('Flower send receipt omitted canonical run or turn identity');
  return { clickedAt, userVisibleMS, runningMS, threadID, runID, turnID };
}

async function queuePrompt(page, prompt, visibleMarker) {
  const surface = flowerSurface(page);
  const textarea = surface.locator('.flower-composer textarea');
  await textarea.fill(prompt);
  await surface.locator('[data-flower-primary-action="send"]').click();
  const queued = surface.locator('[data-flower-queued-turn-dock-id]').filter({ hasText: visibleMarker });
  await queued.waitFor({ state: 'visible', timeout: 20_000 });
  if (await surface.locator('[data-flower-message-role="user"]').filter({ hasText: visibleMarker }).count() !== 0) {
    throw new Error(`queued prompt ${visibleMarker} flashed into the timeline`);
  }
  return queued;
}

async function waitForThreadTerminal(page, threadID, timeoutMS = 180_000, options = {}) {
  const expectedSelectedThreadID = options.expectedSelectedThreadID ?? threadID;
  const terminal = await waitFor(async () => {
    const selected = await selectedThreadID(page);
    if (selected !== expectedSelectedThreadID) return { selectionDrift: selected };
    const canonical = canonicalEvidence(await canonicalThread(page, threadID));
    const status = canonical.status;
    if (!['success', 'failed', 'canceled'].includes(status)) return '';
    if (options.turnID && canonical.turn_id !== options.turnID) return '';
    if (options.afterTurnID && (!canonical.turn_id || canonical.turn_id === options.afterTurnID)) return '';
    return { status, canonical };
  }, timeoutMS, `thread ${threadID} terminal status`, 200);
  if ('selectionDrift' in terminal) {
    throw new Error(`thread selection drifted from ${expectedSelectedThreadID} to ${terminal.selectionDrift || '<none>'}`);
  }
  if (terminal.status === 'failed' && !options.allowFailed) {
    const code = terminal.canonical.error_code;
    const classification = /auth|key|quota|rate|unreachable|timeout|provider|model/iu.test(code)
      ? 'infrastructure_failure' : 'product_failure';
    throw new Error(`${classification}: thread ${threadID} failed (${code || 'unknown'})`);
  }
  return terminal;
}

async function threadCard(page, threadID) {
  const card = flowerSurface(page).locator(`[data-flower-thread-card][data-thread-id="${threadID}"]`);
  await card.waitFor({ state: 'visible', timeout: 20_000 });
  return card;
}

function assistantMessage(page, turnID) {
  return flowerSurface(page).locator(`[data-flower-message-id^="assistant:${turnID}:"]`);
}

async function selectThread(page, threadID) {
  const card = await threadCard(page, threadID);
  await card.locator('.flower-thread-card-select-button').click();
  await waitFor(async () => (
    await selectedThreadID(page) === threadID
    && await flowerSurface(page).getAttribute('data-flower-selected-thread-loading') !== 'true'
  ), 20_000, `select thread ${threadID}`);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (await selectedThreadID(page) !== threadID) {
    throw new Error(`thread selection drifted after selecting ${threadID}`);
  }
}

async function duplicateCounts(page) {
  return flowerSurface(page).evaluate((root) => {
    const duplicates = (selector, attribute) => {
      const counts = new Map();
      for (const node of root.querySelectorAll(selector)) {
        const id = node.getAttribute(attribute);
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return [...counts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
    };
    return {
      messages: duplicates('[data-flower-message-id]', 'data-flower-message-id'),
      tools: duplicates('[data-flower-activity-item-id]', 'data-flower-activity-item-id'),
    };
  });
}

async function geometrySnapshot(page) {
  return flowerSurface(page).evaluate((root) => {
    const box = (selector, global = false) => {
      const node = selector === '#redeven-flower-surface' ? root : (global ? document : root).querySelector(selector);
      if (!(node instanceof HTMLElement)) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document_scroll: {
        body_height: document.body.scrollHeight,
        document_height: document.documentElement.scrollHeight,
        body_width: document.body.scrollWidth,
        document_width: document.documentElement.scrollWidth,
      },
      unique_surfaces: {
        env_shell: document.querySelectorAll('[data-env-shell-background]').length,
        activity_bottom_bar: document.querySelectorAll('[data-activity-flower-bottom-bar]').length,
        flower_product: document.querySelectorAll('#redeven-activity-flower-product').length,
        flower_surface: document.querySelectorAll('#redeven-flower-surface').length,
      },
      activity_bottom_bar: box('[data-activity-flower-bottom-bar]', true),
      surface: box('#redeven-flower-surface'), rail: box('.flower-component-thread-rail'),
      transcript: box('.flower-chat-transcript'), composer: box('.flower-composer'),
      approval: box('[data-flower-composer-approval]'), input_request: box('[data-flower-input-request-prompt]'),
      attachment_lane: box('.flower-attachment-lane'), reference_menu: box('.flower-composer-reference-menu', true),
      preview_window: box('.file-preview-floating-window, .flower-chat-context-preview-window, .flower-attachment-preview-window', true),
    };
  });
}

export function assertEnvGeometry(geometry, label) {
  const unique = geometry.unique_surfaces;
  if (
    unique.env_shell !== 1
    || unique.activity_bottom_bar !== 1
    || unique.flower_product !== 1
    || unique.flower_surface !== 1
  ) {
    throw new Error(`${label} mounted duplicate or missing shell surfaces: ${JSON.stringify(unique)}`);
  }
  const scrollTolerance = 2;
  if (
    geometry.document_scroll.body_height > geometry.viewport.height + scrollTolerance
    || geometry.document_scroll.document_height > geometry.viewport.height + scrollTolerance
    || geometry.document_scroll.body_width > geometry.viewport.width + scrollTolerance
    || geometry.document_scroll.document_width > geometry.viewport.width + scrollTolerance
  ) {
    throw new Error(`${label} document exceeds the native viewport: ${JSON.stringify(geometry.document_scroll)}`);
  }
  if (!geometry.activity_bottom_bar || Math.abs(geometry.activity_bottom_bar.bottom - geometry.viewport.height) > 1) {
    throw new Error(`${label} Activity bottom bar is not aligned with the native viewport bottom`);
  }
  const geometryTolerance = 1;
  for (const [name, rect] of [
    ['Activity bottom bar', geometry.activity_bottom_bar],
    ['Flower surface', geometry.surface],
    ['thread rail', geometry.rail],
    ['composer', geometry.composer],
    ['preview window', geometry.preview_window],
  ]) {
    if (!rect) continue;
    if (
      rect.x < -geometryTolerance
      || rect.y < -geometryTolerance
      || rect.right > geometry.viewport.width + geometryTolerance
      || rect.bottom > geometry.viewport.height + geometryTolerance
    ) {
      throw new Error(`${label} ${name} exceeds the native viewport: ${JSON.stringify(rect)}`);
    }
  }
}

async function assertUIHealth(page) {
  const surface = flowerSurface(page);
  const box = await surface.boundingBox();
  if (!box || box.width < 500 || box.height < 400) throw new Error('Flower surface is blank or incorrectly framed');
  const badText = /unregistered tool name|handler not found|thread stop unavailable|MESSAGE FAILED|Flower could not finish|Flower 未能完成这次回复/iu;
  const bodyText = await surface.innerText();
  if (badText.test(bodyText)) throw new Error(`Flower exposed an internal failure: ${bodyText.match(badText)?.[0]}`);
  const duplicates = await duplicateCounts(page);
  if (duplicates.messages || duplicates.tools) throw new Error(`duplicate canonical UI entities: ${JSON.stringify(duplicates)}`);
  const rail = surface.locator('.flower-component-thread-rail');
  if (!await rail.isVisible()) throw new Error('thread rail is unavailable');
  const composer = surface.locator('.flower-composer textarea');
  if (await composer.count() && await composer.isVisible() && await composer.isDisabled()) throw new Error('composer is unexpectedly disabled');
  const geometry = await geometrySnapshot(page);
  assertEnvGeometry(geometry, 'Env App');
  return duplicates;
}

async function checkpoint(page, config, label) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry = await geometrySnapshot(page);
  await writeFile(path.join(config.reportRoot, `${label}-geometry.json`), `${JSON.stringify(geometry, null, 2)}\n`);
  assertEnvGeometry(geometry, label);
  if (!geometry.surface || !geometry.composer || geometry.composer.bottom > geometry.viewport.height + 1) {
    throw new Error(`${label} geometry overflowed the viewport`);
  }
  if (geometry.reference_menu && (
    geometry.reference_menu.x < 0
    || geometry.reference_menu.right > geometry.viewport.width + 1
    || geometry.reference_menu.bottom > geometry.composer.y + 1
  )) {
    throw new Error(`${label} reference menu overlapped or overflowed the composer`);
  }
  await page.screenshot({ path: path.join(config.reportRoot, `${label}.png`) });
  return geometry;
}

function currentView(response) {
  const root = response?.body?.data ?? response?.body ?? {};
  return root.current ?? root;
}

function orderedDisplayItems(current) {
  return (Array.isArray(current?.items) ? current.items : []).filter((item) => (
    ['user', 'thinking', 'assistant', 'tool'].includes(item?.kind)
    || (item?.kind === 'interaction' && item?.interaction?.kind === 'input' && item?.interaction?.resolved)
  ));
}

export function orderedToolPayload(item) {
  const activity = item?.activity ?? {};
  return activity?.presentation?.payload ?? activity?.payload ?? {};
}

function orderedInteractions(current) {
  return [
    ...(Array.isArray(current?.interactions) ? current.interactions : []),
    ...(Array.isArray(current?.items) ? current.items.map((entry) => entry?.interaction).filter(Boolean) : []),
  ];
}

function orderedApprovalForTool(current, item, pendingOnly = false) {
  const itemID = String(item?.id ?? '').trim();
  const segmentToolID = itemID.startsWith('tool:') ? String(itemID.split(':').at(-1) ?? '').trim() : '';
  const toolIDs = new Set([
    String(item?.activity?.tool_id ?? '').trim(),
    segmentToolID,
  ].filter(Boolean));
  const approvals = orderedInteractions(current).filter((interaction) => (
    interaction?.kind === 'approval'
    && interaction?.approval
    && (!pendingOnly || interaction?.resolved !== true)
  ));
  if (toolIDs.size === 0) return approvals.length === 1 ? approvals[0] : undefined;
  return approvals.find((interaction) => toolIDs.has(
    String(interaction?.tool_call_id || interaction?.approval?.tool_call_id || '').trim(),
  ));
}

export function orderedPendingApprovalForTool(current, item) {
  return orderedApprovalForTool(current, item, true);
}

export function orderedToolCommand(current, item) {
  const direct = String(orderedToolPayload(item).command ?? '').trim();
  if (direct) return direct;
  const approval = orderedApprovalForTool(current, item)?.approval;
  return String(approval?.command ?? '').trim();
}

export function validateOrderedPresentationCheckpoints(checkpoints) {
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
    throw new Error('ordered presentation requires at least one checkpoint');
  }
  let stableCanonicalPrefix = [];
  for (const [index, checkpointValue] of checkpoints.entries()) {
    const label = String(checkpointValue?.label ?? `checkpoint-${index}`);
    const items = checkpointValue?.canonical_items;
    const canonicalIDs = checkpointValue?.canonical_display_ids;
    const domIDs = checkpointValue?.dom_message_ids;
    if (!Array.isArray(items) || !Array.isArray(canonicalIDs) || !Array.isArray(domIDs)) {
      throw new Error(`${label} ordered checkpoint schema is incomplete`);
    }
    const itemIDs = items.map((item) => item.id);
    if (itemIDs.some((id) => !id)
      || new Set(itemIDs).size !== itemIDs.length
      || new Set(canonicalIDs).size !== canonicalIDs.length
      || new Set(domIDs).size !== domIDs.length) {
      throw new Error(`${label} ordered checkpoint contains duplicate IDs`);
    }
    const ordinals = items.map((item) => item.ordinal);
    if (ordinals.some((ordinal) => !Number.isInteger(ordinal) || ordinal < 1)
      || ordinals.some((ordinal, ordinalIndex) => ordinalIndex > 0 && ordinal <= ordinals[ordinalIndex - 1])) {
      throw new Error(`${label} canonical ordinals are not strictly increasing`);
    }
    const canonicalIdentity = items.map((item) => `${item.id}\u0000${item.ordinal}`);
    if (canonicalIdentity.length < stableCanonicalPrefix.length
      || stableCanonicalPrefix.some((identity, prefixIndex) => canonicalIdentity[prefixIndex] !== identity)) {
      throw new Error(`${label} canonical items do not preserve the stable prefix`);
    }
    const expectedDisplayIDs = items.filter((item) => item.display === true).map((item) => item.id);
    if (expectedDisplayIDs.length !== canonicalIDs.length
      || expectedDisplayIDs.some((id, idIndex) => canonicalIDs[idIndex] !== id)) {
      throw new Error(`${label} display IDs do not match displayable canonical items`);
    }
    if (canonicalIDs.length !== domIDs.length || canonicalIDs.some((id, idIndex) => domIDs[idIndex] !== id)) {
      throw new Error(`${label} canonical and DOM order differ`);
    }
    stableCanonicalPrefix = canonicalIdentity;
  }
  return checkpoints.at(-1).canonical_display_ids;
}

async function orderedPresentationCheckpoint(page, config, threadID, label, checkpoints, startedAt, accepts) {
  let evidence;
  let lastObserved;
  try {
    await waitFor(async () => {
      const response = await canonicalThread(page, threadID);
      if (response.status !== 200) throw new Error(`${label} canonical API returned ${response.status}`);
      const current = currentView(response);
      const displayItems = orderedDisplayItems(current);
      const canonicalDisplayIDs = displayItems.map((item) => String(item.id ?? ''));
      const displayIDSet = new Set(canonicalDisplayIDs);
      const items = (Array.isArray(current.items) ? current.items : []).map((item) => {
        const payload = orderedToolPayload(item);
        const output = payload.stdout ?? payload.output ?? payload.latest_output ?? '';
        const pendingApproval = item?.kind === 'tool' ? orderedPendingApprovalForTool(current, item) : undefined;
        return {
          id: String(item?.id ?? ''),
          ordinal: Number(item?.ordinal ?? 0),
          kind: String(item?.kind ?? ''),
          live: item?.live === true,
          display: displayIDSet.has(String(item?.id ?? '')),
          ...(['thinking', 'assistant'].includes(item?.kind) ? { text_excerpt: String(item?.text ?? '').slice(0, 1000) } : {}),
          ...(item?.kind === 'tool' ? {
            activity_status: String(item?.activity?.status ?? ''),
            tool_id: String(item?.activity?.tool_id ?? ''),
            tool_name: String(item?.activity?.tool_name ?? ''),
            command: orderedToolCommand(current, item).slice(0, 1000),
            approval_pending: Boolean(pendingApproval),
            output_excerpt: String(output).slice(0, 1000),
          } : {}),
        };
      });
      const domMessageIDs = await flowerSurface(page).locator('[data-flower-message-id]').evaluateAll((nodes) => (
        nodes.map((node) => node.getAttribute('data-flower-message-id')).filter(Boolean)
      ));
      const candidate = {
        schema_version: 1,
        label,
        elapsed_ms: Number((performance.now() - startedAt).toFixed(1)),
        canonical_items: items,
        canonical_display_ids: canonicalDisplayIDs,
        dom_message_ids: domMessageIDs,
        summary: {
          activity: String(current.activity ?? ''),
          item_count: items.length,
          kinds: items.map((item) => item.kind),
          tool_statuses: items.filter((item) => item.kind === 'tool').map((item) => item.activity_status),
          text_excerpts: items.filter((item) => item.text_excerpt).map((item) => item.text_excerpt),
        },
      };
      lastObserved = candidate;
      if (accepts && !accepts(current)) return false;
      validateOrderedPresentationCheckpoints([...checkpoints, candidate]);
      evidence = candidate;
      return true;
    }, 180_000, `${label} canonical/DOM convergence`, 50);
  } catch (error) {
    if (lastObserved) {
      await writeFile(path.join(config.reportRoot, `${label}-last-observed.json`), `${JSON.stringify(lastObserved, null, 2)}\n`);
    }
    throw error;
  }
  if (!evidence) throw new Error(`${label} checkpoint evidence was not captured`);
  await checkpoint(page, config, label);
  await writeFile(path.join(config.reportRoot, `${label}-ordered.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  checkpoints.push(evidence);
  return evidence;
}

async function closeFloatingPreview(page, selector) {
  const preview = page.locator(selector).first();
  await preview.getByRole('button', { name: 'Close', exact: true }).click();
  await preview.waitFor({ state: 'hidden', timeout: 10_000 });
}

async function approveCurrent(page, approved) {
  const card = flowerSurface(page).locator('[data-flower-composer-approval]').first();
  await card.waitFor({ state: 'visible', timeout: 120_000 });
  const buttons = card.locator('.flower-approval-actions button:not(.flower-composer-stop-thread)');
  await buttons.nth(approved ? (await buttons.count()) - 1 : 0).click();
}

async function runScenarios(page, config, telemetry) {
  const surface = flowerSurface(page);
  const results = [];
  telemetry.scenarios = results;
  const remember = async (id, operation) => {
    const started = performance.now();
    telemetry.active_scenario = id;
    try {
      const evidence = await operation();
      const duplicates = await assertUIHealth(page);
      const result = { id, pass: true, duration_ms: Number((performance.now() - started).toFixed(1)), duplicate_counts: duplicates, ...evidence };
      results.push(result);
      return result;
    } catch (error) {
      results.push({ id, pass: false, duration_ms: Number((performance.now() - started).toFixed(1)), failure_stage: id, error: String(error) });
      throw error;
    }
  };

  const s01 = await remember('S01', async () => {
    await startNewThread(page);
    await setPermission(page, 'full_access');
    const token = marker('BASIC');
    const sent = await sendPrompt(page, `Reply with exactly ${token} and nothing else.`, { visibleMarker: token });
    if (sent.userVisibleMS > 500) throw new Error(`user message visibility ${sent.userVisibleMS.toFixed(1)}ms exceeds 500ms`);
    const assistant = assistantMessage(page, sent.turnID).filter({ hasText: token });
    await assistant.waitFor({ state: 'visible', timeout: 180_000 });
    const firstAssistantMS = performance.now() - sent.clickedAt;
    const terminal = await waitForThreadTerminal(page, sent.threadID, 180_000, { turnID: sent.turnID });
    const terminalMS = performance.now() - sent.clickedAt;
    const modelText = await surface.locator('[data-flower-composer-control="model_reasoning"]').innerText();
    if (!modelText.toLowerCase().includes('deepseek-v4-flash')) throw new Error(`model display is not ${SMOKE_MODEL}: ${modelText}`);
    await checkpoint(page, config, 's01-basic');
    return { thread_id: sent.threadID, run_id: sent.runID, canonical: terminal.canonical, timings: {
      click_to_user_visible_ms: Number(sent.userVisibleMS.toFixed(1)), click_to_running_ms: Number(sent.runningMS.toFixed(1)),
      click_to_first_assistant_ms: Number(firstAssistantMS.toFixed(1)), click_to_terminal_ms: Number(terminalMS.toFixed(1)),
    } };
  });

  const s02 = await remember('S02', async () => {
    await startNewThread(page); await setPermission(page, 'full_access');
    const token = marker('EXEC');
    const sent = await sendPrompt(page, `You MUST call terminal.exec exactly once with command "printf ${token}" and a concise description. Do not simulate the result. After the tool succeeds, reply with ${token} as plain text. Do not call task_complete or any other tool.`, { visibleMarker: token });
    const tool = surface.locator('[data-flower-activity-item-id]').filter({ hasText: token });
    await tool.waitFor({ state: 'visible', timeout: 180_000 });
    const terminal = await waitForThreadTerminal(page, sent.threadID, 180_000, { turnID: sent.turnID });
    if (await tool.count() !== 1) throw new Error('terminal tool row count is not one');
    await tool.locator('.flower-activity-inline-button').click();
    await tool.locator('[data-flower-activity-terminal-panel]').waitFor({ state: 'visible', timeout: 20_000 });
    await checkpoint(page, config, 's02-terminal');
    return { thread_id: sent.threadID, run_id: sent.runID, canonical: terminal.canonical };
  });

  const s03 = await remember('S03', async () => {
    await startNewThread(page); await setPermission(page, 'approval_required');
    const token = marker('APPROVE');
    const output = path.join(config.workspace, 'approval-approved.txt');
    const sent = await sendPrompt(page, `You MUST call terminal.exec exactly once to run "printf ${token} | tee ${output}" with a concise description. Then report success as plain text. Do not call task_complete or any other tool.`, { visibleMarker: token });
    await waitFor(async () => await selectedStatus(page) === 'waiting_approval', 180_000, 'approval waiting');
    const card = await threadCard(page, sent.threadID);
    if (await card.getAttribute('data-flower-thread-action-required') !== 'true') throw new Error('thread rail did not expose approval attention');
    await checkpoint(page, config, 's03-approval-pending');
    await approveCurrent(page, true);
    const terminal = await waitForThreadTerminal(page, sent.threadID, 180_000, { turnID: sent.turnID });
    if ((await readFile(output, 'utf8')).trim() !== token) throw new Error('approved terminal write did not stay in smoke workspace');
    if (await surface.locator('[data-flower-activity-item-id]').count() < 1) throw new Error('approved tool activity is missing');
    return { thread_id: sent.threadID, run_id: sent.runID, canonical: terminal.canonical };
  });

  const s04 = await remember('S04', async () => {
    await startNewThread(page); await setPermission(page, 'approval_required');
    const token = marker('REJECT');
    const sent = await sendPrompt(page, `You MUST call terminal.exec once to run "printf ${token}". If the user rejects it, acknowledge the rejection as plain text without treating it as a failure. Do not call task_complete or any other tool.`, { visibleMarker: token });
    await waitFor(async () => await selectedStatus(page) === 'waiting_approval', 180_000, 'rejection approval waiting');
    await approveCurrent(page, false);
    await waitForThreadTerminal(page, sent.threadID, 180_000, { allowFailed: true, turnID: sent.turnID });
    const follow = marker('AFTER_REJECT');
    const followed = await sendPrompt(page, `Reply with exactly ${follow}.`, { visibleMarker: follow });
    await assistantMessage(page, followed.turnID).filter({ hasText: follow }).waitFor({ state: 'visible', timeout: 180_000 });
    const terminal = await waitForThreadTerminal(page, sent.threadID, 180_000, { turnID: followed.turnID });
    await checkpoint(page, config, 's04-rejected');
    return { thread_id: sent.threadID, run_id: sent.runID, canonical: terminal.canonical };
  });

  await remember('S05', async () => {
    await startNewThread(page); await setPermission(page, 'full_access');
    const immediate = marker('STOP_NOW');
    const textarea = surface.locator('.flower-composer textarea');
    await textarea.fill(`Think carefully for a while, then reply ${immediate}.`);
    const clickedAt = performance.now();
    await surface.locator('[data-flower-primary-action="send"]').click();
    const stop = surface.locator('[data-flower-primary-action="stop"]');
    await stop.waitFor({ state: 'visible', timeout: 10_000 }); await stop.click();
    const immediateStopMS = performance.now() - clickedAt;
    await surface.locator('[data-flower-message-role="user"]').filter({ hasText: immediate }).waitFor({ state: 'visible', timeout: 20_000 });
    const immediateThreadID = await waitFor(() => selectedThreadID(page), 20_000, 'immediate stop thread identity');
    await waitForThreadTerminal(page, immediateThreadID, 180_000, { allowFailed: true });
    const followImmediate = marker('STOP_NOW_CONTINUE');
    const continuedImmediate = await sendPrompt(page, `Reply exactly ${followImmediate}.`, { visibleMarker: followImmediate });
    await waitForThreadTerminal(page, immediateThreadID, 180_000, { turnID: continuedImmediate.turnID });

    await startNewThread(page); await setPermission(page, 'full_access');
    const running = marker('STOP_RUNNING');
    const sentRunning = await sendPrompt(page, `Write a numbered list from 1 through 2000, one item per line, and only after the list append ${running}.`, { visibleMarker: running });
    await surface.locator(`[data-flower-message-id^="assistant:${sentRunning.turnID}:"][data-flower-message-status="streaming"]`).waitFor({ state: 'visible', timeout: 180_000 });
    await surface.locator('[data-flower-primary-action="stop"]').click();
    await waitForThreadTerminal(page, sentRunning.threadID, 180_000, { allowFailed: true, turnID: sentRunning.turnID });
    const followRunning = marker('STOP_RUNNING_CONTINUE');
    const continuedRunning = await sendPrompt(page, `Reply exactly ${followRunning}.`, { visibleMarker: followRunning });
    const terminal = await waitForThreadTerminal(page, sentRunning.threadID, 180_000, { turnID: continuedRunning.turnID });
    await checkpoint(page, config, 's05-stop');
    return { thread_id: sentRunning.threadID, run_id: sentRunning.runID, canonical: terminal.canonical, timings: {
      click_to_immediate_stop_ms: Number(immediateStopMS.toFixed(1)),
    } };
  });

  await remember('S06', async () => {
    await startNewThread(page); await setPermission(page, 'full_access');
    const normal = marker('ASK_CHOICE');
    const sentNormal = await sendPrompt(page, `Call ask_user exactly once. Ask for a deployment lane using response_mode "select", choices_exhaustive true, and exactly two fixed choices: Alpha and Beta. After the answer, reply ${normal}. Call no other tool.`, { visibleMarker: normal });
    const prompt = surface.locator('[data-flower-input-request-prompt]');
    await prompt.waitFor({ state: 'visible', timeout: 180_000 });
    await startNewThread(page); await selectThread(page, sentNormal.threadID);
    await prompt.waitFor({ state: 'visible', timeout: 20_000 });
    await prompt.locator('[data-flower-input-answer-kind="choice"]').first().click();
    await checkpoint(page, config, 's06-ask-user-choice');
    await surface.locator('.flower-composer-continue').click();
    await waitForThreadTerminal(page, sentNormal.threadID, 180_000, { turnID: sentNormal.turnID });

    await startNewThread(page); await setPermission(page, 'full_access');
    const other = marker('ASK_OTHER');
    const sentOther = await sendPrompt(page, `Call ask_user exactly once. Ask for a deployment lane using response_mode "select_or_write", choices_exhaustive false, exactly two fixed choices Alpha and Beta, and write_label "Other" for custom text. After a custom answer, reply ${other}. Call no other tool.`, { visibleMarker: other });
    const otherPrompt = surface.locator('[data-flower-input-request-prompt]');
    await otherPrompt.waitFor({ state: 'visible', timeout: 180_000 });
    await otherPrompt.locator('[data-flower-input-answer-kind="custom"]').click();
    const custom = surface.locator('[data-flower-input-custom-answer="true"]');
    await custom.fill('Gamma lane');
    await checkpoint(page, config, 's06-ask-user-other');
    await surface.locator('.flower-composer-continue').click();
    const terminal = await waitForThreadTerminal(page, sentOther.threadID, 180_000, { turnID: sentOther.turnID });
    return { thread_id: sentOther.threadID, run_id: sentOther.runID, canonical: terminal.canonical };
  });

  await remember('S07', async () => {
    await startNewThread(page); await setPermission(page, 'full_access');
    const token = marker('TODO');
    const sent = await sendPrompt(page, `Use write_todos to create exactly three concise actions. Keep at most one in_progress, then update all three to completed. Finally reply ${token} as plain text. Do not call task_complete or any other tool after write_todos.`, { visibleMarker: token });
    const finalActivity = surface.locator('[data-flower-activity-item-id]').filter({ hasText: /3\/3 completed/iu }).last();
    await finalActivity.waitFor({ state: 'visible', timeout: 180_000 });
    await finalActivity.locator('.flower-activity-inline-button').click();
    const todos = finalActivity.locator('.flower-activity-todo-list [role="listitem"]');
    await waitFor(async () => await todos.count() === 3, 180_000, 'three todo rows');
    await waitFor(async () => {
      const states = await todos.evaluateAll((items) => items.map((item) => item.getAttribute('data-status')));
      return states.every((state) => state === 'completed');
    }, 180_000, 'completed todo rows');
    if ((await finalActivity.innerText()).includes('{"')) throw new Error('todo activity exposed raw JSON');
    const terminal = await waitForThreadTerminal(page, sent.threadID, 180_000, { turnID: sent.turnID });
    await checkpoint(page, config, 's07-todos');
    return { thread_id: sent.threadID, run_id: sent.runID, canonical: terminal.canonical };
  });

  await remember('S08', async () => {
    await startNewThread(page); await setPermission(page, 'full_access');
    const first = marker('QUEUE_RUN');
    const sent = await sendPrompt(page, `Call terminal.exec exactly once with command "sleep 12; printf ${first}". After it finishes, reply ${first} as plain text. Do not call task_complete or any other tool.`, { visibleMarker: first });
    const stopRunning = surface.locator('[data-flower-primary-action="stop"]');
    await stopRunning.waitFor({ state: 'visible', timeout: 10_000 });
    const q1 = marker('QUEUE_ONE'); const q2 = marker('QUEUE_TWO');
    await queuePrompt(page, `Reply exactly ${q1} as plain text after current work. Call no tools, including task_complete.`, q1);
    await queuePrompt(page, `Reply exactly ${q2} as plain text after current work. Call no tools, including task_complete.`, q2);
    const queue = surface.locator('[data-flower-queued-turn-dock-id]');
    await waitFor(async () => await queue.count() === 2, 30_000, 'two queued turns');
    const initialQueueIDs = await queue.evaluateAll((items) => items.map((item) => (
      item.getAttribute('data-flower-queued-turn-dock-id') ?? ''
    )));
    if (initialQueueIDs.length !== 2 || initialQueueIDs.some((queueID) => !queueID)) {
      throw new Error(`queue reorder requires two canonical IDs; received ${initialQueueIDs.join(',')}`);
    }
    const expectedQueueIDs = [...initialQueueIDs].reverse();
    const reorderResponse = page.waitForResponse(
      (response) => isExpectedQueueOrderResponse(response, sent.threadID, expectedQueueIDs),
      { timeout: 30_000 },
    );
    await dragQueuedTurnAfter(page, queue.first(), queue.last());
    const reordered = await reorderResponse;
    if (reordered.status() !== 200) {
      const requestOrder = reordered.request().postDataJSON()?.ordered_queue_ids ?? [];
      const responseBody = await reordered.json().catch(() => ({}));
      throw new Error(`queue reorder returned ${reordered.status()}: ${String(responseBody.error ?? 'unknown')}; ids=${requestOrder.join(',')}`);
    }
    await waitFor(async () => JSON.stringify(await queue.evaluateAll((items) => items.map((item) => (
      item.getAttribute('data-flower-queued-turn-dock-id') ?? ''
    )))) === JSON.stringify(expectedQueueIDs), 20_000, 'reordered queued turn DOM order');
    const deletedMarker = (await queue.first().innerText()).includes(q1) ? q1 : q2;
    const remainingMarker = deletedMarker === q1 ? q2 : q1;
    await queue.first().locator('[data-flower-queued-turn-delete]').click();
    await waitFor(async () => await queue.count() === 1, 20_000, 'one queued turn after delete');
    await stopRunning.click({ timeout: 5_000 });
    await waitForThreadTerminal(page, sent.threadID, 180_000, { allowFailed: true, turnID: sent.turnID });
    const sendQueued = queue.first().locator('.flower-queued-turn-send');
    await waitFor(async () => await sendQueued.isEnabled(), 20_000, 'queued force-send enabled');
    await sendQueued.click();
    const terminal = await waitForThreadTerminal(page, sent.threadID, 180_000, { afterTurnID: sent.turnID });
    const canonicalText = JSON.stringify((await canonicalThread(page, sent.threadID)).body ?? '');
    if (!canonicalText.includes(remainingMarker) || canonicalText.includes(deletedMarker)) {
      throw new Error('queue delete/force-send canonical markers do not match the UI actions');
    }
    await checkpoint(page, config, 's08-queue');
    return { thread_id: sent.threadID, run_id: sent.runID, canonical: terminal.canonical };
  });

  await remember('S09', async () => {
    await startNewThread(page); await setPermission(page, 'full_access');
    const runToken = marker('PIN_RUNNING');
    const running = await sendPrompt(page, `Call terminal.exec once with command "sleep 12; printf ${runToken}". After it finishes, reply ${runToken}. Call no other tool.`, { visibleMarker: runToken });
    await surface.locator('[data-flower-activity-item-id]').filter({ hasText: runToken }).waitFor({ state: 'visible', timeout: 180_000 });
    await startNewThread(page); await setPermission(page, 'approval_required');
    const approvalToken = marker('PIN_APPROVAL');
    const waiting = await sendPrompt(page, `Call terminal.exec with "printf ${approvalToken}" and wait for approval. After the decision, reply only as plain text. Do not call task_complete or any other tool.`, { visibleMarker: approvalToken });
    await waitFor(async () => await selectedStatus(page) === 'waiting_approval', 180_000, 'pin approval waiting');
    for (const threadID of [running.threadID, waiting.threadID]) {
      const card = await threadCard(page, threadID); await card.hover();
      const pin = card.locator('.flower-thread-card-pin-button'); await pin.click();
      await waitFor(async () => await pin.getAttribute('data-pinned') === 'true', 15_000, 'thread pinned');
      await pin.click();
      await waitFor(async () => await pin.getAttribute('data-pinned') === 'false', 15_000, 'thread unpinned');
    }
    await selectThread(page, waiting.threadID); await approveCurrent(page, false); await waitForThreadTerminal(page, waiting.threadID, 180_000, { turnID: waiting.turnID });
    await selectThread(page, running.threadID); const terminal = await waitForThreadTerminal(page, running.threadID, 180_000, { turnID: running.turnID });
    await surface.locator('.flower-thread-refresh-button').click();
    await checkpoint(page, config, 's09-pin');
    return { thread_id: running.threadID, run_id: running.runID, canonical: terminal.canonical };
  });

  await remember('S10', async () => {
    await startNewThread(page); await setPermission(page, 'full_access');
    const token = marker('DELETE');
    const sent = await sendPrompt(page, `Reply exactly ${token}.`, { visibleMarker: token });
    await waitForThreadTerminal(page, sent.threadID, 180_000, { turnID: sent.turnID });
    const card = await threadCard(page, sent.threadID); await card.locator('.flower-thread-card-menu-button').click();
    await page.locator('.flower-thread-context-menu [data-destructive="true"]').click();
    const dialog = page.getByRole('dialog').last(); await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    await dialog.locator('button').last().click();
    await card.waitFor({ state: 'detached', timeout: 30_000 });
    telemetry.workspace_sse_reconnect_reasons.push('renderer_reload_after_thread_delete');
    await page.reload(); await ensureFlowerSurface(page);
    if (await surface.locator(`[data-thread-id="${sent.threadID}"]`).count()) throw new Error('deleted ghost thread returned after reload');
    await checkpoint(page, config, 's10-delete');
    return { thread_id: sent.threadID, canonical: { deleted: true } };
  });

  await remember('S11', async () => {
    await startNewThread(page); await setPermission(page, 'full_access');
    const one = marker('COMPACT_ONE'); const two = marker('COMPACT_TWO');
    const sent = await sendPrompt(page, `Reply exactly ${one}.`, { visibleMarker: one }); await waitForThreadTerminal(page, sent.threadID, 180_000, { turnID: sent.turnID });
    const second = await sendPrompt(page, `Reply exactly ${two}.`, { visibleMarker: two }); await waitForThreadTerminal(page, sent.threadID, 180_000, { turnID: second.turnID });
    await sendPrompt(page, '/compact', { visibleMarker: '/compact' });
    const divider = surface.locator('[data-flower-compaction-status]');
    await divider.waitFor({ state: 'visible', timeout: 180_000 });
    await waitFor(async () => await divider.getAttribute('data-flower-compaction-status') !== 'compacting', 180_000, 'manual compaction terminal');
    if (await divider.count() !== 1) throw new Error('manual compaction divider duplicated');
    const after = marker('COMPACT_AFTER'); const afterSent = await sendPrompt(page, `Reply exactly ${after}.`, { visibleMarker: after });
    const terminal = await waitForThreadTerminal(page, sent.threadID, 180_000, { turnID: afterSent.turnID });
    await checkpoint(page, config, 's11-compact');
    return { thread_id: sent.threadID, run_id: sent.runID, canonical: terminal.canonical };
  });

  await remember('S12', async () => {
    await startNewThread(page); await setPermission(page, 'full_access');
    const textarea = surface.locator('.flower-composer textarea');
    await textarea.fill('@reference');
    const menu = page.locator('.flower-composer-reference-menu'); await menu.waitFor({ state: 'visible', timeout: 30_000 });
    await checkpoint(page, config, 's12-reference-menu');
    const option = menu.getByRole('option').filter({ hasText: 'reference-marker-with-a-deliberately-long-file-name' }).first();
    await option.click();
    const token = marker('REFERENCE');
    await textarea.press('End'); await textarea.type(` Read the selected reference with file.read and reply with its marker plus ${token} as plain text. Do not call task_complete or any other tool after file.read.`);
    const sent = await sendPrompt(page, await textarea.inputValue(), { visibleMarker: token });
    await surface.locator('[data-flower-activity-item-id]').filter({ hasText: /reference-marker|FLOWER_REFERENCE/iu }).waitFor({ state: 'visible', timeout: 180_000 });
    const terminal = await waitForThreadTerminal(page, sent.threadID, 180_000, { turnID: sent.turnID });
    const chip = surface.locator('[data-flower-message-role="user"] [data-flower-chat-context-chip="true"]').first(); await chip.click();
    const previewSelector = '.file-preview-floating-window, .flower-chat-context-preview-window';
    await page.locator(previewSelector).first().waitFor({ state: 'visible', timeout: 20_000 });
    await checkpoint(page, config, 's12-reference');
    await closeFloatingPreview(page, previewSelector);
    return { thread_id: sent.threadID, run_id: sent.runID, canonical: terminal.canonical };
  });

  await remember('S13', async () => {
    await startNewThread(page); await setPermission(page, 'full_access');
    const input = surface.locator('.flower-composer input[type="file"]');
    const keep = path.join(config.workspace, 'attachment-keep-with-a-deliberately-long-file-name-for-overflow-validation.txt');
    const remove = path.join(config.workspace, 'attachment-remove.txt');
    await input.setInputFiles([keep, remove]);
    const items = surface.locator('.flower-attachment-lane .flower-attachment-item');
    await waitFor(async () => await items.count() === 2, 30_000, 'two staged attachments');
    await waitFor(async () => (await items.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-attachment-status')))).every((value) => value === 'staged_ready'), 60_000, 'attachments staged');
    const keepItem = items.filter({ hasText: 'attachment-keep' });
    await keepItem.locator('.flower-attachment-preview-trigger').click();
    await page.locator('.flower-attachment-preview-window').waitFor({ state: 'visible', timeout: 30_000 });
    await checkpoint(page, config, 's13-attachment');
    await closeFloatingPreview(page, '.flower-attachment-preview-window');
    await items.filter({ hasText: 'attachment-remove.txt' }).locator('.flower-attachment-icon-button').last().click();
    await waitFor(async () => await items.count() === 1, 10_000, 'one attachment remains after removal');
    if (!await keepItem.isVisible()) throw new Error('remaining attachment disappeared before send');
    const token = marker('ATTACHMENT');
    const sent = await sendPrompt(page, `Use attachment.read to read the remaining attachment and reply with its marker plus ${token} as plain text. Do not call task_complete or any other tool after attachment.read.`, { visibleMarker: token });
    const sentContext = surface.locator(`[data-flower-message-id="user:${sent.runID}"] [data-flower-chat-context-chip="true"]`);
    await waitFor(async () => await sentContext.count() === 1, 30_000, 'one canonical attachment context');
    if (!await sentContext.first().innerText().then((text) => text.includes('attachment-keep'))) {
      throw new Error('sent attachment context does not contain the remaining file');
    }
    await surface.locator('[data-flower-activity-item-id]').filter({ hasText: /attachment-keep|FLOWER_ATTACHMENT_KEEP/iu }).waitFor({ state: 'visible', timeout: 180_000 });
    const terminal = await waitForThreadTerminal(page, sent.threadID, 180_000, { turnID: sent.turnID });
    return { thread_id: sent.threadID, run_id: sent.runID, canonical: terminal.canonical };
  });

  await remember('S14', async () => {
    await startNewThread(page); await setPermission(page, 'full_access');
    const tokenA = marker('SWITCH_A'); const a = await sendPrompt(page, `Call terminal.exec once with command "sleep 12; printf ${tokenA}". After it finishes, reply ${tokenA}. Call no other tool.`, { visibleMarker: tokenA });
    await surface.locator('[data-flower-activity-item-id]').filter({ hasText: tokenA }).waitFor({ state: 'visible', timeout: 180_000 });
    await startNewThread(page); await setPermission(page, 'approval_required');
    const tokenB = marker('SWITCH_B'); const b = await sendPrompt(page, `Call terminal.exec exactly once with "printf ${tokenB}" and wait for approval. After the decision, reply only as plain text. Do not call task_complete or any other tool.`, { visibleMarker: tokenB });
    await waitFor(async () => await selectedStatus(page) === 'waiting_approval', 180_000, 'recovery companion approval');
    await selectThread(page, a.threadID); await selectThread(page, b.threadID); await selectThread(page, a.threadID);
    const terminal = await waitForThreadTerminal(page, a.threadID, 180_000, {
      turnID: a.turnID,
      expectedSelectedThreadID: a.threadID,
    });
    const before = await duplicateCounts(page);
    telemetry.workspace_sse_reconnect_reasons.push('renderer_reload_recovery');
    await page.reload(); await ensureFlowerSurface(page);
    await selectThread(page, a.threadID);
    const after = await duplicateCounts(page);
    if (before.messages || before.tools || after.messages || after.tools) throw new Error('renderer recovery duplicated canonical rows');
    const companion = await threadCard(page, b.threadID);
    if (await companion.getAttribute('data-flower-thread-action-required') !== 'true') throw new Error('renderer recovery lost companion approval attention');
    await checkpoint(page, config, 's14-recovery');
    await selectThread(page, b.threadID); await approveCurrent(page, false); await waitForThreadTerminal(page, b.threadID, 180_000, { turnID: b.turnID });
    await selectThread(page, a.threadID);
    return { thread_id: a.threadID, run_id: a.runID, canonical: terminal.canonical, switch_thread_id: b.threadID };
  });

  await remember('S15', async () => {
    await startNewThread(page); await setPermission(page, 'approval_required');
    const firstToken = marker('ORDERED_FIRST');
    const secondToken = marker('ORDERED_SECOND');
    const scenarioStarted = performance.now();
    const checkpoints = [];
    const sent = await sendPrompt(page, [
      'Work through exactly two sequential safe terminal steps.',
      `First reason about the first step, then call terminal.exec exactly once with command "sleep 2; printf ${firstToken}" and wait for its result.`,
      `Only after the first result, reason about the second step, then call terminal.exec exactly once with command "sleep 2; printf ${secondToken}" and wait for its result.`,
      `Only after both results, reply exactly ${firstToken}_${secondToken} as plain text.`,
      'Do not emit assistant text before or between tool calls. Put planning only in reasoning. Emit assistant text only after both tool results.',
      'Do not call both tools together. Do not call task_complete or any other tool.',
    ].join(' '), { visibleMarker: firstToken });

    await orderedPresentationCheckpoint(
      page, config, sent.threadID, 's15-01-first-thinking', checkpoints, scenarioStarted,
      (current) => orderedDisplayItems(current).some((item) => item.kind === 'thinking'),
    );

    const firstWaiting = await orderedPresentationCheckpoint(
      page, config, sent.threadID, 's15-02-tool-1-waiting', checkpoints, scenarioStarted,
      (current) => {
        const tools = orderedDisplayItems(current).filter((item) => item.kind === 'tool');
        const approval = orderedPendingApprovalForTool(current, tools[0]);
        return tools.length === 1
          && tools[0]?.activity?.tool_name === 'terminal.exec'
          && Boolean(approval)
          && orderedToolCommand(current, tools[0]).includes(`printf ${firstToken}`);
      },
    );
    const firstTool = firstWaiting.canonical_items.find((item) => item.kind === 'tool');
    if (!firstTool) throw new Error('S15 first terminal.exec evidence is missing');
    await approveCurrent(page, true);
    await orderedPresentationCheckpoint(
      page, config, sent.threadID, 's15-03-tool-1-complete', checkpoints, scenarioStarted,
      (current) => {
        const item = orderedDisplayItems(current).find((entry) => entry.id === firstTool.id);
        const payload = orderedToolPayload(item);
        const output = payload.stdout ?? payload.output ?? payload.latest_output ?? '';
        return item?.activity?.status === 'success' && String(output).includes(firstToken);
      },
    );

    await orderedPresentationCheckpoint(
      page, config, sent.threadID, 's15-04-second-thinking', checkpoints, scenarioStarted,
      (current) => {
        const items = orderedDisplayItems(current);
        const firstToolIndex = items.findIndex((item) => item.id === firstTool.id);
        return items.some((item, index) => item.kind === 'thinking' && index > firstToolIndex);
      },
    );

    const secondWaiting = await orderedPresentationCheckpoint(
      page, config, sent.threadID, 's15-05-tool-2-waiting', checkpoints, scenarioStarted,
      (current) => {
        const tools = orderedDisplayItems(current).filter((item) => item.kind === 'tool');
        const approval = orderedPendingApprovalForTool(current, tools[1]);
        return tools.length === 2
          && tools.every((item) => item?.activity?.tool_name === 'terminal.exec')
          && tools[0]?.activity?.status === 'success'
          && Boolean(approval)
          && orderedToolCommand(current, tools[1]).includes(`printf ${secondToken}`);
      },
    );
    const secondTool = secondWaiting.canonical_items.filter((item) => item.kind === 'tool')[1];
    if (!secondTool) throw new Error('S15 second terminal.exec evidence is missing');
    await approveCurrent(page, true);
    await orderedPresentationCheckpoint(
      page, config, sent.threadID, 's15-06-tool-2-complete', checkpoints, scenarioStarted,
      (current) => {
        const item = orderedDisplayItems(current).find((entry) => entry.id === secondTool.id);
        const payload = orderedToolPayload(item);
        const output = payload.stdout ?? payload.output ?? payload.latest_output ?? '';
        return item?.activity?.status === 'success' && String(output).includes(secondToken);
      },
    );

    const terminal = await waitForThreadTerminal(page, sent.threadID, 180_000, { turnID: sent.turnID });
    const finalText = `${firstToken}_${secondToken}`;
    const finalCheckpoint = await orderedPresentationCheckpoint(
      page, config, sent.threadID, 's15-07-final', checkpoints, scenarioStarted,
      (current) => {
        const assistants = orderedDisplayItems(current).filter((item) => item.kind === 'assistant');
        return String(assistants.at(-1)?.text ?? '').trim() === finalText;
      },
    );
    const finalItems = finalCheckpoint.canonical_items;
    const firstThinkingIndex = finalItems.findIndex((item) => item.kind === 'thinking');
    const firstToolIndex = finalItems.findIndex((item) => item.id === firstTool.id);
    const secondThinkingIndex = finalItems.findIndex((item, index) => item.kind === 'thinking' && index > firstToolIndex);
    const secondToolIndex = finalItems.findIndex((item) => item.id === secondTool.id);
    const finalAssistantIndex = finalItems.findLastIndex((item) => item.kind === 'assistant');
    if (!(firstThinkingIndex >= 0 && firstThinkingIndex < firstToolIndex && firstToolIndex < secondThinkingIndex
      && secondThinkingIndex < secondToolIndex && secondToolIndex < finalAssistantIndex)) {
      throw new Error(`S15 final order is invalid: ${finalItems.map((item) => item.kind).join(' > ')}`);
    }

    telemetry.workspace_sse_reconnect_reasons.push('renderer_reload_ordered_presentation');
    await page.reload(); await ensureFlowerSurface(page); await selectThread(page, sent.threadID);
    const reloadCheckpoint = await orderedPresentationCheckpoint(
      page, config, sent.threadID, 's15-08-renderer-reload', checkpoints, scenarioStarted,
      (current) => {
        const assistants = orderedDisplayItems(current).filter((item) => item.kind === 'assistant');
        return String(assistants.at(-1)?.text ?? '').trim() === finalText;
      },
    );
    if (reloadCheckpoint.canonical_display_ids.some((id, index) => id !== finalCheckpoint.canonical_display_ids[index])
      || reloadCheckpoint.canonical_display_ids.length !== finalCheckpoint.canonical_display_ids.length) {
      throw new Error('S15 renderer reload changed canonical ordered IDs');
    }
    return {
      thread_id: sent.threadID,
      run_id: sent.runID,
      canonical: terminal.canonical,
      ordered_checkpoints: checkpoints.map((item) => ({ label: item.label, elapsed_ms: item.elapsed_ms, ids: item.canonical_display_ids })),
      timings: Object.fromEntries(checkpoints.map((item) => [item.label, item.elapsed_ms])),
    };
  });

  telemetry.scenarios = results;
  return { results, keyThreads: { basic: s01.thread_id, terminal: s02.thread_id, approval: s03.thread_id, rejected: s04.thread_id } };
}

async function runFlowerBrowserSmoke(config) {
  assertSmokeConfiguration(config);
  const { chromium } = require(path.join(config.playwrightRoot, 'playwright'));
  const browsers = new Set();
  const connect = async () => {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${config.cdpPort}`);
    browsers.add(browser);
    return browser;
  };
  let browser = await connect();
  const telemetry = {
    console_errors: [], page_errors: [], browser_errors: [], failed_responses: [], requests: 0,
    workspace_sse_connections: 0, workspace_sse_reconnect_reasons: [], scenarios: [], active_scenario: 'startup',
  };
  const browserStarted = performance.now();
  let page;
  let nativeViewport;
  try {
    ({ browser, page } = await acquireEnvPage(browser, connect, config.reportRoot));
    nativeViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    page.on('console', (message) => { if (message.type() === 'error') telemetry.console_errors.push({ scenario: telemetry.active_scenario, elapsed_ms: Number((performance.now() - browserStarted).toFixed(1)), message: message.text().slice(0, 2000) }); });
    const sanitizeDiagnostic = (value) => String(value ?? '')
      .replaceAll(config.worktree, '<worktree>')
      .replaceAll(`/private${SMOKE_ROOT}`, '<smoke-root>')
      .replaceAll(SMOKE_ROOT, '<smoke-root>');
    page.on('pageerror', (error) => telemetry.page_errors.push({
      scenario: telemetry.active_scenario,
      elapsed_ms: Number((performance.now() - browserStarted).toFixed(1)),
      message: sanitizeDiagnostic(error).slice(0, 2000),
      stack: sanitizeDiagnostic(error?.stack ?? error).slice(0, 6000),
    }));
    page.on('request', (request) => {
      telemetry.requests += 1;
      try { if (new URL(request.url()).pathname.endsWith('/api/ai/flower/stream')) telemetry.workspace_sse_connections += 1; } catch {}
    });
    page.on('response', async (response) => {
      try {
        const pathname = new URL(response.url()).pathname;
        if (pathname.includes('/api/ai/') && response.status() >= 400) telemetry.failed_responses.push({ pathname, status: response.status() });
      } catch {}
    });
    const output = await runScenarios(page, config, telemetry);
    if (telemetry.console_errors.length || telemetry.page_errors.length || telemetry.failed_responses.length) {
      throw new Error(`browser diagnostics are not clean: ${JSON.stringify({ console: telemetry.console_errors.length, page: telemetry.page_errors.length, responses: telemetry.failed_responses })}`);
    }
    const goMod = await readFile(path.join(config.worktree, 'go.mod'), 'utf8');
    const floretVersion = goMod.match(/github\.com\/floegence\/floret\/v4\s+(v\S+)/u)?.[1] ?? '';
    const result = {
      schema_version: 1, redeven_commit: config.commit, runtime_commit: config.commit, floret_version: floretVersion,
      model: SMOKE_MODEL, provider: { configured: true },
      native_viewport: nativeViewport,
      runtime: { pid: config.runtimePID, ports: { local_ui: config.localUIPort, cdp: config.cdpPort, inspector: config.inspectorPort }, state_root: config.stateRoot },
      scenarios: output.results, request_count: telemetry.requests, workspace_sse_connections: telemetry.workspace_sse_connections,
      workspace_sse_reconnect_reasons: telemetry.workspace_sse_reconnect_reasons,
      duplicate_message_count: output.results.reduce((sum, item) => sum + (item.duplicate_counts?.messages ?? 0), 0),
      duplicate_tool_count: output.results.reduce((sum, item) => sum + (item.duplicate_counts?.tools ?? 0), 0),
      retries: 0, pass: output.results.length === 15 && output.results.every((item) => item.pass),
    };
    await writeFile(path.join(config.reportRoot, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    await writeFile(path.join(config.reportRoot, 'timings.json'), `${JSON.stringify(Object.fromEntries(output.results.map((item) => [item.id, item.timings ?? { duration_ms: item.duration_ms }])), null, 2)}\n`);
    await writeFile(path.join(config.reportRoot, 'browser-errors.json'), `${JSON.stringify({ console_errors: [], page_errors: [], failed_responses: [] }, null, 2)}\n`);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(config.reportRoot, 'failure.png') }).catch(() => {});
    await writeFile(path.join(config.reportRoot, 'result.json'), `${JSON.stringify({ schema_version: 1, model: SMOKE_MODEL, provider: { configured: true }, scenarios: telemetry.scenarios, retries: 0, pass: false, failure: String(error) }, null, 2)}\n`);
    await writeFile(path.join(config.reportRoot, 'browser-errors.json'), `${JSON.stringify({ console_errors: telemetry.console_errors, page_errors: telemetry.page_errors, failed_responses: telemetry.failed_responses }, null, 2)}\n`);
    throw error;
  } finally {
    await Promise.all([...browsers].map((item) => item.close().catch(() => {})));
  }
}

async function cli() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'check-ports') {
    await assertPortsFree(args.map(Number));
    return;
  }
  if (mode === 'prepare-provider') {
    const [sourceRoot, runtimeStateRoot, metadataFile] = args;
    if (!sourceRoot || !runtimeStateRoot || !metadataFile) throw new Error('prepare-provider requires source, runtime state, and metadata paths');
    await prepareIsolatedProviderState(sourceRoot, runtimeStateRoot, metadataFile);
    return;
  }
  if (mode === 'remove-provider') {
    await removeIsolatedProviderState(args[0]);
    return;
  }
  if (mode === 'owned-pids') {
    const manifest = JSON.parse(await readFile(args[0], 'utf8'));
    for (const pid of ownedManifestPIDs(manifest, observedManifestProcesses(manifest))) console.log(pid);
    return;
  }
  if (mode === 'scan-source-secret') {
    const [sourceRoot, reportRoot, worktree] = args;
    const secret = await sourceDeepSeekSecret(sourceRoot);
    const leaks = [
      ...await scanSecretLeaks([reportRoot], secret),
      ...await scanWorktreeDiffForSecret(worktree, secret),
    ];
    if (leaks.length > 0) throw new Error(`secret leak detected in ${leaks.join(', ')}`);
    return;
  }
  if (mode === 'scan-secret') {
    const [secretFile, ...roots] = args;
    const secretPayload = JSON.parse(await readFile(secretFile, 'utf8'));
    const secret = findDeepSeekProvider(secretPayload.config, secretPayload.secrets).apiKey;
    const leaks = await scanSecretLeaks(roots, secret);
    if (leaks.length > 0) throw new Error(`secret leak detected in ${leaks.join(', ')}`);
    return;
  }
  if (mode === 'run') {
    const config = JSON.parse(await readFile(args[0], 'utf8'));
    await runFlowerBrowserSmoke(config);
    return;
  }
  if (mode) throw new Error(`unknown Flower smoke mode ${mode}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  cli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
