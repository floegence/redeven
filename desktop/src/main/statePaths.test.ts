import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  defaultLocalEnvironmentStateLayout,
  localEnvironmentStateLayout,
  stateLayoutForConfigPath,
} from './statePaths';

describe('statePaths', () => {
  it('resolves the default Local Environment state layout under the single scope', () => {
    expect(defaultLocalEnvironmentStateLayout({ HOME: '/Users/tester' }, () => '/ignored')).toEqual({
      stateRoot: '/Users/tester/.redeven',
      scope: { kind: 'local_environment', name: 'local' },
      scopeKey: 'local_environment',
      scopeDir: '/Users/tester/.redeven/local-environment',
      scopeMetadataFile: '/Users/tester/.redeven/local-environment/scope.json',
      configPath: '/Users/tester/.redeven/local-environment/config.json',
      secretsFile: '/Users/tester/.redeven/local-environment/secrets.json',
      lockFile: '/Users/tester/.redeven/local-environment/agent.lock',
      stateDir: '/Users/tester/.redeven/local-environment',
      runtimeStateFile: '/Users/tester/.redeven/local-environment/runtime/local-ui.json',
      diagnosticsDir: '/Users/tester/.redeven/local-environment/diagnostics',
      auditDir: '/Users/tester/.redeven/local-environment/audit',
      appsDir: '/Users/tester/.redeven/local-environment/apps',
      gatewayDir: '/Users/tester/.redeven/local-environment/gateway',
    });
  });

  it('resolves the explicit Local Environment layout helper to the same single scope', () => {
    expect(localEnvironmentStateLayout({ HOME: '/Users/tester' }, () => '/ignored')).toEqual(expect.objectContaining({
      scopeKey: 'local_environment',
      configPath: '/Users/tester/.redeven/local-environment/config.json',
      stateDir: '/Users/tester/.redeven/local-environment',
      runtimeStateFile: '/Users/tester/.redeven/local-environment/runtime/local-ui.json',
    }));
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
    expect(() => defaultLocalEnvironmentStateLayout({}, () => '')).toThrow('user home directory is unavailable');
  });
});
