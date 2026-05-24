import type {
  DesktopRuntimeLifecycleLocation,
  DesktopRuntimeLifecycleOmittedStep,
  DesktopRuntimeLifecycleOperation,
  DesktopRuntimeLifecyclePlanState,
  DesktopRuntimeLifecycleStepID,
  DesktopRuntimeLifecycleStepState,
} from '../shared/desktopRuntimeLifecycleProgress';

export type RuntimeLifecycleDecision =
  | 'existing_runtime_openable'
  | 'runtime_missing'
  | 'runtime_stopped'
  | 'runtime_running'
  | 'runtime_update_required_running'
  | 'runtime_update_required_stopped'
  | 'runtime_already_current'
  | 'runtime_already_stopped'
  | 'maintenance_restart_required';

export type RuntimeLifecyclePlanInput = Readonly<{
  location: DesktopRuntimeLifecycleLocation;
  operation: DesktopRuntimeLifecycleOperation;
  decision?: RuntimeLifecycleDecision;
}>;

export type RuntimeLifecyclePlanResult = Readonly<{
  state: DesktopRuntimeLifecyclePlanState;
  steps: readonly DesktopRuntimeLifecycleStepState[];
  omitted_steps?: readonly DesktopRuntimeLifecycleOmittedStep[];
}>;

export type RuntimeLifecyclePlanStepInput = RuntimeLifecyclePlanInput & Readonly<{
  currentSteps: readonly DesktopRuntimeLifecycleStepID[];
  step: DesktopRuntimeLifecycleStepID;
}>;

const HOST_PLANNING_STEPS: readonly DesktopRuntimeLifecycleStepID[] = [
  'checking_host',
  'checking_runtime_package',
];

const SSH_CONTAINER_PLANNING_STEPS: readonly DesktopRuntimeLifecycleStepID[] = [
  'checking_host',
  'checking_container',
];

const LOCAL_CONTAINER_PLANNING_STEPS: readonly DesktopRuntimeLifecycleStepID[] = [
  'checking_container',
];

function firstCheckStep(location: DesktopRuntimeLifecycleLocation): DesktopRuntimeLifecycleStepID {
  switch (location) {
    case 'local_host':
      return 'checking_existing_runtime';
    case 'local_container':
      return 'checking_container';
    case 'ssh_host':
      return 'checking_host';
    case 'ssh_container':
      return 'checking_host';
  }
}

function planningStepIDs(
  location: DesktopRuntimeLifecycleLocation,
  operation: DesktopRuntimeLifecycleOperation,
): readonly DesktopRuntimeLifecycleStepID[] {
  if (operation === 'stop') {
    return [firstCheckStep(location)];
  }
  switch (location) {
    case 'local_host':
      return ['checking_existing_runtime'];
    case 'local_container':
      return LOCAL_CONTAINER_PLANNING_STEPS;
    case 'ssh_host':
      return HOST_PLANNING_STEPS;
    case 'ssh_container':
      return SSH_CONTAINER_PLANNING_STEPS;
  }
}

function replacementDecisionStepIDs(location: DesktopRuntimeLifecycleLocation): readonly DesktopRuntimeLifecycleStepID[] {
  if (location === 'ssh_container') {
    return ['checking_host'];
  }
  return planningStepIDs(location, 'start');
}

function packageInstallSteps(): readonly DesktopRuntimeLifecycleStepID[] {
  return [
    'preparing_runtime_package',
    'installing_runtime_package',
  ];
}

function containerPackageProbeSteps(): readonly DesktopRuntimeLifecycleStepID[] {
  return [
    'detecting_platform',
    'checking_runtime_package',
  ];
}

function isContainerLocation(location: DesktopRuntimeLifecycleLocation): boolean {
  return location === 'local_container' || location === 'ssh_container';
}

function startReadySteps(): readonly DesktopRuntimeLifecycleStepID[] {
  return [
    'starting_runtime_process',
    'checking_runtime_service',
    'runtime_ready',
  ];
}

function stopSteps(terminal: DesktopRuntimeLifecycleStepID = 'runtime_stopped'): readonly DesktopRuntimeLifecycleStepID[] {
  return [
    'stopping_runtime_process',
    'verifying_runtime_stopped',
    terminal,
  ];
}

function openableReadySteps(): readonly DesktopRuntimeLifecycleStepID[] {
  return [
    'checking_runtime_service',
    'runtime_ready',
  ];
}

function runtimeUpToDateSteps(): readonly DesktopRuntimeLifecycleStepID[] {
  return [
    'checking_runtime_service',
    'runtime_up_to_date',
  ];
}

function omitted(ids: readonly DesktopRuntimeLifecycleStepID[], reason: DesktopRuntimeLifecycleOmittedStep['reason']): readonly DesktopRuntimeLifecycleOmittedStep[] {
  return ids.map((id) => ({ id, reason }));
}

function stepStates(ids: readonly DesktopRuntimeLifecycleStepID[]): readonly DesktopRuntimeLifecycleStepState[] {
  return ids.map((id, index) => ({
    id,
    key: `runtime-plan:${index}:${id}`,
    status: 'pending',
  }));
}

function uniqueStepIDs(ids: readonly DesktopRuntimeLifecycleStepID[]): readonly DesktopRuntimeLifecycleStepID[] {
  return [...new Set(ids)];
}

function trimCurrentStepsForExpansion(
  currentSteps: readonly DesktopRuntimeLifecycleStepID[],
  step: DesktopRuntimeLifecycleStepID,
): readonly DesktopRuntimeLifecycleStepID[] {
  const index = currentSteps.indexOf(step);
  return index >= 0 ? currentSteps.slice(0, index) : currentSteps;
}

function appendMissing(
  currentSteps: readonly DesktopRuntimeLifecycleStepID[],
  tail: readonly DesktopRuntimeLifecycleStepID[],
): readonly DesktopRuntimeLifecycleStepID[] {
  return uniqueStepIDs([
    ...currentSteps,
    ...tail,
  ]);
}

function startTailFrom(step: DesktopRuntimeLifecycleStepID): readonly DesktopRuntimeLifecycleStepID[] {
  switch (step) {
    case 'starting_runtime_process':
      return startReadySteps();
    case 'checking_runtime_service':
      return ['checking_runtime_service', 'runtime_ready'];
    case 'runtime_ready':
      return ['checking_runtime_service', 'runtime_ready'];
    case 'runtime_up_to_date':
      return runtimeUpToDateSteps();
    default:
      return [];
  }
}

function packageTailFrom(
  location: DesktopRuntimeLifecycleLocation,
  step: DesktopRuntimeLifecycleStepID,
): readonly DesktopRuntimeLifecycleStepID[] {
  switch (step) {
    case 'detecting_platform':
      return isContainerLocation(location)
        ? containerPackageProbeSteps()
        : ['detecting_platform', ...packageInstallSteps(), ...startReadySteps()];
    case 'checking_runtime_package':
      return ['checking_runtime_package'];
    case 'preparing_runtime_package':
      return ['preparing_runtime_package', 'installing_runtime_package', ...startReadySteps()];
    case 'installing_runtime_package':
      return ['installing_runtime_package', ...startReadySteps()];
    default:
      return startTailFrom(step);
  }
}

function stopTailForOperation(
  operation: DesktopRuntimeLifecycleOperation,
  step: DesktopRuntimeLifecycleStepID,
): readonly DesktopRuntimeLifecycleStepID[] {
  const terminal = operation === 'stop' ? 'runtime_stopped' : undefined;
  if (step === 'stopping_runtime_process') {
    return operation === 'stop'
      ? stopSteps()
      : ['stopping_runtime_process', 'verifying_runtime_stopped'];
  }
  if (step === 'verifying_runtime_stopped') {
    return terminal
      ? ['verifying_runtime_stopped', terminal]
      : ['verifying_runtime_stopped'];
  }
  if (step === 'runtime_stopped') {
    return stopSteps();
  }
  return [];
}

export function initialRuntimeLifecyclePlan(input: RuntimeLifecyclePlanInput): RuntimeLifecyclePlanResult {
  return {
    state: 'planning',
    steps: stepStates(planningStepIDs(input.location, input.operation)),
  };
}

export function runtimeLifecyclePlanIncludingStep(input: RuntimeLifecyclePlanStepInput): RuntimeLifecyclePlanResult {
  const currentSteps = trimCurrentStepsForExpansion(input.currentSteps, input.step);
  const explicitStopTail = stopTailForOperation(input.operation, input.step);
  if (explicitStopTail.length > 0) {
    return {
      state: 'executing',
      steps: stepStates(appendMissing(currentSteps, explicitStopTail)),
    };
  }
  const explicitPackageTail = packageTailFrom(input.location, input.step);
  if (explicitPackageTail.length > 0) {
    return {
      state: 'executing',
      steps: stepStates(appendMissing(currentSteps, explicitPackageTail)),
    };
  }
  if (input.currentSteps.includes(input.step)) {
    return {
      state: 'executing',
      steps: stepStates(input.currentSteps),
    };
  }
  return {
    state: 'executing',
    steps: stepStates(appendMissing(currentSteps, [input.step])),
  };
}

export function runtimeLifecyclePlanAfterDecision(input: RuntimeLifecyclePlanInput & Readonly<{
  decision: RuntimeLifecycleDecision;
}>): RuntimeLifecyclePlanResult {
  const planning = planningStepIDs(input.location, input.operation);
  const replacementPlanning = replacementDecisionStepIDs(input.location);
  const firstCheck = firstCheckStep(input.location);

  switch (input.decision) {
    case 'existing_runtime_openable':
      return {
        state: 'executing',
        steps: stepStates([
          ...planning,
          ...openableReadySteps(),
        ]),
        omitted_steps: omitted([
          'stopping_runtime_process',
          'verifying_runtime_stopped',
          'detecting_platform',
          'preparing_runtime_package',
          'installing_runtime_package',
          'starting_runtime_process',
        ], 'runtime_already_openable'),
      };
    case 'runtime_already_current':
      return {
        state: 'executing',
        steps: stepStates([
          ...planning,
          ...runtimeUpToDateSteps(),
        ]),
        omitted_steps: omitted([
          'stopping_runtime_process',
          'verifying_runtime_stopped',
          'detecting_platform',
          'preparing_runtime_package',
          'installing_runtime_package',
          'starting_runtime_process',
        ], 'runtime_package_current'),
      };
    case 'runtime_already_stopped':
      return {
        state: 'executing',
        steps: stepStates([
          firstCheck,
          'runtime_already_stopped',
        ]),
        omitted_steps: omitted([
          'stopping_runtime_process',
          'verifying_runtime_stopped',
        ], 'runtime_already_stopped'),
      };
    case 'runtime_running':
    case 'maintenance_restart_required':
      return {
        state: 'executing',
        steps: stepStates([
          ...replacementPlanning,
          ...stopSteps('verifying_runtime_stopped').slice(0, 2),
        ]),
      };
    case 'runtime_stopped':
      return {
        state: 'executing',
        steps: stepStates(planning),
        omitted_steps: omitted([
          'stopping_runtime_process',
          'verifying_runtime_stopped',
        ], 'runtime_process_absent'),
      };
    case 'runtime_missing':
      return {
        state: 'executing',
        steps: stepStates(planning),
      };
    case 'runtime_update_required_running':
      return {
        state: 'executing',
        steps: stepStates([
          ...replacementPlanning,
          ...stopSteps('verifying_runtime_stopped').slice(0, 2),
        ]),
      };
    case 'runtime_update_required_stopped':
      return {
        state: 'executing',
        steps: stepStates(planning),
        omitted_steps: omitted([
          'stopping_runtime_process',
          'verifying_runtime_stopped',
        ], 'runtime_process_absent'),
      };
  }
}
