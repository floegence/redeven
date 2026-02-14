// ChecklistBlock — interactive checklist with toggleable items.

import { For } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { useChatContext } from '../ChatProvider';
import type { ChecklistItem } from '../types';

export interface ChecklistBlockProps {
  items: ChecklistItem[];
  messageId: string;
  blockIndex: number;
  class?: string;
}

/**
 * Renders a list of interactive checkbox items. Toggling a checkbox
 * updates the message state via the ChatProvider context.
 */
export const ChecklistBlock: Component<ChecklistBlockProps> = (props) => {
  const ctx = useChatContext();

  const handleChange = (itemId: string) => {
    ctx.toggleChecklistItem(props.messageId, props.blockIndex, itemId);
  };

  return (
    <div class={cn('chat-checklist-block', props.class)}>
      <ul class="chat-checklist">
        <For each={props.items}>
          {(item) => (
            <li class="chat-checklist-item">
              <label class="chat-checklist-label">
                <input
                  type="checkbox"
                  class="chat-checklist-checkbox"
                  checked={item.checked}
                  onChange={() => handleChange(item.id)}
                />
                <span
                  class={cn(
                    'chat-checklist-text',
                    item.checked && 'chat-checklist-text-checked',
                  )}
                >
                  {item.text}
                </span>
              </label>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
};
