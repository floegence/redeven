import { withFlowerReadDeadline } from './requestDeadline';

type BodyRead = {
  identity: object;
  signal: AbortSignal;
  read: (signal: AbortSignal) => Promise<void>;
  state: 'queued' | 'loading' | 'failed';
  cancel: () => void;
};

// One surface owns the queue. Visible text and explicit tool disclosures share
// two read slots; a timeout or navigation releases both transport and UI ownership.
export function createHistoryBodyLoader(timeoutMessage: () => string, changed: () => void = () => undefined) {
  const reads = new Map<string, BodyRead>();
  let active = 0;
  const remove = (key: string, entry: BodyRead) => {
    entry.signal.removeEventListener('abort', entry.cancel);
    if (reads.get(key) === entry) { reads.delete(key); changed(); }
  };
  const pump = () => {
    for (const [key, entry] of reads) {
      if (active >= 2) break;
      if (entry.state !== 'queued') continue;
      if (entry.signal.aborted) { remove(key, entry); continue; }
      active++; entry.state = 'loading'; changed();
      void withFlowerReadDeadline(entry.read, timeoutMessage(), entry.signal).then(
        () => remove(key, entry),
        () => {
          if (entry.signal.aborted) remove(key, entry);
          else if (reads.get(key) === entry) { entry.state = 'failed'; changed(); }
        },
      ).finally(() => { active--; pump(); });
    }
  };
  return {
    state(key: string): 'loading' | 'failed' | undefined {
      const state = reads.get(key)?.state;
      return state === 'queued' ? 'loading' : state;
    },
    request(key: string, identity: object, signal: AbortSignal, read: BodyRead['read'], retry = false) {
      if (signal.aborted) return;
      const previous = reads.get(key);
      if (previous?.identity === identity && (!retry || previous.state !== 'failed')) return;
      if (previous) remove(key, previous);
      const entry: BodyRead = { identity, signal, read, state: 'queued', cancel: () => { remove(key, entry); pump(); } };
      reads.set(key, entry);
      signal.addEventListener('abort', entry.cancel, { once: true });
      changed(); pump();
    },
  };
}

// Share one observer per scroll viewport, rather than a scroll handler or layout
// scan for every message. Offscreen bodies never enter the download queue.
export function createHistoryBodyVisibility() {
  const roots = new Map<Element, { observer: IntersectionObserver; callbacks: Map<Element, (visible: boolean) => void> }>();
  return {
    observe(element: Element, root: Element, callback: (visible: boolean) => void) {
      let owner = roots.get(root);
      if (!owner) {
        const callbacks = new Map<Element, (visible: boolean) => void>();
        const observer = new IntersectionObserver(entries => {
          for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting);
        }, { root, rootMargin: '160px 0px' });
        owner = { observer, callbacks }; roots.set(root, owner);
      }
      owner.callbacks.set(element, callback); owner.observer.observe(element);
      return () => {
        owner.callbacks.delete(element); owner.observer.unobserve(element);
        if (!owner.callbacks.size) { owner.observer.disconnect(); roots.delete(root); }
      };
    },
  };
}
