import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// TLS handshake disconnects use 35; certificate validation errors must stop.
const transientCurlFailures = new Set([6, 7, 18, 28, 35, 52, 55, 56, 92]);

function curlWithRetry(label, args, options) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return execFileSync('curl', args, options);
    } catch (cause) {
      if (attempt === 3 || !transientCurlFailures.has(cause.status)) throw cause;
      const delaySeconds = 2 ** (attempt - 1);
      console.warn(`[WARN] ${label} interrupted (curl ${cause.status}); retrying in ${delaySeconds}s, attempt ${attempt + 1}/3.`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delaySeconds * 1000);
    }
  }
}

// Only the builder consults this cache. Bundles always contain their own Node.
export function resolveNodeArchive({
  version, platform, arch,
  archivePath = process.env.REDEVEN_NODE_ARCHIVE,
  cacheRoot = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'redeven', 'node-archives'),
}) {
  const archiveName = `node-v${version}-${platform}-${arch}.tar.gz`;
  const base = `https://nodejs.org/dist/v${version}`;
  const curlArgs = ['--fail', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '30'];
  let checksums;
  try {
    checksums = curlWithRetry('Node checksum retrieval', [...curlArgs, '--silent', '--max-time', '60', `${base}/SHASUMS256.txt`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  } catch (cause) {
    throw new Error(`Could not retrieve official Node ${version} checksums. Check access to ${base}/SHASUMS256.txt and rerun the build.`, { cause });
  }
  const digest = checksums.split('\n').map(line => line.trim().split(/\s+/u)).find(parts => parts[1] === archiveName)?.[0];
  if (!/^[a-f0-9]{64}$/u.test(digest ?? '')) throw new Error('Official Node archive checksum is missing.');
  const matches = archive => createHash('sha256').update(readFileSync(archive)).digest('hex') === digest;
  if (archivePath) {
    if (!matches(archivePath)) throw new Error(`Official Node archive checksum mismatch: ${archivePath}`);
    return archivePath;
  }

  mkdirSync(cacheRoot, { recursive: true });
  const archive = path.join(cacheRoot, `${digest}-${archiveName}`);
  if (existsSync(archive)) {
    if (matches(archive)) {
      console.log(`[INFO] Reusing verified official Node ${version} archive for ${platform}/${arch}`);
      return archive;
    }
    console.warn(`[WARN] Removing corrupt Node archive from the build cache: ${archive}`);
    rmSync(archive);
  }

  const downloadRoot = mkdtempSync(path.join(cacheRoot, '.download-'));
  const partial = path.join(downloadRoot, archiveName);
  try {
    console.log(`[INFO] Downloading official Node ${version} for ${platform}/${arch}`);
    try {
      // A progressing transfer has no total deadline; each new attempt resumes
      // only this build's temporary file after a transient transport failure.
      curlWithRetry('Node archive transfer', [...curlArgs, '--progress-bar', '--speed-limit', '1024', '--speed-time', '60', '--continue-at', '-', '--output', partial, `${base}/${archiveName}`], { stdio: ['ignore', 'inherit', 'inherit'] });
    } catch (cause) {
      throw new Error(`Official Node archive download failed for ${archiveName}. Check the connection and rerun the build, or set REDEVEN_NODE_ARCHIVE to a complete official archive.`, { cause });
    }
    if (!matches(partial)) throw new Error(`Official Node archive checksum mismatch: ${archiveName}`);
    renameSync(partial, archive);
    return archive;
  } finally {
    rmSync(downloadRoot, { recursive: true, force: true });
  }
}
