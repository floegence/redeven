import { createSignal } from 'solid-js';
import type { FlowerTurnDisclosurePolicy } from './flowerTurnPresentation';

// Interface-lifetime state only. Canonical outcomes stay in ThreadCache.
export function createFlowerTurnDisclosureStore() {
  const choices = new Map<string, { policy: FlowerTurnDisclosurePolicy; expanded: boolean; retained: boolean }>();
  const [revision, setRevision] = createSignal(0);
  return {
    settled(key: string): boolean {
      revision();
      const choice = choices.get(key);
      return Boolean(choice && choice.policy !== 'none');
    },
    expanded(key: string, policy: FlowerTurnDisclosurePolicy): boolean {
      revision();
      return policy === 'none' || (choices.get(key)?.expanded ?? policy !== 'automatic');
    },
    observe(key: string, policy: FlowerTurnDisclosurePolicy, protect: () => boolean, beforeSettle?: (expanded: boolean) => void): boolean {
      const previous = choices.get(key);
      if (policy === 'none') {
        if (!previous) choices.set(key, { policy, expanded: true, retained: false });
        return false;
      }
      if (previous?.retained || previous?.policy === policy) return false;
      const retained = policy === 'automatic' && Boolean(previous && protect());
      const expanded = policy === 'manual' || retained;
      if (previous) beforeSettle?.(expanded);
      choices.set(key, { policy, expanded, retained });
      setRevision((value) => value + 1);
      return !expanded && Boolean(previous);
    },
    retainExpanded(key: string) {
      const previous = choices.get(key);
      if (!previous || previous.policy === 'none' || previous.expanded && previous.retained) return;
      choices.set(key, { ...previous, expanded: true, retained: true });
      setRevision((value) => value + 1);
    },
    toggle(key: string, policy: FlowerTurnDisclosurePolicy) {
      if (policy === 'none') return;
      const expanded = !(choices.get(key)?.expanded ?? policy !== 'automatic');
      choices.set(key, { policy, expanded, retained: true });
      setRevision((value) => value + 1);
    },
  };
}
export type FlowerTurnDisclosureStore = ReturnType<typeof createFlowerTurnDisclosureStore>;
