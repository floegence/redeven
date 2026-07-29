import { describe, expect, it } from 'vitest';

import type { PluginExternalPackageSecuritySummary } from './pluginTypes';
import {
  operationImpactGroups,
  securityDeclarationIsSensitive,
  securityDeclarations,
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
  it('preserves added, changed, and removed declarations across updates', () => {
    const previous = summary({
      permissions: [
        { permission_id: 'workspace.read', methods: ['workspace.list'] },
        { permission_id: 'workspace.remove', methods: ['workspace.remove'] },
      ],
    });
    const current = summary({
      permissions: [
        { permission_id: 'workspace.read', methods: ['workspace.list', 'workspace.inspect'] },
        { permission_id: 'workspace.write', methods: ['workspace.write'] },
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
});
