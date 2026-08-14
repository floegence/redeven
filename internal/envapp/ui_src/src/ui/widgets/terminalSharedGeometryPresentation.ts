export type TerminalGridSize = Readonly<{
  cols: number;
  rows: number;
}>;

export type TerminalEffectiveGeometry = TerminalGridSize & Readonly<{
  lifecycleEpoch: number;
  generation: number;
  presentationSequence: number;
}>;

export type TerminalAppliedGeometry = TerminalEffectiveGeometry & Readonly<{
  rendererEpoch: number;
}>;

export type TerminalSharedGeometryPresentation = Readonly<{
  lifecycleEpoch: number;
  rendererEpoch: number;
  requestEpoch: number;
  local: TerminalGridSize;
  effective: TerminalAppliedGeometry;
}>;

export type TerminalGeometryRequestContext = Readonly<{
  lifecycleEpoch: number;
  rendererEpoch: number;
  requestEpoch: number;
  callSequence: number;
  runtimeAttachGeneration: number;
  requested: TerminalGridSize;
  reassertion: boolean;
}>;

export type TerminalGeometryPresentationState = Readonly<{
  lifecycleEpoch: number;
  rendererEpoch: number;
  requestEpoch: number;
  observedLocal: TerminalGridSize | null;
  acknowledgedLocal: (TerminalGridSize & Readonly<{
    lifecycleEpoch: number;
    rendererEpoch: number;
    requestEpoch: number;
    effectiveGeneration: number;
  }>) | null;
  knownEffective: TerminalEffectiveGeometry | null;
  appliedEffective: TerminalAppliedGeometry | null;
  presentedEffective: TerminalAppliedGeometry | null;
  geometryChangingResizePending: boolean;
  presentation: TerminalSharedGeometryPresentation | null;
}>;

type TimerHandle = ReturnType<typeof setTimeout>;

export type TerminalGeometryPresentationControllerOptions = Readonly<{
  onPresentation: (presentation: TerminalSharedGeometryPresentation | null) => void;
  appearanceDelayMs?: number;
  equalRemovalDelayMs?: number;
}>;

function validGrid(size: TerminalGridSize): boolean {
  return Number.isSafeInteger(size.cols) && size.cols > 0
    && Number.isSafeInteger(size.rows) && size.rows > 0;
}

function sameGrid(left: TerminalGridSize | null, right: TerminalGridSize | null): boolean {
  return Boolean(left && right && left.cols === right.cols && left.rows === right.rows);
}

function sameEffective(
  left: TerminalEffectiveGeometry | TerminalAppliedGeometry | null,
  right: TerminalEffectiveGeometry | TerminalAppliedGeometry | null,
): boolean {
  return Boolean(left && right
    && left.lifecycleEpoch === right.lifecycleEpoch
    && left.generation === right.generation
    && left.presentationSequence === right.presentationSequence
    && left.cols === right.cols
    && left.rows === right.rows);
}

function isConstrained(effective: TerminalGridSize, local: TerminalGridSize): boolean {
  return effective.cols < local.cols || effective.rows < local.rows;
}

export function createTerminalGeometryPresentationController(
  options: TerminalGeometryPresentationControllerOptions,
) {
  const appearanceDelayMs = options.appearanceDelayMs ?? 350;
  const equalRemovalDelayMs = options.equalRemovalDelayMs ?? 250;
  let lifecycleEpoch = 0;
  let rendererEpoch = 0;
  let requestEpoch = 0;
  let callSequence = 0;
  let latestCallSequence = 0;
  let activeRuntimeAttachGeneration = 0;
  let eligible = false;
  let observedLocal: TerminalGridSize | null = null;
  let acknowledgedLocal: TerminalGeometryPresentationState['acknowledgedLocal'] = null;
  let knownEffective: TerminalEffectiveGeometry | null = null;
  let appliedEffective: TerminalAppliedGeometry | null = null;
  let presentedEffective: TerminalAppliedGeometry | null = null;
  let geometryChangingResizePending = false;
  let appearanceTimer: TimerHandle | null = null;
  let removalTimer: TimerHandle | null = null;
  let published: TerminalSharedGeometryPresentation | null = null;

  const cancelAppearance = () => {
    if (appearanceTimer !== null) clearTimeout(appearanceTimer);
    appearanceTimer = null;
  };
  const cancelRemoval = () => {
    if (removalTimer !== null) clearTimeout(removalTimer);
    removalTimer = null;
  };
  const publish = (next: TerminalSharedGeometryPresentation | null) => {
    const unchanged = published === null
      ? next === null
      : Boolean(next
        && published.lifecycleEpoch === next.lifecycleEpoch
        && published.rendererEpoch === next.rendererEpoch
        && published.requestEpoch === next.requestEpoch
        && sameGrid(published.local, next.local)
        && sameEffective(published.effective, next.effective));
    if (unchanged) return;
    published = next;
    options.onPresentation(next);
  };
  const hideImmediately = () => {
    cancelAppearance();
    cancelRemoval();
    presentedEffective = null;
    publish(null);
  };
  const buildPresentation = (
    effective: TerminalAppliedGeometry,
  ): TerminalSharedGeometryPresentation | null => {
    const local = observedLocal;
    if (!local) return null;
    return {
      lifecycleEpoch,
      rendererEpoch,
      requestEpoch,
      local: { ...local },
      effective: { ...effective },
    };
  };
  const evidenceIsCurrent = (): boolean => Boolean(
    eligible
    && activeRuntimeAttachGeneration > 0
    && !geometryChangingResizePending
    && observedLocal
    && acknowledgedLocal
    && acknowledgedLocal.lifecycleEpoch === lifecycleEpoch
    && acknowledgedLocal.rendererEpoch === rendererEpoch
    && acknowledgedLocal.requestEpoch === requestEpoch
    && sameGrid(observedLocal, acknowledgedLocal)
    && knownEffective?.lifecycleEpoch === lifecycleEpoch
    && appliedEffective?.lifecycleEpoch === lifecycleEpoch
    && appliedEffective?.rendererEpoch === rendererEpoch,
  );
  const reconcile = () => {
    if (!evidenceIsCurrent()) {
      hideImmediately();
      return;
    }
    const local = observedLocal!;
    const applied = appliedEffective!;
    if (!sameEffective(applied, knownEffective)) {
      cancelAppearance();
      return;
    }

    if (presentedEffective && !sameEffective(presentedEffective, applied)) {
      if (isConstrained(applied, local)) {
        presentedEffective = applied;
        cancelRemoval();
        publish(buildPresentation(applied));
        return;
      }
      cancelAppearance();
      if (removalTimer !== null) return;
      const fence = { lifecycleEpoch, rendererEpoch, requestEpoch, effective: applied };
      removalTimer = setTimeout(() => {
        removalTimer = null;
        if (fence.lifecycleEpoch !== lifecycleEpoch
          || fence.rendererEpoch !== rendererEpoch
          || fence.requestEpoch !== requestEpoch
          || !sameEffective(fence.effective, appliedEffective)
          || !evidenceIsCurrent()
          || isConstrained(appliedEffective!, observedLocal!)) return;
        presentedEffective = null;
        publish(null);
      }, equalRemovalDelayMs);
      return;
    }

    if (isConstrained(applied, local)) {
      cancelRemoval();
      if (presentedEffective) {
        publish(buildPresentation(presentedEffective));
        return;
      }
      if (appearanceTimer !== null) return;
      const fence = { lifecycleEpoch, rendererEpoch, requestEpoch, effective: applied };
      appearanceTimer = setTimeout(() => {
        appearanceTimer = null;
        if (fence.lifecycleEpoch !== lifecycleEpoch
          || fence.rendererEpoch !== rendererEpoch
          || fence.requestEpoch !== requestEpoch
          || !sameEffective(fence.effective, appliedEffective)
          || !sameEffective(appliedEffective, knownEffective)
          || !evidenceIsCurrent()) return;
        presentedEffective = appliedEffective;
        publish(buildPresentation(appliedEffective!));
      }, appearanceDelayMs);
      return;
    }

    cancelAppearance();
    if (!presentedEffective) {
      publish(null);
      return;
    }
    if (removalTimer !== null) return;
    const fence = { lifecycleEpoch, rendererEpoch, requestEpoch, effective: applied };
    removalTimer = setTimeout(() => {
      removalTimer = null;
      if (fence.lifecycleEpoch !== lifecycleEpoch
        || fence.rendererEpoch !== rendererEpoch
        || fence.requestEpoch !== requestEpoch
        || !sameEffective(fence.effective, appliedEffective)
        || !evidenceIsCurrent()
        || isConstrained(appliedEffective!, observedLocal!)) return;
      presentedEffective = null;
      publish(null);
    }, equalRemovalDelayMs);
  };

  const beginLifecycle = () => {
    lifecycleEpoch += 1;
    activeRuntimeAttachGeneration = 0;
    observedLocal = null;
    acknowledgedLocal = null;
    knownEffective = null;
    appliedEffective = null;
    geometryChangingResizePending = false;
    hideImmediately();
    return lifecycleEpoch;
  };

  const bindAttachment = (epoch: number, runtimeAttachGeneration: number): boolean => {
    if (epoch !== lifecycleEpoch
      || !Number.isSafeInteger(runtimeAttachGeneration)
      || runtimeAttachGeneration <= 0) return false;
    if (activeRuntimeAttachGeneration > 0 && activeRuntimeAttachGeneration !== runtimeAttachGeneration) {
      hideImmediately();
      return false;
    }
    activeRuntimeAttachGeneration = runtimeAttachGeneration;
    reconcile();
    return true;
  };

  const closeAttachment = (runtimeAttachGeneration: number) => {
    if (runtimeAttachGeneration !== activeRuntimeAttachGeneration) return;
    activeRuntimeAttachGeneration = 0;
    acknowledgedLocal = null;
    knownEffective = null;
    appliedEffective = null;
    geometryChangingResizePending = false;
    hideImmediately();
  };

  const beginRenderer = () => {
    rendererEpoch += 1;
    appliedEffective = null;
    acknowledgedLocal = null;
    geometryChangingResizePending = false;
    hideImmediately();
    return rendererEpoch;
  };

  const endRenderer = (epoch: number) => {
    if (epoch !== rendererEpoch) return;
    appliedEffective = null;
    acknowledgedLocal = null;
    geometryChangingResizePending = false;
    hideImmediately();
  };

  const observeLocal = (size: TerminalGridSize) => {
    if (!validGrid(size)) return false;
    if (sameGrid(observedLocal, size)) return false;
    observedLocal = { ...size };
    requestEpoch += 1;
    acknowledgedLocal = null;
    geometryChangingResizePending = activeRuntimeAttachGeneration > 0;
    hideImmediately();
    return true;
  };

  const beginResize = (size: TerminalGridSize): TerminalGeometryRequestContext | null => {
    if (!validGrid(size) || activeRuntimeAttachGeneration <= 0) return null;
    const changed = observeLocal(size);
    callSequence += 1;
    latestCallSequence = callSequence;
    const reassertion = !changed && sameGrid(acknowledgedLocal, size) && evidenceIsCurrent();
    if (!reassertion) {
      geometryChangingResizePending = true;
      acknowledgedLocal = null;
      hideImmediately();
    }
    return {
      lifecycleEpoch,
      rendererEpoch,
      requestEpoch,
      callSequence,
      runtimeAttachGeneration: activeRuntimeAttachGeneration,
      requested: { ...size },
      reassertion,
    };
  };

  const acknowledgeLocalForEffective = (
    context: Pick<TerminalGeometryRequestContext, 'lifecycleEpoch' | 'rendererEpoch' | 'requestEpoch'>,
    requested: TerminalGridSize,
    effectiveGeneration: number,
  ) => {
    acknowledgedLocal = {
      ...requested,
      lifecycleEpoch: context.lifecycleEpoch,
      rendererEpoch: context.rendererEpoch,
      requestEpoch: context.requestEpoch,
      effectiveGeneration,
    };
    geometryChangingResizePending = false;
  };

  const acknowledgeAttach = (
    context: Readonly<{
      lifecycleEpoch: number;
      rendererEpoch: number;
      requestEpoch: number;
      requested: TerminalGridSize;
      runtimeAttachGeneration: number;
      effective: Omit<TerminalEffectiveGeometry, 'lifecycleEpoch'>;
    }>,
  ): TerminalEffectiveGeometry | null => {
    if (context.lifecycleEpoch !== lifecycleEpoch
      || context.rendererEpoch !== rendererEpoch
      || !bindAttachment(context.lifecycleEpoch, context.runtimeAttachGeneration)) return null;
    const effective = { ...context.effective, lifecycleEpoch };
    const disposition = reduceKnownEffective(effective);
    if (disposition === 'invalid' || disposition === 'conflict') return null;
    if (!knownEffective) return null;
    if (context.requestEpoch === requestEpoch && sameGrid(observedLocal, context.requested)) {
      acknowledgeLocalForEffective(context, context.requested, effective.generation);
    } else {
      acknowledgedLocal = null;
      geometryChangingResizePending = true;
    }
    reconcile();
    return effective;
  };

  const acknowledgeResize = (
    context: TerminalGeometryRequestContext,
    result: Readonly<{
      runtimeAttachGeneration: number;
      requested: TerminalGridSize;
      effective: Omit<TerminalEffectiveGeometry, 'lifecycleEpoch'>;
    }>,
  ): TerminalEffectiveGeometry | null => {
    if (context.callSequence !== latestCallSequence
      || context.lifecycleEpoch !== lifecycleEpoch
      || context.rendererEpoch !== rendererEpoch
      || context.requestEpoch !== requestEpoch
      || context.runtimeAttachGeneration !== activeRuntimeAttachGeneration
      || result.runtimeAttachGeneration !== activeRuntimeAttachGeneration
      || !sameGrid(context.requested, result.requested)
      || !sameGrid(observedLocal, result.requested)) return null;
    const effective = { ...result.effective, lifecycleEpoch };
    const disposition = reduceKnownEffective(effective);
    if (disposition === 'invalid' || disposition === 'conflict') return null;
    if (!knownEffective) return null;
    acknowledgeLocalForEffective(context, result.requested, effective.generation);
    reconcile();
    return effective;
  };

  const failResize = (context: TerminalGeometryRequestContext) => {
    if (context.callSequence !== latestCallSequence
      || context.lifecycleEpoch !== lifecycleEpoch
      || context.rendererEpoch !== rendererEpoch
      || context.requestEpoch !== requestEpoch) return;
    acknowledgedLocal = null;
    geometryChangingResizePending = false;
    hideImmediately();
  };

  const reduceKnownEffective = (
    effective: TerminalEffectiveGeometry,
  ): 'accepted' | 'stale' | 'conflict' | 'invalid' => {
    if (effective.lifecycleEpoch !== lifecycleEpoch || !validGrid(effective)) return 'invalid';
    const current = knownEffective;
    if (current && effective.generation < current.generation) return 'stale';
    if (current && effective.generation === current.generation) {
      if (!sameGrid(current, effective)) {
        acknowledgedLocal = null;
        hideImmediately();
        return 'conflict';
      }
      if (effective.presentationSequence < current.presentationSequence) return 'stale';
    }
    knownEffective = { ...effective };
    reconcile();
    return 'accepted';
  };

  const noteKnownEffective = (effective: TerminalEffectiveGeometry) => {
    return reduceKnownEffective(effective) === 'accepted';
  };

  const noteAppliedEffective = (effective: TerminalAppliedGeometry) => {
    if (effective.lifecycleEpoch !== lifecycleEpoch
      || effective.rendererEpoch !== rendererEpoch
      || !validGrid(effective)) return false;
    appliedEffective = { ...effective };
    reconcile();
    return true;
  };

  const setEligible = (next: boolean) => {
    if (eligible === next) return;
    eligible = next;
    reconcile();
  };

  const getState = (): TerminalGeometryPresentationState => ({
    lifecycleEpoch,
    rendererEpoch,
    requestEpoch,
    observedLocal,
    acknowledgedLocal,
    knownEffective,
    appliedEffective,
    presentedEffective,
    geometryChangingResizePending,
    presentation: published,
  });

  const dispose = () => {
    eligible = false;
    hideImmediately();
  };

  return {
    beginLifecycle,
    bindAttachment,
    closeAttachment,
    beginRenderer,
    endRenderer,
    observeLocal,
    beginResize,
    acknowledgeAttach,
    acknowledgeResize,
    failResize,
    noteKnownEffective,
    noteAppliedEffective,
    setEligible,
    getState,
    dispose,
  } as const;
}
