import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayStore } from './gatewayStore';
import { GatewayEnvironmentMigration, legacyGatewayRuntimeTargetInput } from './gatewayEnvironmentMigration';
import { defaultDesktopPreferences, upsertSavedRuntimeTarget } from './desktopPreferences';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-migration-')); roots.push(root);
  const file = path.join(root, 'gateways.json');
  const source = { schema_version: 2, gateway_id: 'gw_old', runtime_environment_id: 'runtime_old', display_name: 'Existing Runtime',
    local_enabled: true, connection: { kind: 'ssh_host', ssh_destination: 'devbox', runtime_root: '~/.redeven' }, created_at_ms: 10, updated_at_ms: 20 };
  await fs.writeFile(file, JSON.stringify({ schema_version: 2, gateways: [source] }));
  let preferences = defaultDesktopPreferences();
  const options: ConstructorParameters<typeof GatewayEnvironmentMigration>[0] = {
    journalPath: path.join(root, 'migration.json'), store: new GatewayStore(file),
    targetInput: legacy => legacyGatewayRuntimeTargetInput(legacy, () => ''),
    readTargets: async () => preferences.saved_runtime_targets,
    writeTargets: vi.fn(async inputs => {
      for (const input of inputs) preferences = upsertSavedRuntimeTarget(preferences, input);
      return preferences.saved_runtime_targets;
    }),
  };
  return { options, file };
}

describe('Gateway legacy Runtime migration owner', () => {
  it('survives background reads before migration and shares one startup task', async () => {
    const { options, file } = await fixture();
    expect(await options.store.list()).toEqual([]);
    const migration = new GatewayEnvironmentMigration(options);
    await Promise.all([migration.ensureComplete(), migration.ensureComplete()]);
    expect(options.writeTargets).toHaveBeenCalledTimes(1);
    expect(await options.readTargets()).toMatchObject([{ label: 'Existing Runtime', created_at_ms: 10, updated_at_ms: 20, placement: { runtime_root: '~/.redeven' } }]);
    expect((await options.readTargets())[0].placement.runtime_state_root).toBeUndefined();
    expect(await new GatewayStore(file).listLegacyDirectEnvironmentRecords()).toEqual([]);
    await expect(fs.stat(options.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains source records on target write failure and resumes the prepared journal on restart', async () => {
    const { options, file } = await fixture();
    const failed = new GatewayEnvironmentMigration({ ...options, writeTargets: async () => { throw new Error('disk full'); } });
    await expect(failed.ensureComplete()).rejects.toThrow('disk full');
    expect(await new GatewayStore(file).listLegacyDirectEnvironmentRecords()).toHaveLength(1);
    expect(JSON.parse(await fs.readFile(options.journalPath, 'utf8')).phase).toBe('prepared');
    await new GatewayEnvironmentMigration(options).ensureComplete();
    expect(await options.readTargets()).toHaveLength(1);
    expect(await options.store.listLegacyDirectEnvironmentRecords()).toEqual([]);
  });

  it('does not remove the source when target readback is missing or has mismatched coordinates', async () => {
    const { options } = await fixture();
    await expect(new GatewayEnvironmentMigration({ ...options, readTargets: async () => [] }).ensureComplete())
      .rejects.toThrow('complete Runtime target');
    expect(await options.store.listLegacyDirectEnvironmentRecords()).toHaveLength(1);
  });

  it('resumes deletion after target commit without writing a duplicate target', async () => {
    const { options } = await fixture();
    const remove = vi.spyOn(options.store, 'removeMigratedDirectRecords').mockRejectedValueOnce(new Error('interrupted'));
    await expect(new GatewayEnvironmentMigration(options).ensureComplete()).rejects.toThrow('interrupted');
    expect(JSON.parse(await fs.readFile(options.journalPath, 'utf8')).phase).toBe('target_written');
    await new GatewayEnvironmentMigration(options).ensureComplete();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(options.writeTargets).toHaveBeenCalledTimes(1);
    expect(await options.readTargets()).toHaveLength(1);
  });

  it('rejects unknown journals read-only', async () => {
    const { options, file } = await fixture();
    const original = await fs.readFile(file, 'utf8');
    const invalid = '{"schema_version":42,"phase":"prepared","entries":[]}';
    await fs.writeFile(options.journalPath, invalid);
    await expect(new GatewayEnvironmentMigration(options).ensureComplete()).rejects.toThrow('journal is invalid');
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    expect(await fs.readFile(options.journalPath, 'utf8')).toBe(invalid);
  });
  it('retains a source when an existing target has the same id but different coordinates', async () => {
    const { options } = await fixture();
    await expect(new GatewayEnvironmentMigration({ ...options, readTargets: async () => (await options.readTargets()).map(target => ({
      ...target, host_access: { kind: 'ssh_host', ssh: { ssh_destination: 'devbox', ssh_port: null, auth_mode: 'password' } },
    })) }).ensureComplete()).rejects.toThrow('complete Runtime target');
    expect(await options.store.listLegacyDirectEnvironmentRecords()).toHaveLength(1);
  });

  it('preserves password bytes and rejects unavailable configured credentials', async () => {
    const { options } = await fixture();
    const legacy = (await options.store.listLegacyDirectEnvironmentRecords())[0];
    const secured = { ...legacy, record: { ...legacy.record, connection: {
      kind: 'ssh_host' as const, ssh_destination: 'devbox', runtime_root: '/data/runtime',
      auth_mode: 'password' as const, ssh_password_configured: true,
    } } };
    await expect(legacyGatewayRuntimeTargetInput(secured, () => '')).rejects.toThrow('credential is unavailable');
    expect(await legacyGatewayRuntimeTargetInput(secured, () => ' secret with spaces ')).toMatchObject({
      ssh_password: ' secret with spaces ', ssh_password_configured: true,
      created_at_ms: 10, updated_at_ms: 20, placement: { runtime_root: '/data/runtime' },
    });
  });

  it.each(['local_host', 'ssh_host', 'local_container', 'ssh_container'] as const)('keeps %s coordinates and metadata in the Runtime target', async kind => {
    const { options } = await fixture();
    const legacy = (await options.store.listLegacyDirectEnvironmentRecords())[0];
    const connection = { kind, runtime_root: '/data/existing-runtime', ssh_destination: 'bastion',
      container_engine: 'podman' as const, container_id: 'container-id', container_ref: 'stable-name', container_label: 'Workspace' };
    const input = await legacyGatewayRuntimeTargetInput({ ...legacy, record: { ...legacy.record, connection } }, () => '');
    expect(input).toMatchObject({ label: 'Existing Runtime', created_at_ms: 10, updated_at_ms: 20,
      host_access: { kind: kind.startsWith('ssh') ? 'ssh_host' : 'local_host' },
      placement: { kind: kind.endsWith('container') ? 'container_process' : 'host_process', runtime_root: '/data/existing-runtime' } });
    expect(input.placement).not.toHaveProperty('runtime_state_root');
    if (kind.endsWith('container')) expect(input.placement).toMatchObject({ container_id: 'container-id', container_ref: 'stable-name', container_label: 'Workspace' });
  });

});
