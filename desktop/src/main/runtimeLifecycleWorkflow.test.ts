import { describe, expect, it } from 'vitest';

import { DesktopOperationFailureError, desktopOperationFailurePresentation } from './desktopOperationFailure';
import { RuntimeLifecycleWorkflow } from './runtimeLifecycleWorkflow';

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
  it('keeps helper observations from moving the workflow backwards', () => {
    const subject = workflow();

    expect(subject.observeStep('checking_host', 'Checking SSH host')?.progress.active_step_id)
      .toBe('checking_host');
    expect(subject.observeStep('checking_runtime_package', 'Checking runtime')?.progress.active_step_id)
      .toBe('checking_runtime_package');
    expect(subject.observeStep('stopping_runtime_process', 'Stopping runtime')?.progress.active_step_id)
      .toBe('stopping_runtime_process');
    expect(subject.observeStep('verifying_runtime_stopped', 'Verifying stop')?.progress.active_step_id)
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
    subject.observeStep('checking_runtime_package', 'Checking runtime');
    subject.observeStep('stopping_runtime_process', 'Stopping runtime');
    subject.observeStep('verifying_runtime_stopped', 'Verifying stop');
    subject.observeStep('detecting_platform', 'Detecting platform');

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
      ['stopping_runtime_process', 'succeeded'],
      ['verifying_runtime_stopped', 'succeeded'],
      ['detecting_platform', 'succeeded'],
      ['preparing_runtime_package', 'failed'],
      ['installing_runtime_package', 'pending'],
      ['starting_runtime_process', 'pending'],
      ['checking_runtime_service', 'pending'],
      ['runtime_ready', 'pending'],
    ]);
  });
});
