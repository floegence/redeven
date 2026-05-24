import { describe, expect, it } from 'vitest';

import { DesktopOperationFailureError, desktopOperationFailurePresentation } from './desktopOperationFailure';
import { RuntimeLifecycleWorkflow } from './runtimeLifecycleWorkflow';
import { runtimeLifecyclePlanAfterDecision } from './runtimeLifecycleExecutionPlan';

function workflow(): RuntimeLifecycleWorkflow {
  return new RuntimeLifecycleWorkflow({
    location: 'ssh_host',
    operation: 'restart',
    target_id: 'ssh:devbox',
    target_label: 'Devbox',
    target_detail: 'devbox',
  });
}

describe('RuntimeLifecycleWorkflow', () => {
  it('requires explicit plan commits before helper observations can move to later steps', () => {
    const subject = workflow();

    expect(subject.observeStep('checking_host', 'Checking SSH host')?.progress.active_step_id)
      .toBe('checking_host');
    expect(subject.observeStep('checking_runtime_package', 'Checking runtime')).toBeNull();
    subject.beginStep('checking_runtime_package', 'Checking runtime');
    subject.completeThrough('checking_runtime_package');

    const plan = runtimeLifecyclePlanAfterDecision({
      location: 'ssh_host',
      operation: 'restart',
      decision: 'runtime_running',
    });
    subject.commitPlan({
      state: plan.state,
      steps: plan.steps.map((step) => step.id),
      omitted_steps: plan.omitted_steps,
    });
    expect(subject.beginStep('stopping_runtime_process', 'Stopping runtime').progress.active_step_id)
      .toBe('stopping_runtime_process');
    subject.completeStep('stopping_runtime_process');
    expect(subject.beginStep('verifying_runtime_stopped', 'Verifying stop').progress.active_step_id)
      .toBe('verifying_runtime_stopped');

    expect(subject.observeStep('checking_host', 'Late helper reconnect')).toBeNull();
    expect(subject.progress().active_step_id).toBe('verifying_runtime_stopped');
    expect(subject.progress().steps.map((step) => [step.id, step.status])).toContainEqual([
      'checking_runtime_package',
      'succeeded',
    ]);
  });

  it('anchors failures to the step carried by the error', () => {
    const subject = workflow();
    subject.observeStep('checking_host', 'Checking SSH host');
    subject.beginStep('checking_runtime_package', 'Checking runtime');
    subject.completeThrough('checking_runtime_package');
    const plan = runtimeLifecyclePlanAfterDecision({
      location: 'ssh_host',
      operation: 'update',
      decision: 'runtime_update_required_stopped',
    });
    subject.commitPlan({
      state: plan.state,
      steps: plan.steps.map((step) => step.id),
      omitted_steps: plan.omitted_steps,
    });
    subject.beginStep('detecting_platform', 'Detecting platform');
    subject.completeStep('detecting_platform');
    subject.beginStep('preparing_runtime_package', 'Preparing package');

    const failure = desktopOperationFailurePresentation({
      code: 'operation_failed',
      title: 'Package failed',
      summary: 'Desktop could not prepare the linux/amd64 Redeven runtime package.',
      targetLabel: 'Devbox',
    });
    const stepFailure = subject.failStep(
      new DesktopOperationFailureError(failure, {
        runtimeLifecycleStepID: 'preparing_runtime_package',
      }),
      failure,
    );

    const progress = subject.progress();
    expect(stepFailure.failed_step_id).toBe('preparing_runtime_package');
    expect(progress.active_step_id).toBe('preparing_runtime_package');
    expect(progress.failed_step_id).toBe('preparing_runtime_package');
    expect(progress.steps.map((step) => [step.id, step.status])).toEqual([
      ['checking_host', 'succeeded'],
      ['checking_runtime_package', 'succeeded'],
      ['detecting_platform', 'succeeded'],
      ['preparing_runtime_package', 'failed'],
      ['installing_runtime_package', 'pending'],
      ['starting_runtime_process', 'pending'],
      ['checking_runtime_service', 'pending'],
      ['runtime_ready', 'pending'],
    ]);
  });

  it('rejects terminal success across a pending gap', () => {
    const subject = workflow();

    subject.beginStep('checking_host', 'Checking host');
    expect(() => subject.beginStep('runtime_ready', 'Ready')).toThrow(/not in the current execution plan/iu);
  });

  it('preserves completed step keys and increments the plan revision only for structural changes', () => {
    const subject = workflow();

    subject.beginStep('checking_host', 'Checking SSH host');
    subject.completeStep('checking_host');
    const firstProgress = subject.progress();
    const checkingHostKey = firstProgress.steps[0]?.key;
    const initialRevision = firstProgress.plan_revision;
    const plan = runtimeLifecyclePlanAfterDecision({
      location: 'ssh_host',
      operation: 'restart',
      decision: 'runtime_running',
    });

    subject.commitPlan({
      state: plan.state,
      steps: plan.steps.map((step) => step.id),
      omitted_steps: plan.omitted_steps,
    });
    const expandedProgress = subject.progress();
    expect(expandedProgress.plan_revision).toBe(initialRevision + 1);
    expect(expandedProgress.steps[0]).toEqual(expect.objectContaining({
      id: 'checking_host',
      key: checkingHostKey,
      status: 'succeeded',
    }));
    const unchangedProgress = subject.ensureStepPlanned('stopping_runtime_process', {
      state: plan.state,
      steps: plan.steps.map((step) => step.id),
    });

    expect(unchangedProgress).toBeNull();
    expect(subject.progress().plan_revision).toBe(expandedProgress.plan_revision);
  });
});
