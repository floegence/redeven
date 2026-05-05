import { describe, expect, it } from 'vitest';

import {
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
      runtimeStateFile: '/Users/tester/.redeven/local-environment/runtime/local-ui.json',
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
      runtimeStateFile: '/Users/tester/.redeven/local-environment/runtime/local-ui.json',
    }));
  });

  it('fails clearly when no home directory is available for implicit defaults', () => {
    expect(() => defaultLocalEnvironmentStateLayout({}, () => '')).toThrow('user home directory is unavailable');
  });
});
