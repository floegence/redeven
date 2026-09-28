import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyDesktopRuntimeSource(manifestPath, runtimeRoot, version, commit) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const normalizeVersion = (value) => String(value).replace(/^v/u, '');
  if (manifest.schema_version !== 5 || manifest.platform !== 'linux' || manifest.architecture !== 'amd64'
    || manifest.provenance !== 'packaged_bundle'
    || manifest.distribution_kind !== 'bundled_host_runtime' || manifest.managed_wsl_runtime !== null
    || normalizeVersion(manifest.version) !== normalizeVersion(version) || manifest.commit !== commit) {
    throw new Error('Linux Runtime source manifest identity does not match the Windows Desktop bundle.');
  }
  const expected = [
    '.redevplugin-release-artifacts-verified.json', 'REDEVPLUGIN_RUNTIME.spdx.json',
    'REDEVPLUGIN_THIRD_PARTY_NOTICES.md', 'redeven', 'redevplugin-runtime',
    'redevplugin-runtime.pem', 'redevplugin-runtime.provenance.json', 'redevplugin-runtime.sig',
  ].sort();
  if (!Array.isArray(manifest.runtime_files)
    || JSON.stringify(manifest.runtime_files.map((file) => file.path).sort()) !== JSON.stringify(expected)) {
    throw new Error('Linux Runtime source manifest inventory is invalid.');
  }
  for (const file of manifest.runtime_files) {
    if (file.executable !== (file.path === 'redeven' || file.path === 'redevplugin-runtime')) {
      throw new Error(`Linux Runtime source manifest executable contract is invalid: ${file.path}`);
    }
    const filename = path.join(runtimeRoot, file.path);
    const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size !== file.size_bytes
        || createHash('sha256').update(readFileSync(fd)).digest('hex') !== file.sha256) {
        throw new Error(`Linux Runtime archive differs from its source manifest: ${file.path}`);
      }
    } finally {
      closeSync(fd);
    }
  }
  const helpers = execFileSync('python3', ['-c', `
import sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
 info=archive.getinfo('manifest.json')
 if info.file_size > 2 * 1024 * 1024: raise ValueError('helper manifest too large')
 sys.stdout.buffer.write(archive.read(info))
`, path.join(runtimeRoot, 'computer.zip')], { maxBuffer: 2 * 1024 * 1024 });
  if (createHash('sha256').update(helpers).digest('hex') !== manifest.computer_manifest_sha256) {
    throw new Error('Linux Runtime helper archive differs from its source manifest.');
  }
  const identity = { schema_version: 1, files: manifest.runtime_files.map((file) => ({
    name: file.path, sha256: `sha256:${file.sha256}`, size_bytes: file.size_bytes, executable: file.executable,
  })).sort((a, b) => a.name.localeCompare(b.name)) };
  if (manifest.runtime_files_sha256 !== `sha256:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`) {
    throw new Error('Linux Runtime source manifest suite digest is invalid.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyDesktopRuntimeSource(...process.argv.slice(2));
}
