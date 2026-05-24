import { describe, expect, it } from 'vitest';

import {
  initialRuntimeLifecyclePlan,
  runtimeLifecyclePlanAfterDecision,
  runtimeLifecyclePlanIncludingStep,
} from './runtimeLifecycleExecutionPlan';

describe('runtimeLifecycleExecutionPlan', () => {
  it('starts restart/update flows with only decision gate steps', () => {
    expect(initialRuntimeLifecyclePlan({
      location: 'ssh_host',
      operation: 'restart',
    }).steps.map((step) => step.id)).toEqual([
      'checking_host',
      'checking_runtime_package',
    ]);
    expect(initialRuntimeLifecyclePlan({
      location: 'local_container',
      operation: 'update',
    }).steps.map((step) => step.id)).toEqual([
      'checking_container',
      'checking_runtime_package',
    ]);
  });

  it('uses short plans for openable and already-current runtimes', () => {
    expect(runtimeLifecyclePlanAfterDecision({
      location: 'ssh_host',
      operation: 'start',
      decision: 'existing_runtime_openable',
    }).steps.map((step) => step.id)).toEqual([
      'checking_host',
      'checking_runtime_package',
      'checking_runtime_service',
      'runtime_ready',
    ]);
    expect(runtimeLifecyclePlanAfterDecision({
      location: 'ssh_host',
      operation: 'update',
      decision: 'runtime_already_current',
    }).steps.map((step) => step.id)).toEqual([
      'checking_host',
      'checking_runtime_package',
      'checking_runtime_service',
      'runtime_up_to_date',
    ]);
  });

  it('does not show stop steps when restart finds no running process', () => {
    const plan = runtimeLifecyclePlanAfterDecision({
      location: 'ssh_host',
      operation: 'restart',
      decision: 'runtime_stopped',
    });

    expect(plan.steps.map((step) => step.id)).toEqual([
      'checking_host',
      'checking_runtime_package',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ]);
    expect(plan.omitted_steps).toEqual([
      { id: 'stopping_runtime_process', reason: 'runtime_process_absent' },
      { id: 'verifying_runtime_stopped', reason: 'runtime_process_absent' },
    ]);
  });

  it('uses a short already-stopped stop plan after a verified stopped state', () => {
    const plan = runtimeLifecyclePlanAfterDecision({
      location: 'local_host',
      operation: 'stop',
      decision: 'runtime_already_stopped',
    });

    expect(plan.steps.map((step) => step.id)).toEqual([
      'checking_existing_runtime',
      'runtime_already_stopped',
    ]);
    expect(plan.omitted_steps).toEqual([
      { id: 'stopping_runtime_process', reason: 'runtime_already_stopped' },
      { id: 'verifying_runtime_stopped', reason: 'runtime_already_stopped' },
    ]);
  });

  it('keeps restart without a running process as start-from-stopped instead of package install', () => {
    const plan = runtimeLifecyclePlanAfterDecision({
      location: 'local_host',
      operation: 'restart',
      decision: 'runtime_stopped',
    });

    expect(plan.steps.map((step) => step.id)).toEqual([
      'checking_existing_runtime',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ]);
    expect(plan.steps.map((step) => step.id)).not.toContain('preparing_runtime_package');
  });

  it('expands a helper-observed package step into the package/start tail', () => {
    const plan = runtimeLifecyclePlanIncludingStep({
      location: 'ssh_host',
      operation: 'start',
      currentSteps: [
        'checking_host',
        'checking_runtime_package',
      ],
      step: 'preparing_runtime_package',
    });

    expect(plan.steps.map((step) => step.id)).toEqual([
      'checking_host',
      'checking_runtime_package',
      'preparing_runtime_package',
      'installing_runtime_package',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ]);
  });
});
