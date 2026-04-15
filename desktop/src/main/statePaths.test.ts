import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  controlPlaneManagedStateLayout,
  controlPlaneProviderKeyForOrigin,
  defaultManagedStateLayout,
  namedManagedStateLayout,
  stateLayoutForConfigPath,
} from './statePaths';

describe('statePaths', () => {
  it('resolves the default managed state layout under the local default scope', () => {
    expect(defaultManagedStateLayout({ HOME: '/Users/tester' }, () => '/ignored')).toEqual({
      stateRoot: '/Users/tester/.redeven',
      scope: { kind: 'local', name: 'default' },
      scopeKey: 'local/default',
      scopeDir: '/Users/tester/.redeven/scopes/local/default',
      scopeMetadataFile: '/Users/tester/.redeven/scopes/local/default/scope.json',
      configPath: '/Users/tester/.redeven/scopes/local/default/config.json',
      secretsFile: '/Users/tester/.redeven/scopes/local/default/secrets.json',
      lockFile: '/Users/tester/.redeven/scopes/local/default/agent.lock',
      stateDir: '/Users/tester/.redeven/scopes/local/default',
      runtimeStateFile: '/Users/tester/.redeven/scopes/local/default/runtime/local-ui.json',
      diagnosticsDir: '/Users/tester/.redeven/scopes/local/default/diagnostics',
      auditDir: '/Users/tester/.redeven/scopes/local/default/audit',
      appsDir: '/Users/tester/.redeven/scopes/local/default/apps',
      gatewayDir: '/Users/tester/.redeven/scopes/local/default/gateway',
    });
  });

  it('resolves a named managed state layout', () => {
    expect(namedManagedStateLayout('dev-a', { HOME: '/Users/tester' }, () => '/ignored')).toEqual(expect.objectContaining({
      scopeKey: 'named/dev-a',
      configPath: '/Users/tester/.redeven/scopes/named/dev-a/config.json',
      stateDir: '/Users/tester/.redeven/scopes/named/dev-a',
      runtimeStateFile: '/Users/tester/.redeven/scopes/named/dev-a/runtime/local-ui.json',
    }));
  });

  it('resolves a control-plane managed state layout with a derived provider key', () => {
    expect(controlPlaneManagedStateLayout('https://Region.Example.invalid/path', 'env:bad/id', { HOME: '/Users/tester' }, () => '/ignored')).toEqual(expect.objectContaining({
      scopeKey: 'controlplane/https__region.example.invalid/env_bad_id',
      configPath: '/Users/tester/.redeven/scopes/controlplane/https__region.example.invalid/env_bad_id/config.json',
      stateDir: '/Users/tester/.redeven/scopes/controlplane/https__region.example.invalid/env_bad_id',
      runtimeStateFile: '/Users/tester/.redeven/scopes/controlplane/https__region.example.invalid/env_bad_id/runtime/local-ui.json',
    }));
  });

  it('derives the same provider key from a control-plane origin for catalog repair', () => {
    expect(controlPlaneProviderKeyForOrigin('https://Region.Example.invalid/path')).toBe('https__region.example.invalid');
  });

  it('normalizes an explicit config path to an absolute layout', () => {
    const expectedConfigPath = path.resolve('./custom/config.json');
    const expectedStateDir = path.dirname(expectedConfigPath);
    expect(stateLayoutForConfigPath('./desktop/../custom/config.json')).toEqual({
      stateRoot: '',
      scope: null,
      scopeKey: '',
      scopeDir: expectedStateDir,
      scopeMetadataFile: path.join(expectedStateDir, 'scope.json'),
      configPath: expectedConfigPath,
      secretsFile: path.join(expectedStateDir, 'secrets.json'),
      lockFile: path.join(expectedStateDir, 'agent.lock'),
      stateDir: expectedStateDir,
      runtimeStateFile: path.join(expectedStateDir, 'runtime', 'local-ui.json'),
      diagnosticsDir: path.join(expectedStateDir, 'diagnostics'),
      auditDir: path.join(expectedStateDir, 'audit'),
      appsDir: path.join(expectedStateDir, 'apps'),
      gatewayDir: path.join(expectedStateDir, 'gateway'),
    });
  });

  it('fails clearly when no home directory is available for implicit defaults', () => {
    expect(() => defaultManagedStateLayout({}, () => '')).toThrow('user home directory is unavailable');
  });
});
