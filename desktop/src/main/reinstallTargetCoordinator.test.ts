import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalRuntimeHostExecutor } from './runtimeHostAccess';
import type { RuntimeHostAccessExecutor } from './runtimeHostAccess';
import {
  ReinstallTargetCoordinator,
  ReinstallTargetCoordinatorError,
  type ReinstallTargetCoordinatorDependencies,
  type ReinstallTargetDescriptor,
  type ReinstallTargetProcessInventory,
} from './reinstallTargetCoordinator';

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-reinstall-target-test-'));
  roots.push(root);
  return root;
}

function descriptor(targetRoot: string): ReinstallTargetDescriptor {
  return {
    environment_id: 'env-local',
    label: 'Test Environment',
    host_access: { kind: 'local_host' },
    placement: { kind: 'host_process', runtime_root: targetRoot },
    affected_environment_ids: ['env-local', 'env-alias'],
  };
}

function emptyInventory(targetRoot: string): ReinstallTargetProcessInventory {
  return {
    schema_version: 1,
    target_root: targetRoot,
    inventory_digest: 'empty',
    instances: [],
    summary: { automatic: 0, blocked: 0 },
  };
}

function coordinatorDependencies(
  journalRoot: string,
  currentDescriptor: () => ReinstallTargetDescriptor,
  events: string[],
): ReinstallTargetCoordinatorDependencies {
  return {
    journal_root: journalRoot,
    resolve_target: async () => currentDescriptor(),
    resolve_candidates: async () => currentDescriptor().affected_environment_ids.map((environmentID) => ({
      ...currentDescriptor(),
      environment_id: environmentID,
      affected_environment_ids: [environmentID],
    })),
    create_executor: () => createLocalRuntimeHostExecutor(),
    inspect_processes: async (_descriptor, targetRoot) => {
      events.push('inventory');
      return emptyInventory(targetRoot);
    },
    stop_processes: async (_descriptor, targetRoot) => {
      events.push('stop');
      return emptyInventory(targetRoot);
    },
    mark_in_progress: async () => { events.push('mark_in_progress'); },
    close_sessions: async () => { events.push('close_sessions'); },
    clear_desktop_state: async () => { events.push('clear_desktop_state'); },
    install_fresh: async (_descriptor, targetRoot) => {
      events.push('install_fresh');
      await fs.writeFile(path.join(targetRoot, 'fresh-component'), 'current');
    },
    verify_fresh_identity: async (_descriptor, targetRoot) => {
      events.push('verify_fresh_identity');
      expect(await fs.readFile(path.join(targetRoot, 'fresh-component'), 'utf8')).toBe('current');
    },
    verify_catalog_and_local_ui: async () => { events.push('verify_catalog_and_local_ui'); },
    clear_completed_marker: async () => { events.push('clear_completed_marker'); },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('ReinstallTargetCoordinator', () => {
  it('replaces the complete exact root and completes without Gateway pairing', async () => {
    const parent = await temporaryRoot();
    const targetRoot = path.join(parent, 'managed-redeven');
    const journalRoot = path.join(parent, 'desktop-maintenance');
    await fs.mkdir(path.join(targetRoot, 'workspace'), { recursive: true });
    await fs.writeFile(path.join(targetRoot, 'workspace', 'old-project'), 'old');
    const current = descriptor(targetRoot);
    const events: string[] = [];
    const coordinator = new ReinstallTargetCoordinator(coordinatorDependencies(journalRoot, () => current, events));

    const preview = await coordinator.preview({ environment_id: current.environment_id });
    expect(preview.target_exists).toBe(true);
    expect(preview.affected_environment_ids).toEqual(['env-alias', 'env-local']);

    const journal = await coordinator.execute(preview.preflight_id);
    expect(events).toEqual([
      'inventory',
      'mark_in_progress',
      'close_sessions',
      'inventory',
      'clear_desktop_state',
      'install_fresh',
      'verify_fresh_identity',
      'verify_catalog_and_local_ui',
      'clear_completed_marker',
    ]);
    await expect(fs.readFile(path.join(targetRoot, 'workspace', 'old-project'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(targetRoot, 'fresh-component'), 'utf8')).resolves.toBe('current');
    await expect(fs.lstat(journal.quarantine_root)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(path.join(journalRoot, `${preview.preflight_id}.json`))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('installs into a missing registered root without manufacturing old state', async () => {
    const parent = await temporaryRoot();
    const targetRoot = path.join(parent, 'missing-redeven');
    const current = descriptor(targetRoot);
    const events: string[] = [];
    const coordinator = new ReinstallTargetCoordinator(coordinatorDependencies(
      path.join(parent, 'journal'),
      () => current,
      events,
    ));

    const preview = await coordinator.preview({ environment_id: current.environment_id });
    expect(preview.target_exists).toBe(false);
    const journal = await coordinator.execute(preview.preflight_id);
    expect(journal.target_existed).toBe(false);
    await expect(fs.readFile(path.join(targetRoot, 'fresh-component'), 'utf8')).resolves.toBe('current');
    await expect(fs.lstat(journal.quarantine_root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps quarantine and never restores old processes when fresh installation fails', async () => {
    const parent = await temporaryRoot();
    const targetRoot = path.join(parent, 'managed-redeven');
    await fs.mkdir(targetRoot);
    await fs.writeFile(path.join(targetRoot, 'old-data'), 'old');
    const current = descriptor(targetRoot);
    const events: string[] = [];
    const dependencies = coordinatorDependencies(path.join(parent, 'journal'), () => current, events);
    const coordinator = new ReinstallTargetCoordinator({
      ...dependencies,
      install_fresh: async () => {
        events.push('install_failed');
        throw new Error('package verification failed');
      },
    });
    const preview = await coordinator.preview({ environment_id: current.environment_id });

    await expect(coordinator.execute(preview.preflight_id)).rejects.toMatchObject({
      code: 'manual_recovery_required',
    });
    const entries = await fs.readdir(parent);
    const quarantine = entries.find((entry) => entry.startsWith('managed-redeven.redeven-quarantine-'));
    expect(quarantine).toBeTruthy();
    await expect(fs.readFile(path.join(parent, quarantine!, 'old-data'), 'utf8')).resolves.toBe('old');
    await expect(fs.lstat(path.join(targetRoot, 'old-data'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(events).not.toContain('stop_old_processes_again');
    expect(events).toContain('mark_in_progress');
    expect(events).not.toContain('clear_completed_marker');
  });

  it('resumes final cleanup without reusing old state when Desktop marker cleanup is interrupted', async () => {
    const parent = await temporaryRoot();
    const targetRoot = path.join(parent, 'managed-redeven');
    await fs.mkdir(targetRoot);
    const current = descriptor(targetRoot);
    const events: string[] = [];
    const dependencies = coordinatorDependencies(path.join(parent, 'journal'), () => current, events);
    let markerAttempts = 0;
    const coordinator = new ReinstallTargetCoordinator({
      ...dependencies,
      clear_completed_marker: async () => {
        markerAttempts++;
        events.push('clear_completed_marker');
        if (markerAttempts === 1) {
          throw new Error('simulated Desktop state interruption');
        }
      },
    });
    const preview = await coordinator.preview({ environment_id: current.environment_id });
    await expect(coordinator.execute(preview.preflight_id)).rejects.toMatchObject({ code: 'manual_recovery_required' });
    expect((await fs.readdir(parent)).some((entry) => entry.startsWith('managed-redeven.redeven-quarantine-'))).toBe(false);
    expect(events.filter((event) => event === 'verify_catalog_and_local_ui')).toHaveLength(1);

    await coordinator.resumeCompletion(preview.preflight_id);
    expect(events.filter((event) => event === 'verify_catalog_and_local_ui')).toHaveLength(1);
    expect(markerAttempts).toBe(2);
  });

  it('fails closed for symlinks, broad roots, old quarantine, and changed targets', async () => {
    const parent = await temporaryRoot();
    const realRoot = path.join(parent, 'real');
    const symlinkRoot = path.join(parent, 'linked');
    await fs.mkdir(realRoot);
    await fs.symlink(realRoot, symlinkRoot);
    const events: string[] = [];
    let current = descriptor(symlinkRoot);
    const coordinator = new ReinstallTargetCoordinator(coordinatorDependencies(path.join(parent, 'journal'), () => current, events));
    await expect(coordinator.preview({ environment_id: current.environment_id })).rejects.toBeInstanceOf(Error);

    current = descriptor(path.parse(parent).root);
    await expect(coordinator.preview({ environment_id: current.environment_id })).rejects.toBeInstanceOf(Error);

    const targetRoot = path.join(parent, 'managed');
    await fs.mkdir(targetRoot);
    await fs.mkdir(`${targetRoot}.redeven-quarantine-previous`);
    current = descriptor(targetRoot);
    await expect(coordinator.preview({ environment_id: current.environment_id })).rejects.toBeInstanceOf(Error);
    await fs.rm(`${targetRoot}.redeven-quarantine-previous`, { recursive: true });

    const preview = await coordinator.preview({ environment_id: current.environment_id });
    current = descriptor(path.join(parent, 'different'));
    await expect(coordinator.execute(preview.preflight_id)).rejects.toBeInstanceOf(ReinstallTargetCoordinatorError);
  });

  it('blocks an ambiguous Redeven inventory before closing sessions', async () => {
    const parent = await temporaryRoot();
    const targetRoot = path.join(parent, 'managed');
    await fs.mkdir(targetRoot);
    const current = descriptor(targetRoot);
    const events: string[] = [];
    const dependencies = coordinatorDependencies(path.join(parent, 'journal'), () => current, events);
    const coordinator = new ReinstallTargetCoordinator({
      ...dependencies,
      inspect_processes: vi.fn(async (): Promise<ReinstallTargetProcessInventory> => ({
        ...emptyInventory(targetRoot),
        instances: [{
          pid: 99,
          process_started_at_unix_ms: 1,
          role: 'gateway',
          executable_path: '/unknown/redeven-gateway',
          identity_status: 'incomplete',
          stop_authority: 'blocked',
        }],
        summary: { automatic: 0, blocked: 1 },
      })),
    });
    await expect(coordinator.preview({ environment_id: current.environment_id })).rejects.toMatchObject({
      code: 'reinstall_blocked',
    });
    expect(events).not.toContain('close_sessions');
  });

  it('groups every Desktop record that resolves to the same canonical physical root', async () => {
    const parent = await temporaryRoot();
    const targetRoot = path.join(parent, 'managed');
    const aliasParent = path.join(parent, 'alias');
    await fs.mkdir(targetRoot);
    await fs.mkdir(aliasParent);
    const selected = {
      ...descriptor(targetRoot),
      affected_environment_ids: ['env-selected'],
      environment_id: 'env-selected',
    };
    const alias = {
      ...descriptor(path.join(aliasParent, '..', 'managed')),
      affected_environment_ids: ['env-alias'],
      environment_id: 'env-alias',
    };
    const events: string[] = [];
    const dependencies = coordinatorDependencies(path.join(parent, 'journal'), () => selected, events);
    const coordinator = new ReinstallTargetCoordinator({
      ...dependencies,
      resolve_candidates: async () => [selected, alias],
    });

    const preview = await coordinator.preview({ environment_id: selected.environment_id });
    expect(preview.target_root).toBe(await fs.realpath(targetRoot));
    expect(preview.affected_environment_ids).toEqual(['env-alias', 'env-selected']);
    const journal = await coordinator.execute(preview.preflight_id);
    expect(journal.affected_environment_ids).toEqual(['env-alias', 'env-selected']);
  });

  it('routes Local, SSH host, local container, and SSH container through their direct executors', async () => {
    const parent = await temporaryRoot();
    const containerID = 'c'.repeat(64);
    const variants: readonly ReinstallTargetDescriptor[] = [{
      ...descriptor('/srv/redeven-local'),
      environment_id: 'local',
      host_access: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '/srv/redeven-local' },
      affected_environment_ids: ['local'],
    }, {
      ...descriptor('/home/ops/.redeven'),
      environment_id: 'ssh',
      host_access: {
        kind: 'ssh_host',
        ssh: { ssh_destination: 'ops@example.internal', ssh_port: null, auth_mode: 'key_agent' },
      },
      placement: { kind: 'host_process', runtime_root: 'remote_default' },
      affected_environment_ids: ['ssh'],
    }, {
      ...descriptor('/srv/redeven-container'),
      environment_id: 'local-container',
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: containerID,
        container_ref: containerID,
        container_label: 'local-container',
        runtime_root: '/srv/redeven-container',
        bridge_strategy: 'exec_stream',
      },
      affected_environment_ids: ['local-container'],
    }, {
      ...descriptor('/srv/redeven-ssh-container'),
      environment_id: 'ssh-container',
      host_access: {
        kind: 'ssh_host',
        ssh: { ssh_destination: 'ops@example.internal', ssh_port: null, auth_mode: 'key_agent' },
      },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: containerID,
        container_ref: containerID,
        container_label: 'ssh-container',
        runtime_root: '/srv/redeven-ssh-container',
        bridge_strategy: 'exec_stream',
      },
      affected_environment_ids: ['ssh-container'],
    }];
    const byID = new Map(variants.map((variant) => [variant.environment_id, variant]));
    const commands = new Map<string, readonly (readonly string[])[]>();
    let activeEnvironmentID = '';
    const dependencies = coordinatorDependencies(
      path.join(parent, 'journal'),
      () => byID.get(activeEnvironmentID)!,
      [],
    );
    const coordinator = new ReinstallTargetCoordinator({
      ...dependencies,
      resolve_target: async ({ environment_id }) => {
        activeEnvironmentID = environment_id;
        return byID.get(environment_id)!;
      },
      resolve_candidates: async () => variants,
      create_executor: (target): RuntimeHostAccessExecutor => {
        const seen: (readonly string[])[] = [];
        commands.set(target.environment_id, seen);
        return {
          host_access: target.host_access,
          run: async (argv) => {
            seen.push(argv);
            if (argv[1] === 'inspect') {
              return {
                stdout: JSON.stringify([{
                  Id: containerID,
                  Name: '/registered',
                  State: { Running: true, Status: 'running' },
                  Config: { Labels: {} },
                }]),
                stderr: '',
              };
            }
            const configuredRoot = argv.at(-2);
            return {
              stdout: `${configuredRoot === 'remote_default' ? '/home/ops/.redeven' : configuredRoot}\n0\n`,
              stderr: '',
            };
          },
          release: async () => undefined,
        };
      },
    });

    const expectedKinds = ['local_host', 'ssh_host', 'local_container', 'ssh_container'] as const;
    let variantIndex = 0;
    for (const target of variants) {
      const preview = await coordinator.preview({ environment_id: target.environment_id });
      expect(preview.target_kind).toBe(expectedKinds[variantIndex]);
      variantIndex++;
      const targetCommands = commands.get(target.environment_id)!;
      if (target.placement.kind === 'container_process') {
        expect(targetCommands[0]).toEqual(['docker', 'inspect', containerID]);
        expect(targetCommands[1]?.slice(0, 4)).toEqual(['docker', 'exec', '-i', containerID]);
        expect(targetCommands).toHaveLength(3);
      } else {
        expect(targetCommands).toHaveLength(2);
        expect(targetCommands[0]?.[0]).toBe('sh');
      }
    }
  });
});
