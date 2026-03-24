import { createEffect, createSignal, onCleanup, type Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface AppendOnlyTextProps {
  text: string;
  offset?: number;
  class?: string;
}

export const APPEND_ONLY_TEXT_GUARD_LEN = 64;

export function isAppendOnlyTextCompatible(base: string, current: string): boolean {
  if (current.length < base.length) return false;
  const guardLen = Math.min(APPEND_ONLY_TEXT_GUARD_LEN, base.length);
  if (guardLen === 0) return true;
  const guard = base.slice(base.length - guardLen);
  return current.slice(base.length - guardLen, base.length) === guard;
}

export const AppendOnlyText: Component<AppendOnlyTextProps> = (props) => {
  const [el, setEl] = createSignal<HTMLDivElement | null>(null);

  let lastOffset = 0;
  let lastLen = 0;
  let lastGuard = '';

  let pending = '';
  let rafId: number | null = null;

  const scheduleFlush = () => {
    if (rafId !== null) return;
    const schedule = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : ((callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) as unknown as number);
    rafId = schedule(() => {
      rafId = null;
      const node = el();
      if (!node || !pending) return;
      const text = pending;
      pending = '';
      node.appendChild(document.createTextNode(text));
    });
  };

  const reset = (fullText: string, offset: number) => {
    const node = el();
    if (!node) return;

    node.textContent = '';
    pending = fullText.slice(offset);

    lastOffset = offset;
    lastLen = fullText.length;

    const guardLen = Math.min(APPEND_ONLY_TEXT_GUARD_LEN, lastLen);
    lastGuard = guardLen > 0 ? fullText.slice(lastLen - guardLen, lastLen) : '';
    scheduleFlush();
  };

  createEffect(() => {
    const node = el();
    if (!node) return;

    const fullText = String(props.text ?? '');
    const rawOffset = typeof props.offset === 'number' && Number.isFinite(props.offset) ? props.offset : 0;
    const offset = Math.max(0, Math.min(rawOffset, fullText.length));

    if (offset !== lastOffset || fullText.length < lastLen) {
      reset(fullText, offset);
      return;
    }

    const guardLen = Math.min(APPEND_ONLY_TEXT_GUARD_LEN, lastLen);
    if (guardLen > 0) {
      const currentGuard = fullText.slice(lastLen - guardLen, lastLen);
      if (currentGuard !== lastGuard) {
        reset(fullText, offset);
        return;
      }
    }

    if (fullText.length === lastLen) return;

    pending += fullText.slice(lastLen);
    lastLen = fullText.length;

    const newGuardLen = Math.min(APPEND_ONLY_TEXT_GUARD_LEN, lastLen);
    lastGuard = newGuardLen > 0 ? fullText.slice(lastLen - newGuardLen, lastLen) : '';
    scheduleFlush();
  });

  onCleanup(() => {
    if (rafId === null) return;
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
    } else {
      clearTimeout(rafId);
    }
    rafId = null;
  });

  return (
    <div
      ref={(node) => setEl(node)}
      class={cn('chat-streaming-text', props.class)}
      style={{ 'white-space': 'pre-wrap' }}
    />
  );
};
