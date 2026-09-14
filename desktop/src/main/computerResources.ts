import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Resource bytes are bound to the Desktop bundle manifest. Validate the closed
// inventory before any helper runs; no resolver may fall back to source or PATH.
export async function validateComputerResources(root: string, expectedDigest: unknown, platform: string, architecture: string): Promise<void> {
  const resources = path.join(root, 'computer');
  if ((await fs.promises.lstat(resources)).isSymbolicLink()) throw new Error('Computer resource directory must not be a symlink.');
  const bytes = await fs.promises.readFile(path.join(resources, 'manifest.json'));
  if (typeof expectedDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedDigest) || createHash('sha256').update(bytes).digest('hex') !== expectedDigest) {
    throw new Error('Computer resource manifest digest mismatch.');
  }
  const manifest = JSON.parse(bytes.toString('utf8')) as {
    schema_version: number; platform: string; architecture: string; node_version: string;
    files: Array<{ path: string; sha256: string; size_bytes: number; executable: boolean; link_target?: string }>;
  };
  if (manifest.schema_version !== 1 || manifest.platform !== platform || manifest.architecture !== (architecture === 'amd64' ? 'x64' : architecture) || !Array.isArray(manifest.files)) {
    throw new Error('Computer resource manifest target mismatch.');
  }
  const declared = new Map(manifest.files.map(file => [file.path, file]));
  const required = ['node', 'NODE_LICENSE', 'browser.json', 'redevenComputerHost.mjs', 'node_modules/playwright/package.json', 'node_modules/playwright-core/package.json'];
  if (platform === 'darwin') required.push('redeven-computer-host');
  if (declared.size !== manifest.files.length || required.some(name => !declared.has(name))) throw new Error('Computer resource inventory is incomplete.');
  const seen = new Set<string>();
  async function walk(directory: string, prefix = ''): Promise<void> {
    for (const name of await fs.promises.readdir(directory)) {
      const relative = prefix + name;
      const absolute = path.join(directory, name);
      const stat = await fs.promises.lstat(absolute);
      if (stat.isSymbolicLink()) {
        const descriptor = declared.get(relative);
        const link = await fs.promises.readlink(absolute);
        const resolved = await fs.promises.realpath(absolute);
        if (!relative.startsWith('chromium/') || !descriptor || descriptor.link_target !== link || path.isAbsolute(link) || !resolved.startsWith(await fs.promises.realpath(resources) + path.sep)) throw new Error('Computer resource symlink is invalid.');
        seen.add(relative);
        continue;
      }
      if (stat.isDirectory()) { await walk(absolute, relative + '/'); continue; }
      if (relative === 'manifest.json') continue;
      const descriptor = declared.get(relative);
      if (!stat.isFile() || !descriptor || !Number.isSafeInteger(descriptor.size_bytes) || descriptor.size_bytes !== stat.size || typeof descriptor.executable !== 'boolean' || descriptor.executable !== Boolean(stat.mode & 0o111)) {
        throw new Error(`Computer resource inventory mismatch: ${relative}`);
      }
      const digest = createHash('sha256');
      for await (const chunk of fs.createReadStream(absolute)) digest.update(chunk as Buffer);
      if (digest.digest('hex') !== descriptor.sha256) throw new Error(`Computer resource digest mismatch: ${relative}`);
      seen.add(relative);
    }
  }
  await walk(resources);
  if (seen.size !== declared.size) throw new Error('Computer resource inventory contains missing files.');
}
