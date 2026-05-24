import { createEffect, createSignal, onCleanup } from 'solid-js';

import type { DesktopRuntimeLifecycleStepSnapshot } from '../shared/desktopRuntimeLifecycleProgress';

export function createRuntimeLifecycleStepAnimation(
  steps: () => readonly DesktopRuntimeLifecycleStepSnapshot[],
  planRevision: () => number,
): (stepKey: string) => boolean {
  const [enteringKeys, setEnteringKeys] = createSignal<ReadonlySet<string>>(new Set());
  let knownKeys = new Set<string>();
  let frame: number | null = null;

  createEffect(() => {
    const revision = planRevision();
    const nextKeys = new Set(steps().map((step) => step.key));
    const entering = [...nextKeys].filter((key) => !knownKeys.has(key));
    knownKeys = nextKeys;
    if (revision <= 0 || entering.length === 0) {
      return;
    }
    setEnteringKeys(new Set(entering));
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
    frame = requestAnimationFrame(() => {
      frame = null;
      setEnteringKeys(new Set<string>());
    });
  });

  onCleanup(() => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
  });

  return (stepKey: string) => enteringKeys().has(stepKey);
}
