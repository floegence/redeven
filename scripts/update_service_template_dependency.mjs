#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODULE_PATH = 'github.com/floegence/redeven-service-templates';
export const PUBLIC_GO_ENV = Object.freeze({
  GOENV: 'off', GOWORK: 'off', GOFLAGS: '', GOPROXY: 'https://proxy.golang.org',
  GOSUMDB: 'sum.golang.org', GONOSUMDB: '', GONOPROXY: '', GOPRIVATE: '', GOINSECURE: '',
});
const VERSION = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
export function isFormalVersion(value) { return typeof value === 'string' && VERSION.test(value); }
export function compareVersions(a, b) {
  const left = a.slice(1).split('.').map(BigInt);
  const right = b.slice(1).split('.').map(BigInt);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}
export function selectLatestFormalVersion(versions) {
  if (!Array.isArray(versions) || !versions.every((value) => typeof value === 'string')) throw new Error('invalid proxy version list');
  const eligible = versions.filter(isFormalVersion).sort((a, b) => compareVersions(b, a));
  if (!eligible.length) throw new Error('Go proxy returned no formal service-template release');
  return eligible[0];
}

function goCommand(args, root) {
  try {
    return execFileSync('go', args, {
      cwd: root, env: { ...process.env, ...PUBLIC_GO_ENV }, encoding: 'utf8',
      timeout: 300_000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`go ${args[0]} failed: ${String(error.stderr || error.message).trim()}`, { cause: error });
  }
}

export function assertPublishedDependencyBoundary(root, runGo = goCommand) {
  for (const name of ['go.work', 'go.work.sum', 'vendor']) {
    if (fs.existsSync(path.join(root, name))) throw new Error(`${name} is forbidden for this published module watcher`);
  }
  const document = JSON.parse(runGo(['mod', 'edit', '-json'], root));
  if (document.Replace?.length) throw new Error('Go replace directives are forbidden for published dependency updates');
  const matches = document.Require?.filter((item) => item.Path === MODULE_PATH) ?? [];
  if (matches.length !== 1 || matches[0].Indirect || !isFormalVersion(matches[0].Version)) {
    throw new Error('go.mod must pin one formal direct service-template release');
  }
  return document;
}

function selectedVersion(document) {
  return document.Require.find((item) => item.Path === MODULE_PATH).Version;
}

export function discoverLatest(root, runGo = goCommand) {
  const document = assertPublishedDependencyBoundary(root, runGo);
  const listing = JSON.parse(runGo(['list', '-mod=readonly', '-m', '-json', '-versions', MODULE_PATH], root));
  if (listing.Path !== MODULE_PATH || listing.Replace || listing.Error) throw new Error('unexpected proxy module identity');
  const latest = selectLatestFormalVersion(listing.Versions);
  const current = selectedVersion(document);
  if (compareVersions(latest, current) < 0) throw new Error('proxy latest release regressed behind the pinned version');
  return { current, latest, document };
}

export function verifyPublishedDownload(root, version, runGo = goCommand) {
  if (!isFormalVersion(version)) throw new Error('refusing a non-formal module release');
  // Download outside the module so verification cannot edit go.mod or go.sum.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-catalog-download-'));
  try {
    const downloaded = JSON.parse(runGo(['mod', 'download', '-json', `${MODULE_PATH}@${version}`], temporary));
    const validSum = (sum) => typeof sum === 'string' && /^h1:[A-Za-z0-9+/]{43}=$/u.test(sum);
    if (downloaded.Error || downloaded.Replace || downloaded.Path !== MODULE_PATH || downloaded.Version !== version ||
        !validSum(downloaded.Sum) || !validSum(downloaded.GoModSum)) {
      throw new Error('download did not verify the exact module and go.mod checksums');
    }
    return downloaded;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export function applyUpdate(root, { checkOnly = false, runGo = goCommand } = {}) {
  const discovery = discoverLatest(root, runGo);
  if (checkOnly || discovery.latest === discovery.current) return { ...discovery, changed: false };
  const downloaded = verifyPublishedDownload(root, discovery.latest, runGo);
  const originals = new Map(['go.mod', 'go.sum'].map((name) => [
    name, fs.existsSync(path.join(root, name)) ? fs.readFileSync(path.join(root, name)) : null,
  ]));
  try {
    runGo(['get', `${MODULE_PATH}@${discovery.latest}`], root);
    runGo(['mod', 'tidy'], root);
    const after = assertPublishedDependencyBoundary(root, runGo);
    if (selectedVersion(after) !== discovery.latest) throw new Error('go.mod did not resolve the exact candidate');
    if (after.Go !== discovery.document.Go || after.Toolchain !== discovery.document.Toolchain) {
      throw new Error('catalog release requires a separately reviewed Go toolchain change');
    }
    const otherDirect = (doc) => doc.Require.filter((entry) => entry.Path !== MODULE_PATH && !entry.Indirect)
      .map((entry) => `${entry.Path}@${entry.Version}`).sort().join('\n');
    if (otherDirect(after) !== otherDirect(discovery.document)) throw new Error('catalog update changed another direct dependency');
    const sums = fs.readFileSync(path.join(root, 'go.sum'), 'utf8').split(/\r?\n/u);
    if (!sums.includes(`${MODULE_PATH} ${discovery.latest} ${downloaded.Sum}`) ||
        !sums.includes(`${MODULE_PATH} ${discovery.latest}/go.mod ${downloaded.GoModSum}`)) {
      throw new Error('go.sum is not synchronized with the verified download');
    }
    runGo(['mod', 'verify'], root);
    return { ...discovery, changed: true };
  } catch (error) {
    for (const [name, bytes] of originals) {
      const target = path.join(root, name);
      if (bytes === null) fs.rmSync(target, { force: true });
      else fs.writeFileSync(target, bytes);
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== '--check')) throw new Error('usage: update_service_template_dependency.mjs [--check]');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const result = applyUpdate(root, { checkOnly: args.includes('--check') });
    console.log(`service-template module: current=${result.current} latest=${result.latest} changed=${result.changed}`);
  } catch (error) {
    console.error(`service-template dependency watcher failed: ${error.message}`);
    process.exitCode = 1;
  }
}
