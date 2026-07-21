// Connection state display component.

import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface ConnectionStatusProps {
  state: ConnectionState;
  class?: string;
}

export const ConnectionStatus: Component<ConnectionStatusProps> = (props) => {
  const color = () => {
    switch (props.state) {
      case 'connected': return 'text-[var(--redeven-status-success)]';
      case 'connecting': return 'text-[var(--redeven-status-warning)]';
      case 'disconnected': return 'text-[var(--redeven-status-neutral)]';
      case 'error': return 'text-[var(--redeven-status-error)]';
    }
  };

  const label = () => {
    switch (props.state) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'disconnected': return 'Disconnected';
      case 'error': return 'Connection error';
    }
  };

  return (
    <div class={cn('chat-connection-status', color(), props.class)}>
      <span class="chat-connection-dot" />
      <span>{label()}</span>
    </div>
  );
};
