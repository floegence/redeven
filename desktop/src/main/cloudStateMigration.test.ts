import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrateDesktopCloudState } from './cloudStateMigration';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-cloud-migration-'));
  roots.push(root);
  return {
    stateRoot: root, preferencesFile: path.join(root, 'preferences.json'),
    secretsFile: path.join(root, 'secrets.json'), localEnvironmentFile: path.join(root, 'local.json'),
    cloudDirectories: [path.join(root, 'catalog')],
  };
}

describe('Cloud state migration', () => {
  it('retains identity keys and encoded secrets and only writes current fields', async () => {
    const options = await fixture();
    await fs.writeFile(options.preferencesFile, JSON.stringify({ version: 15, control_planes: [{
      id: 'stable-old-key', provider: { provider_origin: 'https://redeven.com', provider_id: 'same-id', protocol_version: 'rcpp-v3' },
    }] }));
    await fs.writeFile(options.secretsFile, JSON.stringify({ version: 4, control_planes: {
      'stable-old-key': { provider_origin: 'https://redeven.com', refresh_token: 'opaque-encoded-secret' },
    } }));
    await migrateDesktopCloudState(options);
    expect(JSON.parse(await fs.readFile(options.preferencesFile, 'utf8')).control_planes[0]).toEqual({
      id: 'stable-old-key', cloud: { cloud_origin: 'https://redeven.com', cloud_id: 'same-id', protocol_version: 'rcpp-v4' },
    });
    const secrets = await fs.readFile(options.secretsFile, 'utf8');
    expect(secrets).toContain('opaque-encoded-secret');
    await migrateDesktopCloudState(options);
    expect(await fs.readFile(options.secretsFile, 'utf8')).toBe(secrets);
  });

  it('prevalidates conflicts and unknown versions without modifying any file', async () => {
    const options = await fixture();
    const original = '{"version":15,"provider_origin":"https://redeven.com"}';
    await fs.writeFile(options.preferencesFile, original);
    for (const rejected of [
      { version: 4, provider_id: 'old', cloud_id: 'different' }, { version: 99 },
    ]) {
      const raw = JSON.stringify(rejected);
      await fs.writeFile(options.secretsFile, raw);
      await expect(migrateDesktopCloudState(options)).rejects.toThrow();
      expect(await fs.readFile(options.preferencesFile, 'utf8')).toBe(original);
      expect(await fs.readFile(options.secretsFile, 'utf8')).toBe(raw);
    }
  });

  it('rolls back all original bytes when a file replacement fails', async () => {
    const options = await fixture();
    const before = '{"version":15,"provider_id":"same"}';
    await fs.writeFile(options.preferencesFile, before);
    await fs.writeFile(options.secretsFile, '{"version":4,"provider_id":"same"}');
    const rename = fs.rename.bind(fs);
    let failed = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === options.secretsFile && !failed) { failed = true; throw new Error('replacement denied'); }
      await rename(from, to);
    });
    await expect(migrateDesktopCloudState(options)).rejects.toThrow('replacement denied');
    expect(await fs.readFile(options.preferencesFile, 'utf8')).toBe(before);
    expect(await fs.readFile(options.secretsFile, 'utf8')).toBe('{"version":4,"provider_id":"same"}');
  });
});
