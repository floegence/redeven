// @vitest-environment jsdom

import { render } from 'solid-js/web';
import type { PluginExecution } from '@floegence/redevplugin-ui';
import { describe, expect, it, vi } from 'vitest';

import { PluginInstallStatus, PluginInstallSummary } from './PluginInstallStatus';
import type { PluginInstallExecutionProjection } from './pluginTypes';

function execution(overrides: Partial<PluginExecution> = {}): PluginExecution {
  return {
    execution_id: 'release_install_1',
    plugin_instance_id: 'plugini_example',
    kind: 'operation',
    status: 'running',
    cursor: 1,
    cancelable: false,
    created_at: '2026-08-14T00:00:00Z',
    updated_at: '2026-08-14T00:00:01Z',
    ...overrides,
  };
}

function projection(overrides: Partial<PluginInstallExecutionProjection> = {}): PluginInstallExecutionProjection {
  return {
    pluginID: 'com.example.plugin',
    pluginInstanceID: 'plugini_example',
    observation: 'watching',
    execution: execution(),
    progress: [{
      task_id: 'release_install_1',
      request_id: 'request_1',
      stage: 'download',
      status: 'running',
      completed: 5,
      total: 10,
    }],
    ...overrides,
  };
}

describe('PluginInstallStatus', () => {
  it('renders byte progress from the public Event envelope', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <PluginInstallStatus projection={projection()} />, host);
    const progress = host.querySelector('[role="progressbar"]');
    const download = host.querySelector('[data-plugin-install-stage="download"]');

    expect(progress?.getAttribute('aria-valuenow')).toBe('1');
    expect(progress?.getAttribute('aria-valuemax')).toBe('4');
    expect(download?.textContent).toContain('5');
    expect(download?.textContent).toContain('10');
    dispose();
    host.remove();
  });

  it('offers retry for a retryable failed Execution', () => {
    const onRetry = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <PluginInstallStatus
      projection={projection({
        observation: 'failed',
        execution: execution({ status: 'failed', failure_code: 'PLUGIN_RELEASE_NETWORK' }),
        progress: [],
        failure: { source: 'execution', code: 'PLUGIN_RELEASE_NETWORK', stage: 'download', retryable: true, recovery: 'retry_install' },
      })}
      onRetry={onRetry}
    />, host);

    (host.querySelector('button') as HTMLButtonElement).click();
    expect(onRetry).toHaveBeenCalledOnce();
    dispose();
    host.remove();
  });

  it('keeps an unknown platform failure actionable with one retry', () => {
    const onRetry = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <PluginInstallStatus
      projection={projection({
        execution: execution({ status: 'failed', failure_code: 'PLUGIN_INTERNAL_FAILURE' }),
        progress: [],
        failure: { source: 'execution', code: 'PLUGIN_INTERNAL_FAILURE', stage: 'download', retryable: true, recovery: 'retry_install' },
      })}
      onRetry={onRetry}
    />, host);

    const retry = host.querySelector('[data-plugin-install-retry]') as HTMLButtonElement;
    expect(retry).not.toBeNull();
    retry.click();
    expect(onRetry).toHaveBeenCalledOnce();
    dispose();
    host.remove();
  });

  it('explains an incompatible plugin manifest instead of reporting an internal failure', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <PluginInstallStatus
      projection={projection({
        execution: execution({ status: 'failed', failure_code: 'PLUGIN_MANIFEST_INVALID' }),
        progress: [],
        failure: { source: 'execution', code: 'PLUGIN_MANIFEST_INVALID', stage: 'verify', retryable: false, recovery: 'none' },
      })}
    />, host);

    expect(host.textContent).toContain('manifest format');
    expect(host.textContent).not.toContain('internal plugin platform failure');
    dispose();
    host.remove();
  });

  it('explains package validation failures with actionable copy', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <PluginInstallStatus
      projection={projection({
        execution: execution({ status: 'failed', failure_code: 'PLUGIN_PACKAGE_PATH_FORBIDDEN' }),
        progress: [],
        failure: { source: 'execution', code: 'PLUGIN_PACKAGE_PATH_FORBIDDEN', stage: 'verify', retryable: false, recovery: 'none' },
      })}
    />, host);

    expect(host.textContent).toContain('forbidden file path');
    expect(host.textContent).not.toContain('internal plugin platform failure');
    dispose();
    host.remove();
  });

  it('offers the retained-data recovery action only for incompatible historical data', () => {
    const onResolveRetainedData = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <PluginInstallStatus
      projection={projection({
        execution: execution({ status: 'failed', failure_code: 'PLUGIN_RETAINED_DATA_INCOMPATIBLE' }),
        progress: [],
        failure: { source: 'execution', code: 'PLUGIN_RETAINED_DATA_INCOMPATIBLE', stage: 'install', retryable: false, recovery: 'erase_retained_data' },
      })}
      onResolveRetainedData={onResolveRetainedData}
    />, host);

    (host.querySelector('[data-plugin-install-resolve-retained-data]') as HTMLButtonElement).click();
    expect(onResolveRetainedData).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('historical data');
    expect(host.textContent).not.toContain('internal plugin platform failure');
    dispose();
    host.remove();
  });

  it.each([
    ['PLUGIN_RUNTIME_UNAVAILABLE', 'temporarily unavailable'],
    ['PLUGIN_RUNTIME_VERSION_MISMATCH', 'not compatible'],
    ['PLUGIN_FEATURE_NOT_CONFIGURED', 'feature is unavailable'],
    ['PLUGIN_CONTRACT_MISMATCH', 'capability contract'],
  ])('uses the specific runtime and platform copy for %s', (code, copy) => {
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <PluginInstallStatus
      projection={projection({
        execution: execution({ status: 'failed', failure_code: code }),
        progress: [],
        failure: { source: 'execution', code, stage: 'verify', retryable: false, recovery: 'none' },
      })}
    />, host);

    expect(host.textContent).toContain(copy);
    expect(host.textContent).not.toContain('internal plugin platform failure');
    dispose();
    host.remove();
  });

  it('does not invent a failed download stage when the platform provides no stage', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <PluginInstallStatus
      projection={projection({
        execution: execution({ status: 'failed', failure_code: 'PLUGIN_INTERNAL_FAILURE' }),
        progress: [],
        failure: { source: 'execution', code: 'PLUGIN_INTERNAL_FAILURE', retryable: true, recovery: 'retry_install' },
      })}
      onRetry={vi.fn()}
    />, host);

    expect(host.querySelectorAll('[data-plugin-install-stage-status="failed"]')).toHaveLength(0);
    expect(host.querySelector('[data-plugin-install-retry]')).not.toBeNull();
    dispose();
    host.remove();
  });

  it('keeps installation finalization visibly busy after platform installation completed', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <PluginInstallStatus
      projection={projection({
        observation: 'finalizing',
        execution: execution({ status: 'completed', terminal_at: '2026-08-14T00:00:02Z' }),
        progress: [],
      })}
    />, host);

    expect(host.querySelector('[data-plugin-install-execution]')?.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('svg')?.classList.contains('animate-spin')).toBe(true);
    expect(host.textContent).toContain('Finalizing installation...');
    dispose();
    host.remove();
  });

});

describe('PluginInstallSummary', () => {
  it('uses authoritative download bytes and opens details without starting another install', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const onOpenDetails = vi.fn();
    const dispose = render(() => <PluginInstallSummary projection={projection()} onOpenDetails={onOpenDetails} />, host);
    const progress = host.querySelector('[role="progressbar"]')!;
    expect(progress.getAttribute('aria-valuenow')).toBe('5');
    expect(progress.getAttribute('aria-valuemax')).toBe('10');
    expect(progress.getAttribute('aria-label')).toBe('Get package');
    expect(host.textContent).toContain('50%');
    expect(host.querySelector('[data-plugin-install-steps]')).toBeNull();
    const details = host.querySelector<HTMLButtonElement>('[data-plugin-center-install-summary]')!;
    details.click();
    expect(onOpenDetails).toHaveBeenCalledWith(details);
    dispose();
    host.remove();
  });

  it('reports a stage without inventing a completion percentage or counting the running stage as complete', () => {
    const host = document.createElement('div');
    const dispose = render(() => <PluginInstallSummary projection={projection({
      progress: [{ task_id: 'task', request_id: 'request', stage: 'verify', status: 'running' }],
    })} onOpenDetails={vi.fn()} />, host);
    expect(host.textContent).toContain('Security check');
    expect(host.textContent).toContain('2 / 4');
    expect(host.textContent).not.toContain('%');
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('1');
    dispose();
  });

  it.each(['finalizing', 'reconnecting'] as const)('keeps %s visibly busy even with a completed Execution', (observation) => {
    const host = document.createElement('div');
    const dispose = render(() => <PluginInstallSummary projection={projection({
      observation, execution: execution({ status: 'completed' }),
    })} onOpenDetails={vi.fn()} />, host);
    expect(host.querySelector('[data-plugin-install-summary]')?.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('svg')?.classList.contains('animate-spin')).toBe(true);
    expect(host.textContent).not.toContain('%');
    dispose();
  });

  it.each(['review_again', 'erase_retained_data'] as const)('preserves the exact %s recovery action', (recovery) => {
    const host = document.createElement('div');
    document.body.append(host);
    const onReviewAgain = vi.fn();
    const onResolveRetainedData = vi.fn();
    const onRetry = vi.fn();
    const dispose = render(() => <PluginInstallSummary projection={projection({
      observation: 'failed', execution: execution({ status: 'failed' }),
      failure: { source: 'execution', code: 'PLUGIN_RETAINED_DATA_INCOMPATIBLE', retryable: false, recovery },
    })} onOpenDetails={vi.fn()} onRetry={onRetry} onReviewAgain={onReviewAgain} onResolveRetainedData={onResolveRetainedData} />, host);
    const action = host.querySelector<HTMLButtonElement>(recovery === 'review_again' ? '[data-plugin-install-review-again]' : '[data-plugin-install-resolve-retained-data]')!;
    expect(action.getAttribute('aria-label')).toBeTruthy();
    action.click();
    expect(recovery === 'review_again' ? onReviewAgain : onResolveRetainedData).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
    dispose();
    host.remove();
  });

  it('keeps terminal failures readable in details without offering an unsupported retry', () => {
    const host = document.createElement('div');
    const dispose = render(() => <PluginInstallSummary projection={projection({
      observation: 'failed', execution: execution({ status: 'failed', failure_code: 'PLUGIN_MANIFEST_INVALID' }),
      failure: { source: 'execution', code: 'PLUGIN_MANIFEST_INVALID', retryable: false, recovery: 'none' },
    })} onOpenDetails={vi.fn()} onRetry={vi.fn()} />, host);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('[data-plugin-install-retry]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[data-plugin-center-install-summary]')?.title).toContain('manifest format');
    dispose();
  });
});
