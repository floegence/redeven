// Complete chat container with optional header, message list, and input area.

import { Show } from 'solid-js';
import type { Component, ParentComponent } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { ChatProvider, type ChatProviderProps } from './ChatProvider';
import { VirtualMessageList } from './message-list';
import { ChatInput } from './input/ChatInput';
import type { ConnectionState } from './status/ConnectionStatus';

export interface ChatContainerProps extends ChatProviderProps {
  title?: string;
  connectionState?: ConnectionState;
  showHeader?: boolean;
  header?: Component;
  footer?: Component;
  inputDisabled?: boolean;
  inputPlaceholder?: string;
  class?: string;
}

export const ChatContainer: ParentComponent<ChatContainerProps> = (props) => {
  return (
    <ChatProvider
      initialMessages={props.initialMessages}
      config={props.config}
      callbacks={props.callbacks}
    >
      <div class={cn('chat-container', props.class)}>
        <Show when={props.showHeader !== false && (props.header || props.title)}>
          <div class="chat-header">
            {props.header ? <props.header /> : <span class="chat-header-title">{props.title}</span>}
          </div>
        </Show>
        <div class="chat-container-messages">
          <VirtualMessageList />
        </div>
        <div class="chat-container-input">
          {props.footer ? <props.footer /> : (
            <ChatInput disabled={props.inputDisabled} placeholder={props.inputPlaceholder} />
          )}
        </div>
      </div>
    </ChatProvider>
  );
};
