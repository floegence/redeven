import type { Component } from 'solid-js';
import { For } from 'solid-js';
import { Activity, FileText, Folder, Paperclip, Terminal } from '@floegence/floe-webapp-core/icons';
import type { FlowerChatContextChip, FlowerChatContextDisplay } from '../contracts/flowerChatContextTypes';

type FlowerChatContextChipsProps = Readonly<{
  contextDisplay: FlowerChatContextDisplay;
  onChipClick: (chip: FlowerChatContextChip) => void;
}>;

function chipIcon(tone: string): Component<{ class?: string }> {
  switch (tone) {
    case 'environment': return (props) => <Activity class={props.class} />;
    case 'directory': return (props) => <Folder class={props.class} />;
    case 'attachment': return (props) => <Paperclip class={props.class} />;
    case 'process': return (props) => <Activity class={props.class} />;
    case 'terminal': return (props) => <Terminal class={props.class} />;
    default: return (props) => <FileText class={props.class} />;
  }
}

export const FlowerChatContextChips: Component<FlowerChatContextChipsProps> = (props) => {
  return (
    <div
      class="flower-chat-context-chips flower-message-bubble-framed flower-message-bubble-user"
      style="border-top-left-radius: 0; border-top-right-radius: 0;"
      data-flower-context-surface={props.contextDisplay.surface}
      data-flower-context-target={props.contextDisplay.target}
    >
      <div class="flower-chat-context-chips-divider" />
      <div class="flower-chat-context-chips-label">Linked context</div>
      <div class="flower-chat-context-chips-grid">
        <For each={props.contextDisplay.chips}>
          {(chip) => {
            const Icon = chipIcon(chip.tone);
            return (
              <button
                type="button"
                class="flower-chat-context-chip"
                data-flower-chat-context-chip="true"
                data-tone={chip.tone}
                aria-label={chip.label}
                onClick={() => props.onChipClick(chip)}
              >
                <span class="flower-chat-context-chip-icon">
                  <Icon />
                </span>
                <span class="flower-chat-context-chip-text">
                  <span class="flower-chat-context-chip-label">{chip.label}</span>
                  <span class="flower-chat-context-chip-detail">{chip.detail}</span>
                </span>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
};
