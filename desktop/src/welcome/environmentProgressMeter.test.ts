import { describe, expect, it } from 'vitest';

import type {
  DesktopLauncherActionProgress,
  DesktopStepProgressStep,
} from '../shared/desktopLauncherIPC';
import { runtimeLifecycleProgress } from '../shared/desktopRuntimeLifecycleProgress';
import {
  environmentProgressMeterPercent,
  environmentProgressStageElapsedSeconds,
} from './environmentProgressMeter';

function gatewayRefreshProgress(input: Readonly<{
  status: DesktopLauncherActionProgress['status'];
  activeStepID: string;
  steps: readonly DesktopStepProgressStep[];
}>): DesktopLauncherActionProgress {
  return {
    action: 'refresh_gateway',
    gateway_id: 'gateway-1',
    operation_key: 'gateway-refresh',
    subject_kind: 'gateway',
    subject_id: 'gateway-1',
    active_progress_surface: 'gateway',
    status: input.status,
    phase: input.activeStepID,
    title: input.status === 'succeeded' ? 'Gateway is ready' : 'Refresh Gateway',
    detail: 'Desktop is refreshing this Gateway.',
    step_progress: {
      active_step_id: input.activeStepID,
      steps: input.steps,
    },
  };
}

function step(id: string, status: DesktopStepProgressStep['status']): DesktopStepProgressStep {
  return {
    id,
    label: id,
    status,
  };
}

function timedStep(
  id: string,
  status: DesktopStepProgressStep['status'],
  startedAtUnixMS: number,
): DesktopStepProgressStep {
  return {
    ...step(id, status),
    started_at_unix_ms: startedAtUnixMS,
  };
}

describe('environmentProgressMeterPercent', () => {
  it('fills the meter for completed step-based Gateway refresh progress', () => {
    expect(environmentProgressMeterPercent(gatewayRefreshProgress({
      status: 'succeeded',
      activeStepID: 'gateway_refreshed',
      steps: [
        step('checking_gateway_service', 'succeeded'),
        step('checking_gateway_package', 'succeeded'),
        step('fetching_pairing_challenge', 'succeeded'),
        step('saving_trust_profile', 'succeeded'),
        step('refreshing_gateway_catalog', 'succeeded'),
        step('gateway_refreshed', 'succeeded'),
      ],
    }))).toBe(100);
  });

  it('uses completed steps plus the active step hint while Gateway refresh is running', () => {
    expect(environmentProgressMeterPercent(gatewayRefreshProgress({
      status: 'running',
      activeStepID: 'fetching_pairing_challenge',
      steps: [
        step('checking_gateway_service', 'succeeded'),
        step('checking_gateway_package', 'succeeded'),
        step('fetching_pairing_challenge', 'running'),
        step('saving_trust_profile', 'pending'),
        step('refreshing_gateway_catalog', 'pending'),
        step('gateway_refreshed', 'pending'),
      ],
    }))).toBe(39);
  });

  it('leaves failed step progress at the completed work instead of filling the meter', () => {
    expect(environmentProgressMeterPercent(gatewayRefreshProgress({
      status: 'failed',
      activeStepID: 'refreshing_gateway_catalog',
      steps: [
        step('checking_gateway_service', 'succeeded'),
        step('checking_gateway_package', 'succeeded'),
        step('fetching_pairing_challenge', 'succeeded'),
        step('saving_trust_profile', 'succeeded'),
        step('refreshing_gateway_catalog', 'failed'),
        step('gateway_refreshed', 'pending'),
      ],
    }))).toBe(67);
  });

  it('keeps lifecycle and Open progress on their existing stage-based meter', () => {
    expect(environmentProgressMeterPercent({
      action: 'open_local_environment',
      environment_id: 'environment-1',
      environment_label: 'Environment',
      operation_key: 'open-environment',
      subject_kind: 'local_environment',
      subject_id: 'environment-1',
      active_progress_surface: 'open',
      status: 'running',
      phase: 'opening_window',
      title: 'Opening environment',
      detail: 'Desktop is opening this environment.',
      open_progress: {
        kind: 'open_connection',
        location: 'local_host',
        phase: 'opening_window',
        stage_index: 3,
        stage_count: 4,
        environment_id: 'environment-1',
        environment_label: 'Environment',
      },
    })).toBe(75);
  });
});

describe('environmentProgressStageElapsedSeconds', () => {
  it('uses the main-process active-step timestamp instead of popup mount time', () => {
    const progress = gatewayRefreshProgress({
      status: 'running',
      activeStepID: 'checking_gateway_package',
      steps: [
        step('checking_gateway_service', 'succeeded'),
        timedStep('checking_gateway_package', 'running', 10_000),
        step('refreshing_gateway_catalog', 'pending'),
      ],
    });

    expect(environmentProgressStageElapsedSeconds(progress, 17_900)).toBe(7);
    expect(environmentProgressStageElapsedSeconds(progress, 25_100)).toBe(15);
  });

  it('does not show a running timer for terminal progress', () => {
    const progress = gatewayRefreshProgress({
      status: 'failed',
      activeStepID: 'checking_gateway_package',
      steps: [timedStep('checking_gateway_package', 'failed', 10_000)],
    });

    expect(environmentProgressStageElapsedSeconds(progress, 25_100)).toBe(0);
  });

  it('uses timing only from the active progress surface', () => {
    const progress: DesktopLauncherActionProgress = {
      ...gatewayRefreshProgress({
        status: 'running',
        activeStepID: 'stale_gateway_step',
        steps: [timedStep('stale_gateway_step', 'running', 16_000)],
      }),
      action: 'update_environment_runtime',
      environment_id: 'environment-1',
      active_progress_surface: 'runtime_lifecycle',
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'local_host',
        operation: 'update',
        phase: 'installing_runtime_package',
        targetLabel: 'Environment',
        stepStates: [{
          id: 'installing_runtime_package',
          status: 'running',
          started_at_unix_ms: 10_000,
        }],
      }),
    };

    expect(environmentProgressStageElapsedSeconds(progress, 17_900)).toBe(7);
  });
});
