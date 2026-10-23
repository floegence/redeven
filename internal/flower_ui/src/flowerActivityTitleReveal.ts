import { createContext, createMemo, createEffect, on, onCleanup, onMount, useContext, type Accessor } from 'solid-js';
import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import { flowerActivityIdentity } from './flowerActivityIdentity';
import { flowerToolCallPreviewIdentity } from './toolCallPreview';

// A bounded visual reveal, never a queue in front of incoming runtime facts.
const MAX_REVEAL_MS = 360;
const FRESH_WINDOW_MS = 450;
const MAX_ACTIVE_REVEALS = 12;

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
  let known = new Map<string, number>();
  const animations = new Map<Animation, () => void>();
  const finishAll = () => {
    for (const cancel of animations.values()) cancel();
    animations.clear();
    for (const key of known.keys()) known.set(key, 0);
  };
  const arrivals = createMemo(() => {
    const thread = options.thread();
    const entries = options.entries();
    const live = options.liveConfirmed();
    const sameThread = Boolean(threadID && threadID === thread?.thread_id);
    if (!sameThread || !live) { finishAll(); known.clear(); }
    const execution = thread?.current_execution;
    const now = performance.now();
    const next = new Map<string, number>();
    for (const entry of entries) {
      if (entry.type !== 'message' || !execution || entry.message.thread_id !== thread?.thread_id
        || entry.message.turn_id !== execution.turn_id || entry.message.run_id !== execution.run_id) continue;
      const fresh = sameThread && wasLive && live && !document.hidden && thread?.status === 'running';
      const add = (key: string, eligible = true) => next.set(key,
        !eligible || !options.isVisible(key) ? 0 : sameThread && live && known.has(key) ? known.get(key)! : fresh ? now + FRESH_WINDOW_MS : 0);
      for (const block of entry.blocks) {
        if (block.type === 'content' && block.block_type === 'thinking') add(block.key);
        else if (block.type === 'tool_preview') add(flowerToolCallPreviewIdentity(block.block.call));
        else if (block.type === 'activity') for (const item of block.block.items) {
          add(flowerActivityIdentity({ threadID: block.block.thread_id, turnID: block.block.turn_id, runID: block.block.run_id,
            itemID: item.kind === 'tool' && item.tool_id ? item.tool_id : item.item_id }),
          ['pending', 'running', 'success'].includes(item.status) && !item.requires_approval && !item.approval_state);
        }
      }
    }
    threadID = thread?.thread_id;
    wasLive = live;
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
    reveal(key: string, node: HTMLElement): (immediate?: boolean) => void {
      const pending = arrivals();
      const deadline = pending.get(key) ?? 0;
      // Claim once even when hidden, so opening old disclosures never replays.
      pending.set(key, 0);
      if (deadline <= performance.now() || !options.liveConfirmed() || options.reducedMotion()
        || document.hidden || node.closest('[inert]') || !node.getClientRects().length || !node.animate) return () => {};
      const width = node.getBoundingClientRect().width;
      if (width <= 0) return () => {};
      if (animations.size >= MAX_ACTIVE_REVEALS) {
        animations.values().next().value!();
      }
      const steps = Math.max(6, Math.min(32, Math.ceil(width / 9)));
      const animation = node.animate([
        { clipPath: 'inset(0 100% 0 0)' },
        { clipPath: 'inset(0 0% 0 0)' },
      ], { duration: Math.min(MAX_REVEAL_MS, 120 + steps * 8), easing: `steps(${steps}, end)` });
      // Keep the complete row measurable and accessible while placement and
      // both viewport owners make room. Nothing paints at the stale position.
      animation.pause();
      // The line survives a tool gaining details and replacing its static
      // title with a button. Fast results must not expose it mid-scroll.
      const trigger = node.closest<HTMLElement>('.flower-activity-inline-line, .flower-thinking-toggle') ?? node;
      const entrance = trigger.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 80, fill: 'backwards' });
      entrance.pause();
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        const delay = options.prepareArrival(key);
        animation.effect!.updateTiming({ delay });
        entrance.effect!.updateTiming({ delay });
        if (animation.playState !== 'idle') animation.play();
        entrance.play();
      });
      const cancel = () => { cancelled = true; animations.delete(animation); animation.cancel(); entrance.cancel(); };
      animations.set(animation, cancel);
      void Promise.allSettled([animation.finished, entrance.finished]).then(cancel);
      return (immediate = false) => {
        animation.cancel();
        if (immediate) cancel();
        else queueMicrotask(() => { if (!trigger.isConnected) cancel(); });
      };
    },
  };
}

export const FlowerActivityTitleRevealContext = createContext<ReturnType<typeof createFlowerActivityTitleReveal>>();

export function useFlowerActivityTitleReveal(key: Accessor<string>, content: Accessor<unknown>, immediate: Accessor<boolean> = () => false) {
  const context = useContext(FlowerActivityTitleRevealContext);
  return (node: HTMLElement) => {
    let cancel: ((immediate?: boolean) => void) | undefined;
    createEffect(on([key, content, immediate], () => cancel?.(immediate()), { defer: true }));
    onMount(() => { cancel = context?.reveal(key(), node); });
    onCleanup(() => cancel?.());
  };
}
