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
  'checking_runtime_package',
];

const LOCAL_CONTAINER_PLANNING_STEPS: readonly DesktopRuntimeLifecycleStepID[] = [
  'checking_container',
  'checking_runtime_package',
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

function planningStepIDs(location: DesktopRuntimeLifecycleLocation): readonly DesktopRuntimeLifecycleStepID[] {
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

function packageInstallSteps(): readonly DesktopRuntimeLifecycleStepID[] {
  return [
    'detecting_platform',
    'preparing_runtime_package',
    'installing_runtime_package',
  ];
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

function packageTailFrom(step: DesktopRuntimeLifecycleStepID): readonly DesktopRuntimeLifecycleStepID[] {
  switch (step) {
    case 'detecting_platform':
      return [...packageInstallSteps(), ...startReadySteps()];
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
      : ['stopping_runtime_process', 'verifying_runtime_stopped', ...startReadySteps()];
  }
  if (step === 'verifying_runtime_stopped') {
    return terminal
      ? ['verifying_runtime_stopped', terminal]
      : ['verifying_runtime_stopped', ...startReadySteps()];
  }
  if (step === 'runtime_stopped') {
    return stopSteps();
  }
  return [];
}

export function initialRuntimeLifecyclePlan(input: RuntimeLifecyclePlanInput): RuntimeLifecyclePlanResult {
  return {
    state: 'planning',
    steps: stepStates(planningStepIDs(input.location)),
  };
}

export function runtimeLifecyclePlanIncludingStep(input: RuntimeLifecyclePlanStepInput): RuntimeLifecyclePlanResult {
  if (input.currentSteps.includes(input.step)) {
    return {
      state: 'executing',
      steps: stepStates(input.currentSteps),
    };
  }
  const explicitStopTail = stopTailForOperation(input.operation, input.step);
  if (explicitStopTail.length > 0) {
    return {
      state: 'executing',
      steps: stepStates(appendMissing(input.currentSteps, explicitStopTail)),
    };
  }
  const explicitPackageTail = packageTailFrom(input.step);
  if (explicitPackageTail.length > 0) {
    return {
      state: 'executing',
      steps: stepStates(appendMissing(input.currentSteps, explicitPackageTail)),
    };
  }
  return {
    state: 'executing',
    steps: stepStates(appendMissing(input.currentSteps, [input.step])),
  };
}

export function runtimeLifecyclePlanAfterDecision(input: RuntimeLifecyclePlanInput & Readonly<{
  decision: RuntimeLifecycleDecision;
}>): RuntimeLifecyclePlanResult {
  const planning = planningStepIDs(input.location);
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
          ...planning,
          ...stopSteps('verifying_runtime_stopped').slice(0, 2),
          ...startReadySteps(),
        ]),
      };
    case 'runtime_stopped':
      return {
        state: 'executing',
        steps: stepStates([
          ...planning,
          ...startReadySteps(),
        ]),
        omitted_steps: omitted([
          'stopping_runtime_process',
          'verifying_runtime_stopped',
        ], 'runtime_process_absent'),
      };
    case 'runtime_missing':
      return {
        state: 'executing',
        steps: stepStates([
          ...planning,
          ...packageInstallSteps(),
          ...startReadySteps(),
        ]),
      };
    case 'runtime_update_required_running':
      return {
        state: 'executing',
        steps: stepStates([
          ...planning,
          ...stopSteps('verifying_runtime_stopped').slice(0, 2),
          ...packageInstallSteps(),
          ...startReadySteps(),
        ]),
      };
    case 'runtime_update_required_stopped':
      return {
        state: 'executing',
        steps: stepStates([
          ...planning,
          ...packageInstallSteps(),
          ...startReadySteps(),
        ]),
        omitted_steps: omitted([
          'stopping_runtime_process',
          'verifying_runtime_stopped',
        ], 'runtime_process_absent'),
      };
  }
}
