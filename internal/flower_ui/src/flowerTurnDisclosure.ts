import { createSignal } from 'solid-js';

// Interface-lifetime state only. Canonical outcomes stay in ThreadCache.
export function createFlowerTurnDisclosureStore() {
  const choices = new Map<string, { settled: boolean; expanded: boolean }>();
  const [revision, setRevision] = createSignal(0);
  return {
    settled(key: string): boolean {
      revision();
      return choices.get(key)?.settled ?? false;
    },
    expanded(key: string, eligible: boolean): boolean {
      revision();
      return !eligible || (choices.get(key)?.expanded ?? false);
    },
    observe(key: string, eligible: boolean, protect: () => boolean, beforeSettle?: (expanded: boolean) => void): boolean {
      const previous = choices.get(key);
      if (previous?.settled) return false;
      if (!eligible) {
        if (!previous) choices.set(key, { settled: false, expanded: true });
        return false;
      }
      const expanded = previous ? protect() : false;
      if (previous) beforeSettle?.(expanded);
      choices.set(key, { settled: true, expanded });
      setRevision((value) => value + 1);
      return !expanded && Boolean(previous);
    },
    toggle(key: string, eligible: boolean) {
      if (!eligible) return;
      const expanded = !(choices.get(key)?.expanded ?? false);
      choices.set(key, { settled: true, expanded });
      setRevision((value) => value + 1);
    },
  };
}
export type FlowerTurnDisclosureStore = ReturnType<typeof createFlowerTurnDisclosureStore>;
