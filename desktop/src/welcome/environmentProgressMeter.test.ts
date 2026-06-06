import { describe, expect, it } from 'vitest';

import type {
  DesktopLauncherActionProgress,
  DesktopStepProgressStep,
} from '../shared/desktopLauncherIPC';
import { environmentProgressMeterPercent } from './environmentProgressMeter';

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
