import { createEffect, onCleanup, type Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface AppendOnlyTextProps {
  text: string;
  offset?: number;
  class?: string;
}

export const AppendOnlyText: Component<AppendOnlyTextProps> = (props) => {
  let element!: HTMLSpanElement;
  let textNode: Text | undefined;
  let pending = '';
  let rafId: number | undefined;

  createEffect(() => {
    const text = String(props.text ?? '');
    const offset = typeof props.offset === 'number' && Number.isFinite(props.offset)
      ? Math.max(0, Math.min(props.offset, text.length)) : 0;
    pending = text.slice(offset);
    if (rafId !== undefined) return;
    rafId = requestAnimationFrame(() => {
      rafId = undefined;
      if (!textNode) {
        textNode = document.createTextNode(pending);
        element.appendChild(textNode);
      } else if (pending.startsWith(textNode.data)) {
        textNode.appendData(pending.slice(textNode.length));
      } else {
        textNode.data = pending;
      }
    });
  });

  onCleanup(() => {
    if (rafId !== undefined) cancelAnimationFrame(rafId);
  });

  return <span ref={element} class={cn('flower-chat-md-raw-tail', props.class)} style={{ 'white-space': 'pre-wrap' }} />;
};
