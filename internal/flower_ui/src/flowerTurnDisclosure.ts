import { createSignal, untrack } from 'solid-js';
import type { FlowerTurnDisclosurePolicy } from './flowerTurnPresentation';

// Interface-lifetime state only. Canonical outcomes stay in ThreadCache.
export function createFlowerTurnDisclosureStore() {
  type Choice = { policy: FlowerTurnDisclosurePolicy; expanded: boolean; retained: boolean; animate: boolean };
  const choices = new Map<string, ReturnType<typeof createSignal<Choice | undefined>>>();
  const state = (key: string) => {
    let value = choices.get(key);
    if (!value) { value = createSignal<Choice>(); choices.set(key, value); }
    return value;
  };
  const current = (key: string) => untrack(state(key)[0]);
  const update = (key: string, choice: Choice) => state(key)[1](choice);
  return {
    alias(key: string, source: string) {
      if (key !== source) choices.set(key, state(source));
    },
    motionEnabled(key: string): boolean {
      return state(key)[0]()?.animate ?? true;
    },
    manuallyControlled(key: string): boolean {
      return Boolean(state(key)[0]()?.retained);
    },
    manuallyExpanded(key: string): boolean {
      const choice = state(key)[0]();
      return Boolean(choice?.retained && choice.expanded);
    },
    settled(key: string): boolean {
      const choice = state(key)[0]();
      return Boolean(choice && choice.policy !== 'none');
    },
    expanded(key: string, policy: FlowerTurnDisclosurePolicy): boolean {
      return policy === 'none' || (state(key)[0]()?.expanded ?? policy !== 'automatic');
    },
    observe(key: string, policy: FlowerTurnDisclosurePolicy, inspected: () => boolean = () => false, beforeCollapse?: () => void, animate = true): boolean {
      const previous = current(key);
      if (policy === 'none') {
        if (!previous) update(key, { policy, expanded: true, retained: false, animate });
        return false;
      }
      // A completed boundary settles the automatic default once. Explicit
      // choices and content being inspected survive later observations.
      if (previous) {
        if (previous.policy !== policy) {
          const retained = previous.retained || policy === 'automatic' && previous.expanded && inspected();
          const collapse = policy === 'automatic' && previous.expanded && !retained;
          if (collapse) beforeCollapse?.();
          update(key, { policy, retained, expanded: previous.expanded && !collapse, animate });
          return collapse;
        }
        return false;
      }
      const retained = false;
      const expanded = policy === 'manual';
      update(key, { policy, expanded, retained, animate });
      return false;
    },
    retainExpanded(key: string) {
      const previous = current(key);
      if (!previous || !previous.expanded || previous.policy === 'none' || previous.retained) return;
      update(key, { ...previous, retained: true });
    },
    reveal(key: string) {
      const previous = current(key);
      if (!previous || previous.policy === 'none' || previous.expanded && previous.retained) return;
      update(key, { ...previous, expanded: true, retained: true, animate: true });
    },
    toggle(key: string, policy: FlowerTurnDisclosurePolicy) {
      if (policy === 'none') return;
      const expanded = !(current(key)?.expanded ?? policy !== 'automatic');
      update(key, { policy, expanded, retained: true, animate: true });
    },
  };
}
export type FlowerTurnDisclosureStore = ReturnType<typeof createFlowerTurnDisclosureStore>;
