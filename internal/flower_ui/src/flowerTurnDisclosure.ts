import { createSignal } from 'solid-js';
import type { FlowerTurnDisclosurePolicy } from './flowerTurnPresentation';

// Interface-lifetime state only. Canonical outcomes stay in ThreadCache.
export function createFlowerTurnDisclosureStore() {
  const choices = new Map<string, { settled: boolean; expanded: boolean }>();
  const [revision, setRevision] = createSignal(0);
  return {
    settled(key: string): boolean {
      revision();
      return choices.get(key)?.settled ?? false;
    },
    expanded(key: string, policy: FlowerTurnDisclosurePolicy): boolean {
      revision();
      return policy === 'none' || (choices.get(key)?.expanded ?? policy !== 'automatic');
    },
    observe(key: string, policy: FlowerTurnDisclosurePolicy, protect: () => boolean, beforeSettle?: (expanded: boolean) => void): boolean {
      const previous = choices.get(key);
      if (previous?.settled) return false;
      if (policy === 'none') {
        if (!previous) choices.set(key, { settled: false, expanded: true });
        return false;
      }
      const expanded = policy === 'manual' || Boolean(previous && protect());
      if (previous) beforeSettle?.(expanded);
      choices.set(key, { settled: true, expanded });
      setRevision((value) => value + 1);
      return !expanded && Boolean(previous);
    },
    toggle(key: string, policy: FlowerTurnDisclosurePolicy) {
      if (policy === 'none') return;
      const expanded = !(choices.get(key)?.expanded ?? policy !== 'automatic');
      choices.set(key, { settled: true, expanded });
      setRevision((value) => value + 1);
    },
  };
}
export type FlowerTurnDisclosureStore = ReturnType<typeof createFlowerTurnDisclosureStore>;
