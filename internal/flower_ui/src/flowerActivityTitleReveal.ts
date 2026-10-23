import { createContext, createMemo, createEffect, createSignal, onCleanup, onMount, useContext, type Accessor } from 'solid-js';
import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import { flowerActivityIdentity } from './flowerActivityIdentity';
import { flowerToolCallPreviewIdentity } from './toolCallPreview';

// A bounded visual reveal, never a queue in front of incoming runtime facts.
const MAX_REVEAL_MS = 360;
const FRESH_WINDOW_MS = 450;

export function createFlowerActivityTitleReveal(options: {
  thread: Accessor<FlowerThreadSnapshot | null | undefined>;
  entries: Accessor<readonly FlowerTimelineEntry[]>;
  liveConfirmed: Accessor<boolean>;
  reducedMotion: Accessor<boolean>;
  isVisible: (key: string) => boolean;
  prepareArrival: (key: string) => number;
}) {
  let threadID: string | undefined;
  let wasLive = false;
  let wasRunning = false;
  let known = new Map<string, { deadline: number; entryKey: string }>();
  const [revision, setRevision] = createSignal(0);
  const animations = new Map<string, {
    entryKey: string;
    node: HTMLElement;
    animation: Animation;
    entrance: Animation;
    report: (revealing: boolean) => void;
    cancel: () => void;
  }>();
  const finishAll = () => {
    for (const active of animations.values()) active.cancel();
    animations.clear();
    for (const arrival of known.values()) arrival.deadline = 0;
  };
  const arrivals = createMemo(() => {
    const thread = options.thread();
    const entries = options.entries();
    const live = options.liveConfirmed();
    const sameThread = Boolean(threadID && threadID === thread?.thread_id);
    if (!sameThread || !live) { finishAll(); known.clear(); }
    const execution = thread?.current_execution;
    const now = performance.now();
    const next = new Map<string, { deadline: number; entryKey: string }>();
    for (const entry of entries) {
      if (entry.type !== 'message' || !execution || entry.message.thread_id !== thread?.thread_id
        || entry.message.turn_id !== execution.turn_id || entry.message.run_id !== execution.run_id) continue;
      const fresh = sameThread && wasLive && live && !document.hidden && (thread?.status === 'running' || wasRunning);
      const add = (key: string) => next.set(key, { entryKey: entry.key, deadline:
        !options.isVisible(key) ? 0 : sameThread && live && known.has(key) ? known.get(key)!.deadline : fresh ? now + FRESH_WINDOW_MS : 0 });
      for (const block of entry.blocks) {
        if (block.type === 'content' && block.block_type === 'thinking') add(block.key);
        else if (block.type === 'tool_preview') add(flowerToolCallPreviewIdentity(block.block.call));
        else if (block.type === 'activity') for (const item of block.block.items) {
          add(flowerActivityIdentity({ threadID: block.block.thread_id, turnID: block.block.turn_id, runID: block.block.run_id,
            itemID: item.kind === 'tool' && item.tool_id ? item.tool_id : item.item_id }));
        }
      }
    }
    threadID = thread?.thread_id;
    wasLive = live;
    wasRunning = thread?.status === 'running';
    known = next;
    return next;
  });
  onMount(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onPreference = () => { if (media?.matches) finishAll(); };
    const onVisibility = () => { if (document.hidden) finishAll(); };
    media?.addEventListener('change', onPreference);
    document.addEventListener('visibilitychange', onVisibility);
    onCleanup(() => {
      media?.removeEventListener('change', onPreference);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  });
  onCleanup(finishAll);
  return {
    revealingEntries(): ReadonlySet<string> {
      revision();
      return new Set([...animations.values()].map(active => active.entryKey));
    },
    reveal(key: string, node: HTMLElement, report: (revealing: boolean) => void): () => void {
      const pending = arrivals();
      const trigger = node.closest<HTMLElement>('.flower-activity-inline-line, .flower-thinking-toggle') ?? node;
      const release = () => {
        // Preview promotion may bind the same call to a replacement node in
        // this update. Transfer its original timing instead of replaying it.
        queueMicrotask(() => {
          const active = animations.get(key);
          if (active?.node === node && !node.isConnected) active.cancel();
        });
      };
      const existing = animations.get(key);
      if (existing) {
        existing.report(false);
        existing.node = node;
        (existing.animation.effect as KeyframeEffect).target = node;
        (existing.entrance.effect as KeyframeEffect).target = trigger;
        existing.report = report;
        report(true);
        return release;
      }
      const arrival = pending.get(key);
      const deadline = arrival?.deadline ?? 0;
      // Claim once even when hidden, so opening old disclosures never replays.
      if (arrival) arrival.deadline = 0;
      if (deadline <= performance.now() || !options.liveConfirmed() || options.reducedMotion()
        || document.hidden || node.closest('[inert]') || !node.getClientRects().length || !node.animate) {
        report(false);
        return () => {};
      }
      const width = node.getBoundingClientRect().width;
      if (width <= 0) { report(false); return () => {}; }
      report(true);
      const steps = Math.max(6, Math.min(32, Math.ceil(width / 9)));
      const animation = node.animate([
        { clipPath: 'inset(0 100% 0 0)' },
        { clipPath: 'inset(0 0% 0 0)' },
      ], { duration: Math.min(MAX_REVEAL_MS, 120 + steps * 8), easing: `steps(${steps}, end)`, fill: 'backwards' });
      // Keep the complete row measurable and accessible while placement and
      // both viewport owners make room. Nothing paints at the stale position.
      animation.pause();
      const entrance = trigger.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 80, fill: 'backwards' });
      entrance.pause();
      const active = { entryKey: arrival!.entryKey, node, animation, entrance, report, cancel: () => {
        animations.delete(key);
        animation.cancel();
        entrance.cancel();
        active.report(false);
        setRevision(value => value + 1);
      } };
      animations.set(key, active);
      setRevision(value => value + 1);
      queueMicrotask(() => {
        if (animations.get(key) !== active) return;
        const delay = options.prepareArrival(key);
        animation.effect!.updateTiming({ delay });
        entrance.effect!.updateTiming({ delay });
        animation.play();
        entrance.play();
      });
      void Promise.allSettled([animation.finished, entrance.finished]).then(() => {
        if (animations.get(key) === active) active.cancel();
      });
      return release;
    },
  };
}

export const FlowerActivityTitleRevealContext = createContext<ReturnType<typeof createFlowerActivityTitleReveal>>();

export function useFlowerActivityTitleReveal(key: Accessor<string>, urgent: Accessor<boolean> = () => false) {
  const context = useContext(FlowerActivityTitleRevealContext);
  const [revealing, setRevealing] = createSignal(true);
  return {
    revealing,
    bind: (node: HTMLElement) => {
      let release: (() => void) | undefined;
      onMount(() => {
        release = context?.reveal(key(), node, setRevealing);
        if (!context) setRevealing(false);
      });
      createEffect(() => {
        // Urgent outcomes expose the row and actions immediately. Its title
        // still completes the same reveal without delaying runtime facts.
        if (urgent()) {
          const line = node.closest('.flower-activity-inline-line, .flower-thinking-toggle');
          for (const animation of line?.getAnimations() ?? []) {
            if ((animation.effect as KeyframeEffect).getKeyframes().some(frame => 'opacity' in frame)) animation.finish();
          }
        }
      });
      onCleanup(() => release?.());
    },
  };
}
