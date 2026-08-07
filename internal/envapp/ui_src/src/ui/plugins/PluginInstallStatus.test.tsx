// @vitest-environment jsdom

import type { PluginReleaseInstallOperation } from '@floegence/redevplugin-ui';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PluginInstallStatus } from './PluginInstallStatus';
import type { PluginInstallOperationProjection } from './pluginTypes';

vi.mock('../i18n', () => ({
  useI18n: () => ({
    locale: () => 'en-US',
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  AlertTriangle: () => <span />,
  CheckCircle: () => <span />,
  Download: () => <span />,
  RefreshIcon: () => <span />,
}));

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

function operation(
  phase: string,
  overrides: Record<string, unknown> = {},
): PluginReleaseInstallOperation {
  return {
    request_id: 'request-install-1',
    operation_id: 'release_install_1',
    plugin_instance_id: 'plugini_example_official_toolbox',
    request_sha256: `sha256:${'a'.repeat(64)}`,
    status: 'running',
    phase,
    progress: { kind: 'indeterminate' },
    attempt: 1,
    retry_after_ms: 250,
    mutation_outcome: 'not_committed',
    activation: { status: 'pending' },
    phase_diagnostics: [],
    created_at: '2026-08-07T08:00:00Z',
    updated_at: '2026-08-07T08:00:01Z',
    ...overrides,
  } as unknown as PluginReleaseInstallOperation;
}

function projection(
  value: PluginReleaseInstallOperation,
): PluginInstallOperationProjection {
  return {
    pluginID: 'com.example.official.toolbox',
    pluginInstanceID: value.plugin_instance_id,
    requestID: value.request_id,
    observation: 'watching',
    operation: value,
  };
}

describe('PluginInstallStatus', () => {
  it.each([
    ['fetch_trust_evidence', 'fetchingTrustEvidence'],
    ['fetch_release_evidence', 'fetchingReleaseEvidence'],
    ['fetch_capability_evidence', 'fetchingCapabilityEvidence'],
    ['verify_hashes', 'verifyingHashes'],
    ['verify_signatures_ledger', 'verifyingSignaturesLedger'],
    ['enable', 'enabling'],
  ])('projects the %s phase without generic verification text', (phase, key) => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => <PluginInstallStatus projection={projection(operation(phase))} />, mount);
    expect(mount.textContent).toContain(`uiCopy.plugin.installOperation.${key}`);
  });

  it('reports a verified cache hit for the current immutable artifact', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginInstallStatus projection={projection(operation('fetch_release_evidence', {
        phase_diagnostics: [{
          phase: 'fetch_release_evidence',
          artifact_role: 'release_metadata',
          attempt: 1,
          progress: { kind: 'indeterminate' },
          cache_hit: true,
          started_at: '2026-08-07T08:00:00Z',
          completed_at: '2026-08-07T08:00:00.050Z',
          duration_ms: 50,
        }],
      }))} />
    ), mount);
    expect(mount.textContent).toContain('uiCopy.plugin.installOperation.cacheHit');
  });
});
