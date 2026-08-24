import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import { gatewayServiceBinaryPath } from './gatewayServiceHost';

describe('gatewayServiceHost', () => {
  it('keeps the standalone Gateway binary inside its own state root', () => {
    expect(gatewayServiceBinaryPath('/srv/redeven-gateway/state')).toBe(
      '/srv/redeven-gateway/state/managed/bin/redeven-gateway',
    );
  });

  it('does not install or start Gateway through a Runtime root', () => {
    const source = fs.readFileSync(new URL('./gatewayServiceHost.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('/gateway/managed');
    expect(source).not.toContain('--runtime-root "$runtime_root"');
    expect(source).toContain('managed_root="${state_root%/}/managed"');
  });
});
