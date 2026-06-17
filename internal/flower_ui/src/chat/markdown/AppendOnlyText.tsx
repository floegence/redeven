import { createEffect, createSignal, onCleanup, type Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface AppendOnlyTextProps {
  text: string;
  offset?: number;
  class?: string;
}

const APPEND_ONLY_TEXT_GUARD_LEN = 64;

export const AppendOnlyText: Component<AppendOnlyTextProps> = (props) => {
  const [el, setEl] = createSignal<HTMLSpanElement | null>(null);
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
      const span = document.createElement('span');
      span.className = 'flower-chat-md-streaming-fade-in';
      span.appendChild(document.createTextNode(text));
      node.appendChild(span);
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
    <span
      ref={(node) => setEl(node)}
      class={cn('flower-chat-md-raw-tail', props.class)}
      style={{ 'white-space': 'pre-wrap' }}
    />
  );
};
