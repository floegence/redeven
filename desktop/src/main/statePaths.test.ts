import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  defaultManagedStateLayout,
  envManagedStateLayout,
  stateLayoutForConfigPath,
} from './statePaths';

describe('statePaths', () => {
  it('resolves the default managed state layout under the redeven home directory', () => {
    expect(defaultManagedStateLayout({ HOME: '/Users/tester' }, () => '/ignored')).toEqual({
      configPath: '/Users/tester/.redeven/config.json',
      stateDir: '/Users/tester/.redeven',
      runtimeStateFile: '/Users/tester/.redeven/runtime/local-ui.json',
    });
  });

  it('resolves an environment-scoped managed state layout with a sanitized environment id', () => {
    expect(envManagedStateLayout('env:bad/id', { HOME: '/Users/tester' }, () => '/ignored')).toEqual({
      configPath: '/Users/tester/.redeven/envs/env_bad_id/config.json',
      stateDir: '/Users/tester/.redeven/envs/env_bad_id',
      runtimeStateFile: '/Users/tester/.redeven/envs/env_bad_id/runtime/local-ui.json',
    });
  });

  it('normalizes an explicit config path to an absolute layout', () => {
    const expectedConfigPath = path.resolve('./custom/config.json');
    expect(stateLayoutForConfigPath('./desktop/../custom/config.json')).toEqual({
      configPath: expectedConfigPath,
      stateDir: path.dirname(expectedConfigPath),
      runtimeStateFile: path.join(path.dirname(expectedConfigPath), 'runtime', 'local-ui.json'),
    });
  });

  it('fails clearly when no home directory is available for implicit defaults', () => {
    expect(() => defaultManagedStateLayout({}, () => '')).toThrow('user home directory is unavailable');
  });
});
