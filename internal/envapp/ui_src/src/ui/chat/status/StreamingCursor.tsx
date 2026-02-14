// Blinking cursor shown during message streaming.

import type { Component } from 'solid-js';

export interface StreamingCursorProps {
  class?: string;
}

export const StreamingCursor: Component<StreamingCursorProps> = () => {
  return <span class="chat-streaming-cursor" style={{ animation: 'pulse 1s infinite' }}>{'\u258B'}</span>;
};
