// Timestamp and status display for a message.

import type { Component } from 'solid-js';
import type { MessageStatus } from '../types';

export interface MessageMetaProps {
  timestamp: number;
  status: MessageStatus;
}

/** Format a unix timestamp (ms) to HH:MM. */
function formatTime(ts: number): string {
  const date = new Date(ts);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export const MessageMeta: Component<MessageMetaProps> = (props) => {
  return (
    <div class="chat-message-meta">
      <span class="chat-message-meta-time">{formatTime(props.timestamp)}</span>
    </div>
  );
};
