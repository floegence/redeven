import { describe, expect, it } from 'vitest';
import { finishGatewayServiceStepProgress, gatewayServiceStepProgress } from './gatewayServiceProgress';

describe('Gateway service progress', () => {
  it('shows only observed work and keeps its timing through repeated host updates', () => {
    const initial = gatewayServiceStepProgress(undefined, 'checking_gateway_service', 'running', 10);
    const starting = gatewayServiceStepProgress(initial, 'starting_gateway', 'running', 20);
    const repeated = gatewayServiceStepProgress(starting, 'starting_gateway', 'running', 30);
    expect(repeated.steps).toEqual([
      expect.objectContaining({ id: 'checking_gateway_service', status: 'succeeded', started_at_unix_ms: 10 }),
      expect.objectContaining({ id: 'starting_gateway', status: 'running', started_at_unix_ms: 20, label_key: 'progress.startingGatewayService' }),
    ]);
    expect(initial.steps[0].status).toBe('running');
  });

  it.each(['failed', 'canceled', 'succeeded'] as const)('retains the exact final phase on %s', status => {
    const progress = gatewayServiceStepProgress(gatewayServiceStepProgress(undefined, 'preparing_gateway_package'), 'installing_gateway');
    expect(finishGatewayServiceStepProgress(progress, status)).toMatchObject({
      active_step_id: 'installing_gateway', steps: [
        { id: 'preparing_gateway_package', status: 'succeeded' }, { id: 'installing_gateway', status },
      ],
    });
  });

  it('keeps a revisited phase distinct when restart checks the host again', () => {
    const initial = gatewayServiceStepProgress(undefined, 'checking_host', 'running', 10);
    const stopping = gatewayServiceStepProgress(initial, 'stopping_gateway', 'running', 20);
    const checkingAgain = gatewayServiceStepProgress(stopping, 'checking_host', 'running', 30);
    const repeated = gatewayServiceStepProgress(checkingAgain, 'checking_host', 'running', 40);
    expect(new Set(repeated.steps.map(step => step.id)).size).toBe(3);
    expect(repeated.steps.find(step => step.id === repeated.active_step_id)).toMatchObject({
      status: 'running', started_at_unix_ms: 30, label_key: 'progress.checkingHost',
    });
  });
});
