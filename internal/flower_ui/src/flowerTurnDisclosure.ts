import { createSignal, untrack } from 'solid-js';
import type { FlowerTurnDisclosurePolicy } from './flowerTurnPresentation';

// Interface-lifetime state only. Canonical outcomes stay in ThreadCache.
export function createFlowerTurnDisclosureStore() {
  type Choice = { policy: FlowerTurnDisclosurePolicy; expanded: boolean; retained: boolean };
  const choices = new Map<string, ReturnType<typeof createSignal<Choice | undefined>>>();
  const state = (key: string) => {
    let value = choices.get(key);
    if (!value) { value = createSignal<Choice>(); choices.set(key, value); }
    return value;
  };
  const current = (key: string) => untrack(state(key)[0]);
  const update = (key: string, choice: Choice) => state(key)[1](choice);
  return {
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
    observe(key: string, policy: FlowerTurnDisclosurePolicy): boolean {
      const previous = current(key);
      if (policy === 'none') {
        if (!previous) update(key, { policy, expanded: true, retained: false });
        return false;
      }
      // Defaults apply once. Completion and newer turns cannot change content
      // the reader already saw, even when its initial state was automatic.
      if (previous) {
        if (previous.policy !== policy) {
          update(key, { ...previous, policy });
        }
        return false;
      }
      const retained = false;
      const expanded = policy === 'manual';
      update(key, { policy, expanded, retained });
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
      update(key, { ...previous, expanded: true, retained: true });
    },
    toggle(key: string, policy: FlowerTurnDisclosurePolicy) {
      if (policy === 'none') return;
      const expanded = !(current(key)?.expanded ?? policy !== 'automatic');
      update(key, { policy, expanded, retained: true });
    },
  };
}
export type FlowerTurnDisclosureStore = ReturnType<typeof createFlowerTurnDisclosureStore>;
