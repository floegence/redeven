import { Index, Show, batch, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { SubagentAvatar } from './SubagentAvatar';
import './styles/subagent-header.css';

const VISIBLE_AVATARS = 3;
const ROTATION_DELAY_MS = 2400;
const ROTATION_DURATION_MS = 720;

export function SubagentAvatarStack(props: Readonly<{
  threadIDs: readonly string[];
  state: 'running' | 'active' | 'settled';
  animate: boolean;
}>) {
  let root: HTMLSpanElement | undefined;
  const [step, setStep] = createSignal(0);
  const [moving, setMoving] = createSignal(false);
  const [swapped, setSwapped] = createSignal(false);
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const [reducedMotion, setReducedMotion] = createSignal(true);
  const [visible, setVisible] = createSignal(true);
  const threadIDs = createMemo(() => props.threadIDs, undefined, {
    equals: (previous, next) => previous.length === next.length && previous.every((id, index) => id === next[index]),
  });
  const count = () => Math.min(VISIBLE_AVATARS, threadIDs().length);
  const overflow = () => Math.max(0, threadIDs().length - VISIBLE_AVATARS);
  const threadAt = (slot: number, rotation = step()) => {
    const ids = threadIDs();
    return ids[((ids.length - count() - rotation + slot) % ids.length + ids.length) % ids.length]!;
  };
  const portraits = createMemo(() => Array.from({ length: count() }, (_, slot) => (
    swapped() && overflow() > 0 && slot === count() - 1 ? threadAt(0, step() + 1) : threadAt(slot)
  )));
  const animating = () => props.animate && props.state === 'running' && count() > 1
    && !reducedMotion() && visible() && !hovered() && !focused();

  onMount(() => {
    const trigger = root?.closest('button');
    setFocused(document.activeElement === trigger);
    const focus = () => setFocused(true);
    const blur = () => setFocused(false);
    trigger?.addEventListener('focus', focus);
    trigger?.addEventListener('blur', blur);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMedia = () => setReducedMotion(media.matches);
    const updateVisibility = () => setVisible(!document.hidden);
    updateMedia();
    updateVisibility();
    media.addEventListener('change', updateMedia);
    document.addEventListener('visibilitychange', updateVisibility);
    onCleanup(() => {
      trigger?.removeEventListener('focus', focus);
      trigger?.removeEventListener('blur', blur);
      media.removeEventListener('change', updateMedia);
      document.removeEventListener('visibilitychange', updateVisibility);
    });
  });

  createEffect(() => {
    threadIDs();
    setStep(0);
  });

  createEffect(() => {
    threadIDs();
    const enabled = animating();
    let advanceTimer: ReturnType<typeof setTimeout> | undefined;
    let swapTimer: ReturnType<typeof setTimeout> | undefined;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    batch(() => { setMoving(false); setSwapped(false); });
    if (enabled) {
      const schedule = () => {
        advanceTimer = setTimeout(() => {
          setMoving(true);
          if (threadIDs().length > VISIBLE_AVATARS) {
            swapTimer = setTimeout(() => setSwapped(true), ROTATION_DURATION_MS / 2);
          }
          finishTimer = setTimeout(() => {
            batch(() => { setStep(value => (value + 1) % threadIDs().length); setMoving(false); setSwapped(false); });
            schedule();
          }, ROTATION_DURATION_MS);
        }, ROTATION_DELAY_MS);
      };
      schedule();
    }
    onCleanup(() => {
      clearTimeout(advanceTimer);
      clearTimeout(swapTimer);
      clearTimeout(finishTimer);
    });
  });

  return (
    <span ref={root} class="flower-subagent-header-stack"
      style={{ '--flower-stack-count': count(), '--flower-stack-overflow-width': `${Math.max(26, (String(overflow()).length + 1) * 6 + 8)}px` }}
      data-flower-subagent-stack={props.state}
      data-overflow={overflow() > 0 ? 'true' : 'false'}
      data-animating={animating() ? 'true' : 'false'}
      data-moving={moving() ? 'true' : 'false'}
      data-replacing={overflow() > 0 ? 'true' : 'false'}
      aria-hidden="true"
      onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    >
      <Index each={portraits()}>{(threadID, slot) => (
        <span class="flower-subagent-header-portrait" data-slot={slot}
          data-flower-subagent-thread-id={threadID()} data-front={slot === count() - 1 && !swapped() ? 'true' : 'false'}
          data-departing={slot === count() - 1 ? 'true' : 'false'}
          style={{ '--flower-stack-slot': slot }}
        ><SubagentAvatar threadID={threadID()} /></span>
      )}</Index>
      <Show when={overflow() > 0}><span class="flower-subagent-header-overflow" data-flower-subagent-overflow>+{overflow()}</span></Show>
    </span>
  );
}
