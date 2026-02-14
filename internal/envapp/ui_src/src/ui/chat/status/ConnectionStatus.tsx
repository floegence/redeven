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
      case 'connected': return 'text-green-500';
      case 'connecting': return 'text-yellow-500';
      case 'disconnected': return 'text-gray-400';
      case 'error': return 'text-red-500';
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
