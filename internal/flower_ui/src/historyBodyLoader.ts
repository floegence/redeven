import { withFlowerReadDeadline } from './requestDeadline';
import { HISTORY_READ_RETRY_DELAYS, recoverableHistoryRead } from './historyReadRecovery';
import { createActivityReadQueue } from './activityReadQueue';

export const HISTORY_BODY_CONCURRENCY = 2;
export const HISTORY_BODY_VIEWPORT_MARGIN_PX = 160;

type BodyRead = {
  identity: object | string;
  signal: AbortSignal;
  read: (signal: AbortSignal) => Promise<void | boolean>;
  state: 'queued' | 'loading' | 'waiting' | 'failed';
  failures: number;
  recoverable: boolean;
  timer?: ReturnType<typeof setTimeout>;
  cancel: () => void;
  controller: AbortController;
};

// One surface owns the queue. Visible text and explicit tool disclosures share
// two physical read slots. Cancellation releases UI ownership immediately while
// a transport which ignores abort keeps its slot until its promise settles.
export function createHistoryBodyLoader(timeoutMessage: () => string, changed: () => void = () => undefined, queue = createActivityReadQueue()) {
  const reads = new Map<string, BodyRead>();
  let active = 0;
  let sequence = 0;
  const remove = (key: string, entry: BodyRead) => {
    entry.signal.removeEventListener('abort', entry.cancel);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.controller.abort();
    if (reads.get(key) === entry) { reads.delete(key); changed(); }
  };
  const pump = () => {
    for (const [key, entry] of reads) {
      if (active >= HISTORY_BODY_CONCURRENCY) break;
      if (entry.state !== 'queued') continue;
      if (entry.signal.aborted) { remove(key, entry); continue; }
      active++; entry.state = 'loading'; changed();
      void withFlowerReadDeadline(signal => queue.run('body:' + ++sequence, signal, entry.read), timeoutMessage(), entry.signal).then(
        more => {
          entry.failures = 0;
          if (more && !entry.signal.aborted && reads.get(key) === entry) {
            // A chunk yields its slot to queued visible items. New extent
            // notifications coalesce into the same read owner.
            entry.state = 'queued'; reads.delete(key); reads.set(key, entry);
          } else remove(key, entry);
        },
        error => {
          if (entry.signal.aborted) remove(key, entry);
          else if (reads.get(key) === entry) {
            entry.recoverable = recoverableHistoryRead(error);
            const delay = HISTORY_READ_RETRY_DELAYS[entry.failures++];
            if (entry.recoverable && delay !== undefined) {
              entry.state = 'waiting';
              entry.timer = setTimeout(() => {
                entry.timer = undefined;
                if (reads.get(key) !== entry || entry.signal.aborted) return;
                entry.state = 'queued';
                reads.delete(key); reads.set(key, entry);
                changed(); pump();
              }, delay);
            } else entry.state = 'failed';
            changed();
          }
        },
      ).finally(() => { active--; pump(); });
    }
  };
  return {
    resume() {
      for (const entry of reads.values()) {
        if (entry.state !== 'failed' || !entry.recoverable || entry.signal.aborted) continue;
        entry.failures = 0; entry.state = 'queued';
      }
      changed(); pump();
    },
    retry(key: string) {
      const entry = reads.get(key);
      if (!entry || entry.state !== 'failed' || entry.signal.aborted) return;
      entry.failures = 0; entry.state = 'queued';
      changed(); pump();
    },
    dispose() { for (const [key, entry] of reads) remove(key, entry); },
    state(key: string): 'loading' | 'failed' | undefined {
      const state = reads.get(key)?.state;
      return state === 'queued' || state === 'waiting' ? 'loading' : state;
    },
    request(key: string, identity: object | string, signal: AbortSignal, read: BodyRead['read']) {
      if (signal.aborted) return;
      const previous = reads.get(key);
      if (previous?.identity === identity) return;
      if (previous) remove(key, previous);
      const controller = new AbortController();
      const ownedSignal = AbortSignal.any([signal, controller.signal]);
      const entry: BodyRead = { identity, signal: ownedSignal, controller, read, state: 'queued', failures: 0, recoverable: false, cancel: () => { remove(key, entry); pump(); } };
      reads.set(key, entry);
      ownedSignal.addEventListener('abort', entry.cancel, { once: true });
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
        }, { root, rootMargin: `${HISTORY_BODY_VIEWPORT_MARGIN_PX}px 0px` });
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
