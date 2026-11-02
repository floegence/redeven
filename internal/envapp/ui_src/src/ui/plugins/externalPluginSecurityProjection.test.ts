import { describe, expect, it } from 'vitest';

import type { PluginExternalPackageSecuritySummary } from './pluginTypes';
import {
  operationImpactGroups,
  securityDeclarationIsSensitive,
  securityDeclarations,
  savedDataAccessChange,
} from './externalPluginSecurityProjection';

function summary(overrides: Partial<PluginExternalPackageSecuritySummary> = {}): PluginExternalPackageSecuritySummary {
  return {
    permissions: [],
    methods: [],
    capability_contracts: [],
    workers: [],
    network: [],
    storage: [],
    secret_refs: [],
    core_actions: [],
    intents: [],
    surfaces: [],
    summary_sha256: 'a'.repeat(64),
    ...overrides,
  } as PluginExternalPackageSecuritySummary;
}

function method(name: string, effect: string, dangerous = false, preflightOnly = false) {
  return {
    method: name,
    route: { kind: 'capability', binding_id: 'workspace-v1', target_method: name },
    effect,
    execution: 'sync',
    dangerous,
    preflight_only: preflightOnly,
    required_permissions: [],
    confirmation: { mode: 'none', request_hash_fields: [], plan_hash_required: false },
  } as PluginExternalPackageSecuritySummary['methods'][number];
}

describe('external plugin security projection', () => {
  it('projects signed Surface resources and preserves access changes', () => {
    const surface: PluginExternalPackageSecuritySummary['surfaces'][number] = { surface_id: 'notes.view', kind: 'view' as const, intent: 'primary', label: 'Notes', entry: 'ui/index.html', storage: [{ store_id: 'notes', operations: ['get'] }], settings: ['get'] };
    const previous = summary({ surfaces: [surface] });
    const current = summary({ surfaces: [{ ...surface, storage: [{ store_id: 'notes', operations: ['get', 'put'] }], settings: ['get', 'patch'] }] });
    const [before] = securityDeclarations(previous);
    const [after] = securityDeclarations(current, previous);
    expect(before.facts).toContain('store_id=notes; operations=get');
    expect(before.facts).toContain('settings=get');
    expect(after.facts).toContain('store_id=notes; operations=get, put');
    expect(after.facts).toContain('settings=get, patch');
    expect(after).toMatchObject({ change: 'changed', previousFacts: before.facts });
    expect(securityDeclarationIsSensitive(before)).toBe(false);
    expect(securityDeclarationIsSensitive(after)).toBe(true);
    expect(securityDeclarations(current, current)[0].change).toBeUndefined();
    expect(securityDeclarations(summary(), current)[0].change).toBe('removed');
  });

  it('marks settings-only patch and every Surface storage write as sensitive', () => {
    const surface: PluginExternalPackageSecuritySummary['surfaces'][number] = { surface_id: 'notes.view', kind: 'view' as const, intent: 'primary', label: 'Notes', entry: 'ui/index.html' };
    for (const operation of ['write', 'put', 'delete', 'exec'] as const) {
      const value: PluginExternalPackageSecuritySummary['surfaces'][number] = { ...surface, storage: [{ store_id: 'notes', operations: [operation] }] };
      expect(securityDeclarations(summary({ surfaces: [value] })).filter(securityDeclarationIsSensitive)).toHaveLength(1);
    }
    const value: PluginExternalPackageSecuritySummary['surfaces'][number] = { ...surface, settings: ['patch'] };
    expect(securityDeclarations(summary({ surfaces: [value] })).filter(securityDeclarationIsSensitive)).toHaveLength(1);
  });

  it('does not mark presentation changes as saved-data access changes', () => {
    const surface: PluginExternalPackageSecuritySummary['surfaces'][number] = { surface_id: 'notes.view', kind: 'view' as const, intent: 'primary', label: 'Notes', entry: 'ui/index.html', settings: ['get'] };
    const before = summary({ surfaces: [surface] });
    expect(savedDataAccessChange(securityDeclarations(summary({ surfaces: [{ ...surface, label: 'Documents' }] }), before))).toBeUndefined();
    expect(savedDataAccessChange(securityDeclarations(before, summary()))).toBe('added');
    expect(savedDataAccessChange(securityDeclarations(summary({ surfaces: [{ ...surface, settings: [] }] }), before))).toBe('changed');
  });

  it('binds interval method, period and budget in review differences', () => {
    const background = { strategy: 'interval' as const, worker_id: 'worker', method: 'counter.tick', interval_ms: 60000, max_runtime_ms: 5000 };
    const current = summary({ background });
    const row = securityDeclarations(current, summary())[0];
    expect(row).toMatchObject({ key: 'background:worker', change: 'added', value: background });
    expect(row.facts).toContain('method=counter.tick');
    expect(row.facts).toContain('interval_ms=60000; max_runtime_ms=5000');
    for (const changed of [{ ...background, method: 'counter.refresh' }, { ...background, interval_ms: 120000 }, { ...background, max_runtime_ms: 4000 }]) {
      expect(securityDeclarations(summary({ background: changed }), current)[0]).toMatchObject({ change: 'changed', previousFacts: row.facts });
    }
    expect(securityDeclarations(current, current)[0].change).toBeUndefined();
    expect(securityDeclarations(summary(), current)[0].change).toBe('removed');
  });

  it('preserves exact data-upgrade declarations and detects every relevant change', () => {
    const upgrade = { from: [{ version: '1.0.0', shape_sha256: 'a'.repeat(64) }], method: 'data.convert', max_bytes: 1048576, max_runtime_ms: 3000 };
    const current = summary({ data_upgrade: upgrade });
    const [row] = securityDeclarations(current, summary());
    expect(row).toMatchObject({ key: 'data_upgrade:saved-data', change: 'added', value: upgrade });
    expect(row.facts).toContain('from_version=1.0.0; shape_sha256=' + 'a'.repeat(64));
    expect(row.facts).toContain('max_bytes=1048576; max_runtime_ms=3000');
    expect(securityDeclarationIsSensitive(row)).toBe(true);
    expect(securityDeclarations(current, current)[0].change).toBeUndefined();
    for (const changed of [
      { ...upgrade, method: 'data.convertAgain' },
      { ...upgrade, from: [{ version: '1.0.0', shape_sha256: 'b'.repeat(64) }] },
      { ...upgrade, from: [{ version: '1.1.0', shape_sha256: 'a'.repeat(64) }] },
      { ...upgrade, max_bytes: 2097152 },
      { ...upgrade, max_runtime_ms: 5000 },
    ]) {
      expect(securityDeclarations(summary({ data_upgrade: changed }), current)[0]).toMatchObject({ change: 'changed', previousFacts: row.facts });
    }
    expect(securityDeclarations(summary(), current)[0].change).toBe('removed');
  });

  it('preserves added, changed, and removed declarations across updates', () => {
    const previous = summary({
      permissions: [
        { permission_id: 'workspace.read', methods: ['workspace.list'], required: true, effects: ['read'] },
        { permission_id: 'workspace.remove', methods: ['workspace.remove'], required: true, effects: ['delete'] },
      ],
    });
    const current = summary({
      permissions: [
        { permission_id: 'workspace.read', methods: ['workspace.list', 'workspace.inspect'], required: true, effects: ['read'] },
        { permission_id: 'workspace.write', methods: ['workspace.write'], required: true, effects: ['write'] },
      ],
    });

    expect(securityDeclarations(current, previous).map(({ key, change }) => ({ key, change }))).toEqual([
      { key: 'permissions:workspace.read', change: 'changed' },
      { key: 'permissions:workspace.write', change: 'added' },
      { key: 'permissions:workspace.remove', change: 'removed' },
    ]);
  });

  it('groups operation impact and fails unfamiliar effects into the attention group', () => {
    const groups = operationImpactGroups([
      method('workspace.list', 'read'),
      method('workspace.write', 'write', true),
      method('workspace.preview', 'execute', false, true),
      method('workspace.future', 'future'),
    ]);

    expect(groups).toEqual([
      { effect: 'read', count: 1, dangerousCount: 0, preflightOnlyCount: 0 },
      { effect: 'write', count: 1, dangerousCount: 1, preflightOnlyCount: 0 },
      { effect: 'execute', count: 1, dangerousCount: 0, preflightOnlyCount: 1 },
      { effect: 'other', count: 1, dangerousCount: 0, preflightOnlyCount: 0 },
    ]);
  });

  it('marks non-read methods and writable storage as sensitive', () => {
    const declarations = securityDeclarations(summary({
      methods: [method('workspace.list', 'read'), method('workspace.write', 'write')],
      storage: [{
        store_id: 'workspace-cache',
        kind: 'kv',
        scope: 'environment',
        schema_version: 1,
        quota_bytes: 1024,
        method_access: [{ method: 'workspace.write', operations: ['put'] }],
      }],
    }));

    expect(declarations.filter(securityDeclarationIsSensitive).map((item) => item.key)).toEqual([
      'methods:workspace.write',
      'storage:workspace-cache',
    ]);
  });

  it('projects local process and background declarations as high-attention access', () => {
    const declarations = securityDeclarations(summary({
      process: {
        resource_limits: { output_buffer_bytes: 1024, max_runtime_ms: 5000 },
        method_access: [{ method: 'server.start', operations: ['start', 'read_stdout'] }],
      },
      background: { strategy: 'runtime_start', worker_id: 'server-worker' },
    }));

    expect(declarations.map(({ key }) => key)).toContain('process:local');
    expect(declarations.map(({ key }) => key)).toContain('background:server-worker');
    expect(declarations.filter(securityDeclarationIsSensitive).map(({ key }) => key)).toEqual([
      'process:local',
      'background:server-worker',
    ]);
  });
});
