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

  it('renders the operation phase history and an indeterminate progress bar while trust is fetched', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginInstallStatus projection={projection(operation('fetch_trust_evidence', {
        phase_diagnostics: [
          {
            phase: 'fetch_trust_evidence',
            artifact_role: 'release_trust',
            attempt: 2,
            progress: { kind: 'indeterminate' },
            cache_hit: false,
            started_at: '2026-08-07T08:00:00Z',
          },
          {
            phase: 'fetch_release_evidence',
            artifact_role: 'release_metadata',
            attempt: 1,
            progress: { kind: 'indeterminate' },
            cache_hit: true,
            started_at: '2026-08-07T08:00:02Z',
            completed_at: '2026-08-07T08:00:03.250Z',
            duration_ms: 1250,
          },
        ],
        updated_at: '2026-08-07T08:00:02Z',
      }))} />
    ), mount);

    expect(mount.querySelector('[data-plugin-install-progress]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-install-progress][role="progressbar"]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-install-phase-duration]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-install-phase="fetch_trust_evidence"]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-install-phase="fetch_release_evidence"]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-install-phase="download_package"]')).not.toBeNull();
    expect(mount.textContent).toContain('uiCopy.plugin.installOperation.phaseCompleted');
    expect(mount.textContent).toContain('2s');
    expect(mount.textContent).toContain('1.25s');
  });

  it('normalizes an unset initial byte count to zero instead of rendering NaN progress', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginInstallStatus projection={projection(operation('download_package', {
        progress: { kind: 'bytes', completed: Number.NaN, total: 405 * 1024 },
      }))} />
    ), mount);

    const progress = mount.querySelector<HTMLElement>('[data-plugin-install-progress]')!;
    expect(progress.getAttribute('aria-valuenow')).toBe('0');
    expect(progress.getAttribute('aria-valuetext')).not.toContain('NaN');
    expect(progress.getAttribute('aria-valuetext')).toContain('0 byte');
  });
});
