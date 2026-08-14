// @vitest-environment jsdom

import { render } from 'solid-js/web';
import type { PluginExecution } from '@floegence/redevplugin-ui';
import { describe, expect, it, vi } from 'vitest';

import { PluginInstallStatus } from './PluginInstallStatus';
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
    events: [{
      execution_id: 'release_install_1',
      sequence: 1,
      kind: 'progress',
      payload: { phase: 'download_package', progress: { kind: 'bytes', completed: 5, total: 10 } },
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

    expect(progress?.getAttribute('aria-valuenow')).toBe('5');
    expect(progress?.getAttribute('aria-valuemax')).toBe('10');
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
        events: [],
      })}
      onRetry={onRetry}
    />, host);

    (host.querySelector('button') as HTMLButtonElement).click();
    expect(onRetry).toHaveBeenCalledOnce();
    dispose();
    host.remove();
  });
});
