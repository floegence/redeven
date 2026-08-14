import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('plugin platform simplification contracts', () => {
  it('keeps runtime recovery exclusively in the ReDevPlugin Host', () => {
    const source = readFileSync(new URL('../EnvAppShell.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('pluginRuntimeRecoveryKnownIdentities');
    expect(source).not.toContain('pluginRuntimeRecoveryFailedInstances');
    expect(source).not.toContain('pluginRuntimeRecoveryAutoCatchupSignatures');
  });
});
