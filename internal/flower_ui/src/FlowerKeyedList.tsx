import { For, createMemo, onCleanup, type Accessor, type JSX } from 'solid-js';

/** Keep controls mounted by domain identity while their props continue to update. */
export function FlowerKeyedList<T>(props: Readonly<{
  each: readonly T[];
  identity: (item: T) => string | T;
  focusFallback?: () => void;
  scope?: string;
  children: (item: Accessor<T>, index: Accessor<number>) => JSX.Element;
}>): JSX.Element {
  const mounted = new Map<string | T, JSX.Element>();
  const indexed = createMemo(() => new Map(props.each.map((item) => [props.identity(item), item])));
  const keys = createMemo(() => [...indexed().keys()]);
  return <For each={keys()}>{(key, index) => {
    const item = createMemo(() => indexed().get(key)!);
    const scope = props.scope;
    const rendered = props.children(item, index);
    mounted.set(key, rendered);
    onCleanup(() => {
      mounted.delete(key);
      const owner = typeof document === 'undefined' ? null : document.activeElement;
      if (!owner || !(rendered instanceof Element) || !rendered.contains(owner)) return;
      const position = index();
      queueMicrotask(() => {
        if (props.scope !== scope || (document.activeElement !== owner && document.activeElement !== document.body)) return;
        const remaining = keys();
        const neighbours = [...remaining.slice(position), ...remaining.slice(0, position).reverse()];
        for (const neighbour of neighbours) {
          const root = mounted.get(neighbour);
          if (!(root instanceof HTMLElement) || !root.isConnected) continue;
          const selector = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
          const target = root.matches(selector) ? root : root.querySelector<HTMLElement>(selector);
          if (target) { target.focus({ preventScroll: true }); return; }
        }
        props.focusFallback?.();
      });
    });
    return rendered;
  }}</For>;
}
