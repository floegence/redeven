import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopCloudStateError, validateDesktopCloudState } from './cloudStateValidation';
import { createPlaintextSecretCodec, loadDesktopPreferences } from './desktopPreferences';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-cloud-validation-')); roots.push(root);
  return { stateRoot: root, preferencesFile: path.join(root, 'preferences.json'), secretsFile: path.join(root, 'secrets.json'),
    localEnvironmentFile: path.join(root, 'catalog/local-environment.json'), cloudDirectories: [path.join(root, 'catalog/providers')] };
}

describe('saved Cloud contract validation', () => {
  it.each(['rcpp-v3', 'rcpp-v4', 'rcpp-v6'])('rejects %s without changing configuration or exposing secrets', async protocol => {
    const options = await fixture();
    await fs.mkdir(options.cloudDirectories[0], { recursive: true });
    const file = path.join(options.cloudDirectories[0], 'cloud.json');
    const raw = JSON.stringify({ schema_version: 1, cloud: { protocol_version: protocol }, token: 'do-not-expose' });
    await fs.writeFile(file, raw);
    await expect(loadDesktopPreferences(options, createPlaintextSecretCodec())).rejects.toMatchObject({
      name: 'DesktopCloudStateError', code: 'desktop_cloud_state_invalid', file,
    });
    try { await validateDesktopCloudState(options); } catch (error) {
      expect(error).toBeInstanceOf(DesktopCloudStateError);
      expect((error as Error).message).toContain('expected rcpp-v5');
      expect((error as Error).message).not.toContain('do-not-expose');
    }
    expect(await fs.readFile(file, 'utf8')).toBe(raw);
    await expect(fs.stat(options.preferencesFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts current state and rejects retired fields and malformed input read-only', async () => {
    const options = await fixture();
    const current = '{"version":16,"cloud":{"protocol_version":"rcpp-v5"}}';
    await fs.writeFile(options.preferencesFile, current);
    await validateDesktopCloudState(options);
    expect(await fs.readFile(options.preferencesFile, 'utf8')).toBe(current);
    for (const raw of ['{"version":99}', '{"provider_origin":"old"}', '{"cloud":{"protocol_version":null}}', 'broken secret']) {
      await fs.writeFile(options.secretsFile, raw);
      await expect(validateDesktopCloudState(options)).rejects.toBeInstanceOf(DesktopCloudStateError);
      expect(await fs.readFile(options.preferencesFile, 'utf8')).toBe(current);
      expect(await fs.readFile(options.secretsFile, 'utf8')).toBe(raw);
    }
  });

  it('rejects a retired journal without reading or replaying its payload', async () => {
    const options = await fixture();
    const journal = path.join(options.stateRoot, 'maintenance/cloud-identity-migration.json');
    await fs.mkdir(path.dirname(journal)); await fs.writeFile(journal, 'old secret journal');
    await expect(validateDesktopCloudState(options)).rejects.toMatchObject({ file: journal });
    expect(await fs.readFile(journal, 'utf8')).toBe('old secret journal');
  });
});
