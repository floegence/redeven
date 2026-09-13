import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { withBundledCLIEnvironment } from './desktopProcessEnvironment';

describe('withBundledCLIEnvironment', () => {
  it('injects the bundled CLI and gives its directory PATH precedence', () => {
    const env = withBundledCLIEnvironment({ PATH: '/usr/local/bin', HOME: '/tmp/home' }, '/opt/Redeven/resources/redeven');
    expect(env.REDEVEN_CLI_PATH).toBe(path.resolve('/opt/Redeven/resources/redeven'));
    expect(env.PATH).toBe(`${path.dirname(env.REDEVEN_CLI_PATH!)}${path.delimiter}/usr/local/bin`);
    expect(env.HOME).toBe('/tmp/home');
  });

  it('does not fall back to a system PATH when no PATH was supplied', () => {
    const env = withBundledCLIEnvironment({}, '/opt/redeven/bin/redeven');
    expect(env.PATH).toBe(path.dirname(env.REDEVEN_CLI_PATH!));
  });

  it('rejects an empty executable path', () => {
    expect(() => withBundledCLIEnvironment({}, '')).toThrow('absolute executable path');
  });
});
