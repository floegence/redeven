import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export async function validatePackagedRuntime(root) {
  const { loadDesktopBundle } = require('../dist/main/desktopBundle.js');
  return loadDesktopBundle({
    root,
    expectedPlatform: process.platform,
    expectedArchitecture: process.arch === 'x64' ? 'amd64' : process.arch,
  });
}

// Signing changes Mach-O bytes. Update only files visited by the signer, while
// preserving the independently attested ReDevPlugin executable and evidence.
// This runs immediately before the enclosing app's resource seal is signed.
export function refreshSignedRuntimeManifests(root, signedPaths) {
  const manifestPath = path.join(root, 'desktop-bundle-manifest.json');
  const computerPath = path.join(root, 'computer', 'manifest.json');
  const manifest = readJSON(manifestPath);
  const computer = readJSON(computerPath);
  function refresh(directory, files, permitted) {
    return files.map(file => {
      const absolute = path.resolve(directory, file.path);
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink() || Boolean(stat.mode & 0o111) !== file.executable) {
        throw new Error(`Signing changed the bundled file structure: ${file.path}`);
      }
      const sha256 = digest(fs.readFileSync(absolute));
      if (sha256 === file.sha256 && stat.size === file.size_bytes) return file;
      if (!permitted(file.path) || !signedPaths.has(absolute)) {
        throw new Error(`Signing changed an unapproved bundled file: ${file.path}`);
      }
      return { ...file, sha256, size_bytes: stat.size };
    });
  }
  manifest.runtime_files = refresh(root, manifest.runtime_files, name => name === 'redeven');
  computer.files = refresh(path.join(root, 'computer'), computer.files, () => true);
  const computerBytes = Buffer.from(`${JSON.stringify(computer)}\n`);
  manifest.computer_manifest_sha256 = digest(computerBytes);
  const identity = {
    schema_version: 1,
    files: manifest.runtime_files.map(file => ({
      name: file.path, sha256: `sha256:${file.sha256}`, size_bytes: file.size_bytes, executable: file.executable,
    })).sort((a, b) => a.name.localeCompare(b.name)),
  };
  manifest.runtime_files_sha256 = `sha256:${digest(JSON.stringify(identity))}`;
  fs.writeFileSync(computerPath, computerBytes);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function signPackagedRuntime(options) {
  // Use the signing implementation shipped with our locked Electron Builder.
  const { sign } = require('app-builder-lib/out/codeSign/macCodeSign.js');
  const root = path.join(options.app, 'Contents', 'Resources', 'bin');
  await validatePackagedRuntime(root);
  const signedPaths = new Set();
  let sealed = false;
  await sign({
    ...options,
    optionsForFile(file) {
      if (path.resolve(file) === path.resolve(options.app)) {
        refreshSignedRuntimeManifests(root, signedPaths);
        sealed = true;
      } else {
        signedPaths.add(path.resolve(file));
      }
      return options.optionsForFile?.(file) ?? {};
    },
  });
  if (!sealed) throw new Error('Desktop signing did not seal the final Runtime manifests.');
  await validatePackagedRuntime(root);
}
