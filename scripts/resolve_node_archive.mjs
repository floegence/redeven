import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// TLS handshake disconnects use 35; certificate validation errors must stop.
const transientCurlFailures = new Set([6, 7, 18, 28, 35, 52, 55, 56, 92]);
const transientHttpFailures = new Set([408, 429, 500, 502, 503, 504]);
const curlStatusPattern = /\nREDEVEN_CURL_STATUS:(\d{3}):(\d{3})\n$/u;

function curlWithRetry(label, args) {
  // Keep response metadata separate from checksum bytes and download files.
  // http_connect identifies a proxy failure before an HTTPS response exists.
  const requestArgs = ['--write-out', '\nREDEVEN_CURL_STATUS:%{http_code}:%{http_connect}\n', ...args];
  for (let attempt = 1; ; attempt += 1) {
    try {
      const output = execFileSync('curl', requestArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
      if (!curlStatusPattern.test(output)) throw new Error('curl did not report the HTTP response status.');
      return output.replace(curlStatusPattern, '');
    } catch (cause) {
      const status = cause.stdout?.match(curlStatusPattern);
      const httpCode = Number(status?.[1]) || Number(status?.[2]);
      const retryable = httpCode >= 400
        ? [22, 56].includes(cause.status) && transientHttpFailures.has(httpCode)
        : transientCurlFailures.has(cause.status);
      if (attempt === 3 || !retryable) throw cause;
      const delaySeconds = 2 ** (attempt - 1);
      const reason = httpCode >= 400 ? `HTTP ${httpCode}, curl ${cause.status}` : `curl ${cause.status}`;
      console.warn(`[WARN] ${label} interrupted (${reason}); retrying in ${delaySeconds}s, attempt ${attempt + 1}/3.`);
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
    checksums = curlWithRetry('Node checksum retrieval', [...curlArgs, '--silent', '--max-time', '60', `${base}/SHASUMS256.txt`]);
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
      curlWithRetry('Node archive transfer', [...curlArgs, '--progress-bar', '--speed-limit', '1024', '--speed-time', '60', '--continue-at', '-', '--output', partial, `${base}/${archiveName}`]);
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
