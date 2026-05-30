import { describe, expect, it } from 'vitest';

import {
  flowerHostStateLayout,
  defaultLocalEnvironmentStateLayout,
  localEnvironmentStateLayout,
} from './statePaths';

describe('statePaths', () => {
  it('resolves the default Local Environment state layout under the single layout', () => {
    expect(defaultLocalEnvironmentStateLayout({ HOME: '/Users/tester' }, () => '/ignored')).toEqual({
      stateRoot: '/Users/tester/.redeven',
      configPath: '/Users/tester/.redeven/local-environment/config.json',
      secretsFile: '/Users/tester/.redeven/local-environment/secrets.json',
      lockFile: '/Users/tester/.redeven/local-environment/agent.lock',
      stateDir: '/Users/tester/.redeven/local-environment',
      runtimeControlSocket: '/Users/tester/.redeven/local-environment/runtime/control.sock',
      diagnosticsDir: '/Users/tester/.redeven/local-environment/diagnostics',
      auditDir: '/Users/tester/.redeven/local-environment/audit',
      appsDir: '/Users/tester/.redeven/local-environment/apps',
      gatewayDir: '/Users/tester/.redeven/local-environment/gateway',
    });
  });

  it('resolves the explicit Local Environment layout helper to the same single layout', () => {
    expect(localEnvironmentStateLayout({ HOME: '/Users/tester' }, () => '/ignored')).toEqual(expect.objectContaining({
      configPath: '/Users/tester/.redeven/local-environment/config.json',
      stateDir: '/Users/tester/.redeven/local-environment',
      runtimeControlSocket: '/Users/tester/.redeven/local-environment/runtime/control.sock',
    }));
  });

  it('fails clearly when no home directory is available for implicit defaults', () => {
    expect(() => defaultLocalEnvironmentStateLayout({}, () => '')).toThrow('user home directory is unavailable');
  });

  it('resolves the independent Flower Host state layout under ~/.redeven/flower', () => {
    expect(flowerHostStateLayout({ HOME: '/Users/tester' }, () => '/ignored')).toEqual({
      stateRoot: '/Users/tester/.redeven',
      stateDir: '/Users/tester/.redeven/flower',
      configPath: '/Users/tester/.redeven/flower/config.json',
      secretsFile: '/Users/tester/.redeven/flower/secrets.json',
      targetCacheFile: '/Users/tester/.redeven/flower/target-cache.json',
      threadsFile: '/Users/tester/.redeven/flower/threads.json',
    });
  });
});
