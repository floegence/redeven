import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import type { DesktopWindowChromeSnapshot } from './windowChromeContract';

type WindowChromeSource = Readonly<{
  getSnapshot: () => DesktopWindowChromeSnapshot;
  subscribe?: (listener: (snapshot: DesktopWindowChromeSnapshot) => void) => () => void;
}>;

/** Redeven hosts reserve the visible Shell header and native chrome for Ask Flower. */
export function createAskFlowerWindowViewportInsets(options: Readonly<{
  open: Accessor<boolean>;
  chrome?: WindowChromeSource | null;
}>) {
  const [nativeTop, setNativeTop] = createSignal(options.chrome?.getSnapshot().titleBarHeight ?? 0);
  const [headerBottom, setHeaderBottom] = createSignal(0);
  createEffect(() => {
    if (!options.open()) return;
    setNativeTop(options.chrome?.getSnapshot().titleBarHeight ?? 0);
    const unsubscribe = options.chrome?.subscribe?.((snapshot) => setNativeTop(snapshot.titleBarHeight));
    onCleanup(() => unsubscribe?.());
  });

  createEffect(() => {
    if (!options.open()) return;

    const selector = '[data-floe-shell-slot="top-bar"]';
    let headers: HTMLElement[] = [];
    const measure = () => {
      let bottom = 0;
      for (const header of headers) {
        const rect = header.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || getComputedStyle(header).visibility === 'hidden') continue;
        bottom = Math.max(bottom, rect.bottom);
      }
      setHeaderBottom(bottom);
    };
    const observer = new ResizeObserver(measure);
    const bindHeaders = () => {
      observer.disconnect();
      headers = Array.from(document.querySelectorAll<HTMLElement>(selector));
      for (const header of headers) observer.observe(header);
      measure();
    };
    // A retained Shell may mount its new header after the mode switch paints.
    const headerChanged = (node: Node) => node instanceof Element && (
      node.matches(selector) || node.querySelector(selector) !== null
    );
    const mounts = new MutationObserver((records) => {
      if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some(headerChanged))) bindHeaders();
    });
    mounts.observe(document.body, { childList: true, subtree: true });
    bindHeaders();
    window.addEventListener('resize', measure);
    onCleanup(() => {
      observer.disconnect();
      mounts.disconnect();
      window.removeEventListener('resize', measure);
    });
  });

  return createMemo(() => ({ top: Math.max(headerBottom(), nativeTop()) }));
}
