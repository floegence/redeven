import type { Component } from 'solid-js';
import { createMemo, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Activity, FileText, Folder, Paperclip, Terminal } from '@floegence/floe-webapp-core/icons';
import type { FlowerChatContextChip, FlowerChatContextDisplay } from '../contracts/flowerChatContextTypes';

type FlowerChatContextChipsProps = Readonly<{
  contextDisplay: FlowerChatContextDisplay;
  linkedContextLabel: string;
  truncatedLabel: string;
  onChipClick: (chip: FlowerChatContextChip) => void | Promise<void>;
  canActivateChip?: (chip: FlowerChatContextChip) => boolean;
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
  const chipsByID = createMemo(() => new Map(
    props.contextDisplay.chips.map((chip) => [chip.id, chip] as const),
  ));
  const chipIDs = createMemo(() => props.contextDisplay.chips.map((chip) => chip.id));
  return (
    <div
      class="flower-chat-context-chips"
      data-flower-context-authority={props.contextDisplay.authority}
      data-flower-context-surface={props.contextDisplay.authority === 'queued_context_action' ? props.contextDisplay.surface : undefined}
      data-flower-context-target={props.contextDisplay.authority === 'queued_context_action' ? props.contextDisplay.target : undefined}
    >
      <div class="flower-chat-context-chips-divider"><span class="flower-chat-context-chips-divider-label">{props.linkedContextLabel}</span></div>
      <div class="flower-chat-context-chips-grid">
        <For each={chipIDs()}>
          {(chipID) => {
            const initialChip = chipsByID().get(chipID)!;
            const chip = () => chipsByID().get(chipID) ?? initialChip;
            const icon = createMemo(() => chipIcon(chip().tone));
            const interactive = () => chip().action !== null && (props.canActivateChip?.(chip()) ?? true);
            const accessibleLabel = () => [
              chip().label,
              chip().detail,
              chip().truncated ? props.truncatedLabel : '',
            ].filter(Boolean).join(', ');
            let button: HTMLButtonElement | undefined;
            let pending = false;
            const setPending = (next: boolean) => {
              pending = next;
              if (!button) return;
              button.disabled = next;
              if (next) button.setAttribute('aria-busy', 'true');
              else button.removeAttribute('aria-busy');
            };
            const activate = () => {
              if (pending) return;
              const activatedChip = chip();
              setPending(true);
              const settle = () => {
                setPending(false);
                button?.focus();
              };
              Promise.resolve(props.onChipClick(activatedChip)).then(settle, settle);
            };
            const content = (
              <>
                <span class="flower-chat-context-chip-icon">
                  <Dynamic component={icon()} />
                </span>
                <span class="flower-chat-context-chip-text">
                  <span class="flower-chat-context-chip-label">{chip().label}</span>
                  <span class="flower-chat-context-chip-detail">
                    {chip().detail}
                    <Show when={chip().truncated}>
                      <span class="flower-chat-context-chip-truncated">{props.truncatedLabel}</span>
                    </Show>
                  </span>
                </span>
              </>
            );
            return (
              <Show
                when={interactive()}
                fallback={(
                  <div
                    class="flower-chat-context-chip"
                    data-flower-chat-context-chip="true"
                    data-flower-chat-context-interactive="false"
                    data-tone={chip().tone}
                    role="note"
                    aria-label={accessibleLabel()}
                  >
                    {content}
                  </div>
                )}
              >
                <button
                  ref={button}
                  type="button"
                  class="flower-chat-context-chip"
                  data-flower-chat-context-chip="true"
                  data-flower-chat-context-interactive="true"
                  data-tone={chip().tone}
                  aria-label={accessibleLabel()}
                  onClick={() => { void activate(); }}
                >
                  {content}
                </button>
              </Show>
            );
          }}
        </For>
      </div>
    </div>
  );
};
