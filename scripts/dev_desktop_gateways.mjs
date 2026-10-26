import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { verifySourceBuildIdentity } from './source_build_identity.mjs';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function canonicalPath(value) {
  let current = path.resolve(value);
  const suffix = [];
  for (;;) {
    try { return path.join(await realpath(current), ...suffix); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      suffix.unshift(path.basename(current));
      current = path.dirname(current);
    }
  }
}

function validateGatewayID(gatewayID) {
  if (typeof gatewayID !== 'string' || !gatewayID || gatewayID === '.' || gatewayID === '..' || /[/\\\0]/u.test(gatewayID)) {
    throw new Error('Invalid development Gateway identity.');
  }
}

export async function developmentGatewayTargets(stateRoot) {
  const root = await canonicalPath(stateRoot);
  const snapshot = await readJSON(path.join(root, 'local-environment/gateway/gateways.json'), { gateways: [] });
  if (!Array.isArray(snapshot.gateways)) throw new Error('Invalid development Gateway store.');
  const targets = [];
  for (const record of snapshot.gateways) {
    if (record.connection?.kind !== 'local_host') continue;
    const gatewayID = record.gateway_id;
    validateGatewayID(gatewayID);
    const configuredRoot = record.connection.runtime_root;
    const resolvedRoot = configuredRoot === 'remote_default' ? path.join(os.homedir(), '.redeven')
      : configuredRoot?.startsWith('remote_default/') ? path.join(os.homedir(), '.redeven', configuredRoot.slice('remote_default/'.length))
      : configuredRoot;
    if (typeof resolvedRoot !== 'string' || !path.isAbsolute(resolvedRoot)) throw new Error('Invalid local Gateway service root.');
    const runtimeRoot = await canonicalPath(resolvedRoot);
    const gatewayState = await canonicalPath(path.join(runtimeRoot, 'gateways', gatewayID, 'state'));
    targets.push({ gatewayID, runtimeRoot, stateRoot: gatewayState, enabled: record.local_enabled !== false });
  }
  return targets;
}

export async function runDevelopmentGateways({ mode, stateRoot, sourceRoot, buildKey, sourceIdentity, signal, dependencies, log = console.log }) {
  if (mode !== 'start' && mode !== 'stop') throw new Error('Expected start or stop.');
  const root = await canonicalPath(stateRoot);
  const ledgerPath = path.join(root, 'desktop/dev-gateways-v1.json');
  const recorded = await readJSON(ledgerPath, []);
  if (!Array.isArray(recorded)) throw new Error('Invalid development Gateway inventory.');
  const current = await developmentGatewayTargets(root);
  if (mode === 'stop') {
    const targets = new Map([...recorded, ...current].map(target => [target.stateRoot, target]));
    const errors = [];
    for (const target of targets.values()) {
      validateGatewayID(target.gatewayID);
      if (!path.isAbsolute(target.runtimeRoot ?? '')) throw new Error('Invalid development Gateway inventory root.');
      const targetRoot = await canonicalPath(target.stateRoot);
      const expectedRoot = await canonicalPath(path.join(target.runtimeRoot, 'gateways', target.gatewayID, 'state'));
      if (targetRoot !== expectedRoot) throw new Error('Development Gateway inventory does not match its saved service location.');
      const binary = path.join(targetRoot, 'managed/bin/redeven-gateway');
      try {
        await execute(binary, ['service-stop', '--state-root', targetRoot], { timeout: 30_000 });
        log(`Stopped development Gateway: ${target.gatewayID}`);
      } catch (error) {
        if (error.code !== 'ENOENT') errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Development Gateway cleanup failed.');
    await rm(ledgerPath, { force: true });
    return;
  }
  const targets = current.filter(target => target.enabled);
  if (!targets.length) return;
  const tempRoot = path.join(root, 'desktop/temp');
  await mkdir(tempRoot, { recursive: true });
  if (buildKey !== undefined && !/^[a-f0-9]{64}$/u.test(buildKey)) throw new Error('Invalid development build input key.');
  // The launcher binds source bytes (including dirty files), dependencies,
  // toolchains and settings. The package owner verifies cached archive bytes.
  // Calls without that evidence stay session-local.
  const cacheRoot = buildKey
    ? path.join(root, 'desktop/build-cache/gateways', buildKey)
    : await mkdtemp(path.join(tempRoot, 'gateway-session-'));
  await mkdir(cacheRoot, { recursive: true });
  if (buildKey) {
    // One active launcher owns this profile; retain only its input generation.
    for (const entry of await readdir(path.dirname(cacheRoot), { withFileTypes: true })) {
      if (entry.isDirectory() && /^[a-f0-9]{64}$/u.test(entry.name) && entry.name !== buildKey) {
        await rm(path.join(path.dirname(cacheRoot), entry.name), { recursive: true, force: true });
      }
    }
  }
  const verifySource = dependencies?.verifySourceBuildIdentity ?? verifySourceBuildIdentity;
  let transport;
  try {
    if (buildKey) {
      if (!sourceIdentity) throw new Error('Development source identity is required for a persistent Gateway cache.');
      verifySource(sourceRoot, sourceIdentity);
    }
    const services = dependencies ?? require(path.join(sourceRoot, 'desktop/dist/main/gatewayServiceHost.js'));
    transport = dependencies ? undefined : new (require(path.join(sourceRoot, 'desktop/dist/main/sshTransportManager.js')).DefaultDesktopSSHTransportManager)();
    const owned = new Map(recorded.map(target => [target.stateRoot, target]));
    for (const target of targets) {
      signal?.throwIfAborted();
      owned.set(target.stateRoot, target);
      const temporaryLedger = `${ledgerPath}.tmp`;
      await writeFile(temporaryLedger, JSON.stringify([...owned.values()]), { mode: 0o600 });
      await rename(temporaryLedger, ledgerPath);
      log(`Preparing development Gateway: ${target.gatewayID}`);
      const started = performance.now();
      let lastPhase;
      try { await services.ensureManagedGatewayServiceReady({
        sshTransportManager: transport, sshCredentialScope: target.gatewayID,
        hostAccess: { kind: 'local_host' }, placement: { kind: 'host_process', runtime_root: target.runtimeRoot },
        stateRoot: target.stateRoot, gatewayID: target.gatewayID,
        releaseTag: process.env.REDEVEN_DESKTOP_BUNDLE_VERSION,
        targetCommit: process.env.REDEVEN_DESKTOP_BUNDLE_COMMIT,
        releaseBaseURL: '', sourceRuntimeRoot: sourceRoot,
        assetCacheRoot: cacheRoot, tempRoot, forceUpdate: true, signal,
        onProgress: progress => {
          if (progress.phase === lastPhase) return;
          lastPhase = progress.phase;
          log(`Gateway ${target.gatewayID}: ${progress.title} (${((performance.now() - started) / 1000).toFixed(1)}s)`);
        },
      }); } catch (error) {
        signal?.throwIfAborted();
        log(`Development Gateway unavailable (${target.gatewayID}): ${services.gatewayStartupFailureMessage(error)}`);
        log('Desktop will open. Use Gateways → Refresh for diagnostics, or disable/remove this connection while repairing its local state.');
      }
    }
    if (buildKey) verifySource(sourceRoot, sourceIdentity);
  } catch (error) {
    if (buildKey) await rm(cacheRoot, { recursive: true, force: true });
    throw error;
  } finally {
    await transport?.dispose();
    if (!buildKey) await rm(cacheRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    mode: { type: 'string' }, 'state-root': { type: 'string' }, 'source-root': { type: 'string' }, 'build-key': { type: 'string' }, 'source-identity': { type: 'string' },
  } });
  if (!values['state-root'] || !values['source-root']) throw new Error('Development state and source roots are required.');
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  await runDevelopmentGateways({ mode: values.mode, stateRoot: values['state-root'], sourceRoot: values['source-root'], buildKey: values['build-key'], sourceIdentity: values['source-identity'] ? JSON.parse(values['source-identity']) : undefined, signal: controller.signal });
}
