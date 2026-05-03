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
  it('resolves the default managed state layout under the single machine scope', () => {
    expect(defaultManagedStateLayout({ HOME: '/Users/tester' }, () => '/ignored')).toEqual({
      stateRoot: '/Users/tester/.redeven',
      scope: { kind: 'machine', name: 'machine' },
      scopeKey: 'machine',
      scopeDir: '/Users/tester/.redeven/machine',
      scopeMetadataFile: '/Users/tester/.redeven/machine/scope.json',
      configPath: '/Users/tester/.redeven/machine/config.json',
      secretsFile: '/Users/tester/.redeven/machine/secrets.json',
      lockFile: '/Users/tester/.redeven/machine/agent.lock',
      stateDir: '/Users/tester/.redeven/machine',
      runtimeStateFile: '/Users/tester/.redeven/machine/runtime/local-ui.json',
      diagnosticsDir: '/Users/tester/.redeven/machine/diagnostics',
      auditDir: '/Users/tester/.redeven/machine/audit',
      appsDir: '/Users/tester/.redeven/machine/apps',
      gatewayDir: '/Users/tester/.redeven/machine/gateway',
    });
  });

  it('maps a named managed state layout to the same machine scope', () => {
    expect(namedManagedStateLayout('dev-a', { HOME: '/Users/tester' }, () => '/ignored')).toEqual(expect.objectContaining({
      scopeKey: 'machine',
      configPath: '/Users/tester/.redeven/machine/config.json',
      stateDir: '/Users/tester/.redeven/machine',
      runtimeStateFile: '/Users/tester/.redeven/machine/runtime/local-ui.json',
    }));
  });

  it('maps a control-plane managed state layout to the same machine scope', () => {
    expect(controlPlaneManagedStateLayout('https://Region.Example.invalid/path', 'env:bad/id', { HOME: '/Users/tester' }, () => '/ignored')).toEqual(expect.objectContaining({
      scopeKey: 'machine',
      configPath: '/Users/tester/.redeven/machine/config.json',
      stateDir: '/Users/tester/.redeven/machine',
      runtimeStateFile: '/Users/tester/.redeven/machine/runtime/local-ui.json',
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
