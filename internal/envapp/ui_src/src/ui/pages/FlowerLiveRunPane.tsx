import { For, Index, Show, createMemo, type Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

import { BlockRenderer } from '../chat/blocks/BlockRenderer';
import { MessageAvatar } from '../chat/message/MessageAvatar';
import { AppendOnlyText } from '../chat/status/AppendOnlyText';
import { StreamingCursor } from '../chat/status/StreamingCursor';
import type { ChatAvatar, Message, MessageBlock } from '../chat/types';
import { FlowerMessageRunIndicator } from '../widgets/FlowerMessageRunIndicator';
import {
  getLiveRunActivityBlockEntries,
  getLiveRunAnswerBlockEntries,
} from './flowerLiveRunState';

export interface FlowerLiveRunPaneProps {
  message: Message | null;
  phaseLabel?: string;
  assistantAvatar?: ChatAvatar;
  showPending?: boolean;
  class?: string;
}

function normalizeLiveRunText(input: string): string {
  return String(input ?? '').replace(/\r\n?/g, '\n');
}

function supportsInlineCursor(block: MessageBlock): boolean {
  switch (block.type) {
    case 'markdown':
    case 'text':
    case 'code':
    case 'code-diff':
    case 'svg':
    case 'mermaid':
      return true;
    default:
      return false;
  }
}

function isMonospaceBlock(block: MessageBlock): boolean {
  switch (block.type) {
    case 'code':
    case 'code-diff':
    case 'svg':
    case 'mermaid':
      return true;
    default:
      return false;
  }
}

function getLiveRunBlockText(block: MessageBlock): string {
  switch (block.type) {
    case 'markdown':
    case 'text':
    case 'code':
    case 'svg':
    case 'mermaid':
      return normalizeLiveRunText(block.content);
    case 'code-diff': {
      const parts: string[] = [];
      if (String(block.oldCode ?? '').trim()) {
        parts.push(`--- before\n${normalizeLiveRunText(block.oldCode)}`);
      }
      if (String(block.newCode ?? '').trim()) {
        parts.push(`+++ after\n${normalizeLiveRunText(block.newCode)}`);
      }
      return parts.join('\n\n');
    }
    default:
      return '';
  }
}

const LiveRunPlainTextBlock: Component<{
  block: MessageBlock;
  showCursor?: boolean;
}> = (props) => {
  const text = createMemo(() => getLiveRunBlockText(props.block));
  return (
    <div
      class={cn(
        'flower-live-run-answer-text',
        isMonospaceBlock(props.block) && 'flower-live-run-answer-text-mono',
      )}
    >
      <AppendOnlyText text={text()} />
      <Show when={props.showCursor}>
        <span class="flower-live-run-inline-cursor" aria-hidden="true">
          <StreamingCursor />
        </span>
      </Show>
    </div>
  );
};

export const FlowerLiveRunPane: Component<FlowerLiveRunPaneProps> = (props) => {
  const answerEntries = createMemo(() => getLiveRunAnswerBlockEntries(props.message));
  const activityEntries = createMemo(() => getLiveRunActivityBlockEntries(props.message));
  const showInlineCursor = createMemo(() => props.message?.status === 'streaming');
  const showPlaceholderCursor = createMemo(() => !props.message && props.showPending === true);
  const showEmptyAnswerPlaceholder = createMemo(() =>
    answerEntries().length === 0 && (showInlineCursor() || showPlaceholderCursor()),
  );
  const lastAnswerBlock = createMemo(() => answerEntries().at(-1)?.block ?? null);
  const showTailCursor = createMemo(() => (
    showInlineCursor()
    && answerEntries().length > 0
    && !!lastAnswerBlock()
    && !supportsInlineCursor(lastAnswerBlock()!)
  ));
  const showMessageBody = createMemo(() =>
    answerEntries().length > 0
    || activityEntries().length > 0
    || showEmptyAnswerPlaceholder()
    || showTailCursor(),
  );

  return (
    <div class={cn('flower-live-run-pane', props.class)}>
      <div class="flower-live-run-header">
        <FlowerMessageRunIndicator phaseLabel={props.phaseLabel} />
      </div>

      <Show when={showMessageBody()}>
        <div class="chat-message-item chat-message-item-assistant flower-live-run-item">
          <MessageAvatar
            role="assistant"
            avatar={props.assistantAvatar}
            isStreaming={props.showPending === true || props.message?.status === 'streaming'}
          />

          <div class="chat-message-content-wrapper">
            <div class="chat-message-bubble chat-message-bubble-assistant flower-live-run-answer-bubble">
              <Show
                when={answerEntries().length > 0}
                fallback={<></>}
              >
                <Index each={answerEntries()}>
                  {(entryAccessor, index) => {
                    const entry = () => entryAccessor();
                    const block = () => entry().block;
                    const isLast = () => index === answerEntries().length - 1;
                    return (
                      <div class="chat-message-block-slot">
                        <Show
                          when={supportsInlineCursor(block())}
                          fallback={(
                            <BlockRenderer
                              block={block()}
                              messageId={props.message?.id ?? 'flower-live-run'}
                              blockIndex={entry().index}
                            />
                          )}
                        >
                          <LiveRunPlainTextBlock
                            block={block()}
                            showCursor={showInlineCursor() && isLast()}
                          />
                        </Show>
                      </div>
                    );
                  }}
                </Index>

                <Show when={showTailCursor()}>
                  <div class="chat-message-block-slot flower-live-run-answer-tail" aria-hidden="true">
                    <StreamingCursor />
                  </div>
                </Show>
              </Show>

              <Show when={showEmptyAnswerPlaceholder()}>
                <div class="chat-message-block-slot flower-live-run-answer-placeholder" aria-label="Assistant is responding">
                  <StreamingCursor />
                </div>
              </Show>
            </div>

            <Show when={activityEntries().length > 0}>
              <div class="chat-message-bubble chat-message-bubble-assistant flower-live-run-activity-bubble">
                <For each={activityEntries()}>
                  {(entry) => (
                    <div class="chat-message-block-slot">
                      <BlockRenderer
                        block={entry.block}
                        messageId={props.message?.id ?? 'flower-live-run'}
                        blockIndex={entry.index}
                      />
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};
