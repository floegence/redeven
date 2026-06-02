import { describe, expect, it } from 'vitest';

import { DesktopOperationFailureError, desktopOperationFailurePresentation } from './desktopOperationFailure';
import {
  RuntimeLifecycleWorkflow,
  runtimeLifecyclePlanPatchPreservingObservedHistory,
} from './runtimeLifecycleWorkflow';
import {
  runtimeLifecyclePlanAfterDecision,
  runtimeLifecyclePlanIncludingStep,
} from './runtimeLifecycleExecutionPlan';

function workflow(): RuntimeLifecycleWorkflow {
  return new RuntimeLifecycleWorkflow({
    location: 'ssh_host',
    operation: 'restart',
    target_id: 'ssh:devbox',
    target_label: 'Devbox',
    target_detail: 'devbox',
  });
}

function containerWorkflow(): RuntimeLifecycleWorkflow {
  return new RuntimeLifecycleWorkflow({
    location: 'local_container',
    operation: 'update',
    target_id: 'container:dev',
    target_label: 'Dev container',
    target_detail: 'dev',
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
    const platformPlan = runtimeLifecyclePlanIncludingStep({
      location: 'ssh_host',
      operation: 'update',
      currentSteps: subject.currentStepIDs(),
      step: 'detecting_platform',
    });
    subject.ensureStepPlanned('detecting_platform', {
      state: platformPlan.state,
      steps: platformPlan.steps.map((step) => step.id),
      omitted_steps: platformPlan.omitted_steps,
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

  it('allows the container placement helper sequence without treating platform detection as an interrupt', () => {
    const subject = containerWorkflow();

    expect(subject.beginStep('checking_container', 'Checking container').progress.active_step_id)
      .toBe('checking_container');

    const platformPlan = runtimeLifecyclePlanIncludingStep({
      location: 'local_container',
      operation: 'update',
      currentSteps: subject.currentStepIDs(),
      step: 'detecting_platform',
    });
    subject.ensureStepPlanned('detecting_platform', {
      state: platformPlan.state,
      steps: platformPlan.steps.map((step) => step.id),
      omitted_steps: platformPlan.omitted_steps,
    });
    expect(subject.beginStep('detecting_platform', 'Detecting platform').progress.active_step_id)
      .toBe('detecting_platform');

    const runtimeCheckPlan = runtimeLifecyclePlanIncludingStep({
      location: 'local_container',
      operation: 'update',
      currentSteps: subject.currentStepIDs(),
      step: 'checking_runtime_package',
    });
    subject.ensureStepPlanned('checking_runtime_package', {
      state: runtimeCheckPlan.state,
      steps: runtimeCheckPlan.steps.map((step) => step.id),
      omitted_steps: runtimeCheckPlan.omitted_steps,
    });
    expect(subject.beginStep('checking_runtime_package', 'Checking runtime').progress.active_step_id)
      .toBe('checking_runtime_package');

    expect(subject.progress().steps.map((step) => [step.id, step.status])).toEqual([
      ['checking_container', 'succeeded'],
      ['detecting_platform', 'succeeded'],
      ['checking_runtime_package', 'running'],
    ]);

    const installPlan = runtimeLifecyclePlanIncludingStep({
      location: 'local_container',
      operation: 'update',
      currentSteps: subject.currentStepIDs(),
      step: 'preparing_runtime_package',
    });
    subject.ensureStepPlanned('preparing_runtime_package', {
      state: installPlan.state,
      steps: installPlan.steps.map((step) => step.id),
      omitted_steps: installPlan.omitted_steps,
    });
    expect(subject.beginStep('preparing_runtime_package', 'Preparing runtime').progress.active_step_id)
      .toBe('preparing_runtime_package');

    expect(subject.progress().steps.map((step) => [step.id, step.status])).toEqual([
      ['checking_container', 'succeeded'],
      ['detecting_platform', 'succeeded'],
      ['checking_runtime_package', 'succeeded'],
      ['preparing_runtime_package', 'running'],
      ['installing_runtime_package', 'pending'],
      ['starting_runtime_process', 'pending'],
      ['checking_runtime_service', 'pending'],
      ['runtime_ready', 'pending'],
    ]);
  });

  it('rejects beginStep jumps over planned pending steps', () => {
    const subject = containerWorkflow();

    subject.beginStep('checking_container', 'Checking container');
    subject.completeStep('checking_container');
    const platformPlan = runtimeLifecyclePlanIncludingStep({
      location: 'local_container',
      operation: 'update',
      currentSteps: subject.currentStepIDs(),
      step: 'detecting_platform',
    });
    subject.ensureStepPlanned('detecting_platform', {
      state: platformPlan.state,
      steps: platformPlan.steps.map((step) => step.id),
      omitted_steps: platformPlan.omitted_steps,
    });
    const installPlan = runtimeLifecyclePlanIncludingStep({
      location: 'local_container',
      operation: 'update',
      currentSteps: subject.currentStepIDs(),
      step: 'preparing_runtime_package',
    });
    subject.ensureStepPlanned('preparing_runtime_package', {
      state: installPlan.state,
      steps: installPlan.steps.map((step) => step.id),
      omitted_steps: installPlan.omitted_steps,
    });

    expect(subject.progress().steps.map((step) => [step.id, step.status])).toEqual([
      ['checking_container', 'succeeded'],
      ['detecting_platform', 'pending'],
      ['checking_runtime_package', 'pending'],
      ['preparing_runtime_package', 'pending'],
      ['installing_runtime_package', 'pending'],
      ['starting_runtime_process', 'pending'],
      ['checking_runtime_service', 'pending'],
      ['runtime_ready', 'pending'],
    ]);
    expect(() => subject.beginStep('preparing_runtime_package', 'Preparing package'))
      .toThrow(/cannot skip pending step "detecting_platform"/iu);
    expect(subject.progress().active_step_id).toBe('checking_container');
    expect(subject.progress().steps.map((step) => [step.id, step.status])).toContainEqual([
      'checking_container',
      'succeeded',
    ]);
  });

  it('advances external progress to a later observed step without leaving the previous step running', () => {
    const subject = workflow();

    subject.beginStep('checking_host', 'Checking SSH host');
    const servicePlan = runtimeLifecyclePlanIncludingStep({
      location: 'ssh_host',
      operation: 'restart',
      currentSteps: subject.currentStepIDs(),
      step: 'checking_runtime_service',
    });
    subject.ensureStepPlanned('checking_runtime_service', {
      state: servicePlan.state,
      steps: servicePlan.steps.map((step) => step.id),
      omitted_steps: servicePlan.omitted_steps,
    });

    expect(subject.advanceToStep('checking_runtime_service', 'Opening Gateway bridge').progress.active_step_id)
      .toBe('checking_runtime_service');
    expect(subject.progress().steps.map((step) => [step.id, step.status])).toEqual([
      ['checking_host', 'succeeded'],
      ['checking_runtime_package', 'succeeded'],
      ['checking_runtime_service', 'running'],
      ['runtime_ready', 'pending'],
    ]);
  });

  it('preserves completed stop history when a local container update decision moves from running to stopped', () => {
    const subject = containerWorkflow();

    subject.beginStep('checking_container', 'Checking container');
    subject.completeStep('checking_container');
    const runningPlan = runtimeLifecyclePlanAfterDecision({
      location: 'local_container',
      operation: 'update',
      decision: 'runtime_update_required_running',
    });
    subject.commitPlan({
      state: runningPlan.state,
      steps: runningPlan.steps.map((step) => step.id),
      omitted_steps: runningPlan.omitted_steps,
    });
    subject.beginStep('stopping_runtime_process', 'Stopping runtime');
    subject.completeStep('stopping_runtime_process');
    subject.beginStep('verifying_runtime_stopped', 'Verifying stop');
    subject.completeStep('verifying_runtime_stopped');

    const stoppedPlan = runtimeLifecyclePlanAfterDecision({
      location: 'local_container',
      operation: 'update',
      decision: 'runtime_update_required_stopped',
    });
    expect(() => subject.commitPlan({
      state: stoppedPlan.state,
      steps: stoppedPlan.steps.map((step) => step.id),
      omitted_steps: stoppedPlan.omitted_steps,
    })).toThrow(/cannot remove active or completed step "stopping_runtime_process"/iu);

    const stoppedPatch = runtimeLifecyclePlanPatchPreservingObservedHistory({
      currentSteps: subject.stepStates(),
      patch: {
        state: stoppedPlan.state,
        steps: stoppedPlan.steps.map((step) => step.id),
        omitted_steps: stoppedPlan.omitted_steps,
      },
    });
    subject.commitPlan(stoppedPatch);

    expect(subject.progress().steps.map((step) => [step.id, step.status])).toEqual([
      ['checking_container', 'succeeded'],
      ['stopping_runtime_process', 'succeeded'],
      ['verifying_runtime_stopped', 'succeeded'],
    ]);
    const omittedStepIDs = subject.progress().diagnostics?.omitted_steps?.map((step) => step.id) ?? [];
    expect(omittedStepIDs).not.toContain('stopping_runtime_process');
    expect(omittedStepIDs).not.toContain('verifying_runtime_stopped');

    const platformPlan = runtimeLifecyclePlanIncludingStep({
      location: 'local_container',
      operation: 'update',
      currentSteps: subject.currentStepIDs(),
      step: 'detecting_platform',
    });
    subject.ensureStepPlanned('detecting_platform', {
      state: platformPlan.state,
      steps: platformPlan.steps.map((step) => step.id),
      omitted_steps: platformPlan.omitted_steps,
    });
    subject.beginStep('detecting_platform', 'Detecting platform');
    subject.completeStep('detecting_platform');

    const packagePlan = runtimeLifecyclePlanIncludingStep({
      location: 'local_container',
      operation: 'update',
      currentSteps: subject.currentStepIDs(),
      step: 'preparing_runtime_package',
    });
    subject.ensureStepPlanned('preparing_runtime_package', {
      state: packagePlan.state,
      steps: packagePlan.steps.map((step) => step.id),
      omitted_steps: packagePlan.omitted_steps,
    });

    expect(subject.progress().steps.map((step) => [step.id, step.status])).toEqual([
      ['checking_container', 'succeeded'],
      ['stopping_runtime_process', 'succeeded'],
      ['verifying_runtime_stopped', 'succeeded'],
      ['detecting_platform', 'succeeded'],
      ['checking_runtime_package', 'pending'],
      ['preparing_runtime_package', 'pending'],
      ['installing_runtime_package', 'pending'],
      ['starting_runtime_process', 'pending'],
      ['checking_runtime_service', 'pending'],
      ['runtime_ready', 'pending'],
    ]);
  });

  it('does not allow container update to finish as up-to-date after a verified replacement stop', () => {
    const subject = containerWorkflow();

    subject.beginStep('checking_container', 'Checking container');
    subject.completeStep('checking_container');
    const runningPlan = runtimeLifecyclePlanAfterDecision({
      location: 'local_container',
      operation: 'update',
      decision: 'runtime_update_required_running',
    });
    subject.commitPlan({
      state: runningPlan.state,
      steps: runningPlan.steps.map((step) => step.id),
      omitted_steps: runningPlan.omitted_steps,
    });
    subject.beginStep('stopping_runtime_process', 'Stopping runtime');
    subject.completeStep('stopping_runtime_process');
    subject.beginStep('verifying_runtime_stopped', 'Verifying stop');
    subject.completeStep('verifying_runtime_stopped');

    const alreadyCurrentPlan = runtimeLifecyclePlanAfterDecision({
      location: 'local_container',
      operation: 'update',
      decision: 'runtime_already_current',
    });
    expect(() => subject.commitPlan({
      state: alreadyCurrentPlan.state,
      steps: alreadyCurrentPlan.steps.map((step) => step.id),
      omitted_steps: alreadyCurrentPlan.omitted_steps,
    })).toThrow(/cannot remove active or completed step "stopping_runtime_process"/iu);

    const alreadyCurrentPatch = runtimeLifecyclePlanPatchPreservingObservedHistory({
      currentSteps: subject.stepStates(),
      patch: {
        state: alreadyCurrentPlan.state,
        steps: alreadyCurrentPlan.steps.map((step) => step.id),
        omitted_steps: alreadyCurrentPlan.omitted_steps,
      },
    });
    expect(alreadyCurrentPatch.steps).toEqual([
      'checking_container',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'checking_runtime_service',
      'runtime_up_to_date',
    ]);

    const packagePlan = runtimeLifecyclePlanIncludingStep({
      location: 'local_container',
      operation: 'update',
      currentSteps: subject.currentStepIDs(),
      step: 'preparing_runtime_package',
    });
    subject.ensureStepPlanned('preparing_runtime_package', {
      state: packagePlan.state,
      steps: packagePlan.steps.map((step) => step.id),
      omitted_steps: packagePlan.omitted_steps,
    });
    expect(subject.progress().steps.map((step) => step.id)).toContain('starting_runtime_process');
    expect(subject.progress().steps.map((step) => step.id)).not.toContain('runtime_up_to_date');
  });

  it('merges decision plans with observed history without preserving future pending placeholders', () => {
    const patch = {
      state: 'executing' as const,
      steps: [
        'checking_container',
        'checking_container',
        'runtime_ready',
      ] as const,
      omitted_steps: [
        { id: 'stopping_runtime_process' as const, reason: 'runtime_process_absent' as const },
        { id: 'verifying_runtime_stopped' as const, reason: 'runtime_process_absent' as const },
        { id: 'detecting_platform' as const, reason: 'managed_helper_not_required' as const },
      ],
    };
    const input = {
      currentSteps: [
        { id: 'checking_container' as const, status: 'succeeded' as const },
        { id: 'stopping_runtime_process' as const, status: 'running' as const },
        { id: 'verifying_runtime_stopped' as const, status: 'failed' as const },
        { id: 'detecting_platform' as const, status: 'pending' as const },
      ],
      patch,
    };

    const first = runtimeLifecyclePlanPatchPreservingObservedHistory(input);
    const second = runtimeLifecyclePlanPatchPreservingObservedHistory(input);

    expect(second).toEqual(first);
    expect(first.steps).toEqual([
      'checking_container',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'runtime_ready',
    ]);
    expect(first.steps).not.toContain('detecting_platform');
    expect(first.omitted_steps?.map((step) => step.id)).toEqual([
      'detecting_platform',
    ]);
    expect(new Set(first.steps).size).toBe(first.steps.length);
    for (const omitted of first.omitted_steps ?? []) {
      expect(first.steps).not.toContain(omitted.id);
    }
  });

  it('keeps a completed container step active until the next step actually begins', () => {
    const subject = containerWorkflow();

    subject.beginStep('checking_container', 'Checking container');
    const platformPlan = runtimeLifecyclePlanIncludingStep({
      location: 'local_container',
      operation: 'update',
      currentSteps: subject.currentStepIDs(),
      step: 'detecting_platform',
    });
    subject.ensureStepPlanned('detecting_platform', {
      state: platformPlan.state,
      steps: platformPlan.steps.map((step) => step.id),
    });
    subject.beginStep('detecting_platform', 'Detecting platform');
    subject.completeStep('detecting_platform');

    expect(subject.progress()).toEqual(expect.objectContaining({
      phase: 'detecting_platform',
      active_step_id: 'detecting_platform',
      stage_index: 2,
    }));
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
