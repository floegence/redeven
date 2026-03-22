// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AIChatContext } from '../../pages/AIChatContext';
import { ChatProvider } from '../ChatProvider';
import { ToolCallBlock } from './ToolCallBlock';
import type { ToolCallBlock as ToolCallBlockType } from '../types';

afterEach(() => {
  document.body.innerHTML = '';
});

const askUserBlock: ToolCallBlockType = {
  type: 'tool-call',
  toolName: 'ask_user',
  toolId: 'tool-ask-user-1',
  status: 'success',
  args: {
    questions: [
      {
        id: 'question_1',
        header: 'Direction',
        question: 'Choose a direction.',
        is_other: true,
        is_secret: false,
      },
    ],
  },
  result: {
    waiting_user: true,
    questions: [
      {
        id: 'question_1',
        header: 'Direction',
        question: 'Choose a direction.',
        is_other: true,
        is_secret: false,
      },
    ],
  },
};

function renderAskUserBlock(opts: {
  runStatus: string;
  waitingPrompt?: {
    prompt_id: string;
    message_id: string;
    tool_id: string;
    questions?: Array<{
      id: string;
      header: string;
      question: string;
      is_other: boolean;
      is_secret: boolean;
      options?: Array<{ option_id: string; label: string; description?: string }>;
    }>;
  } | null;
}) {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const aiContextValue: any = {
    activeThreadId: () => 'thread-1',
    activeThread: () => ({
      thread_id: 'thread-1',
      title: 'Thread 1',
      run_status: opts.runStatus,
    }),
    activeThreadWaitingPrompt: () => opts.waitingPrompt ?? null,
    getStructuredPromptDrafts: () => ({}),
    setStructuredPromptDraft: () => {},
    submitStructuredPromptResponse: vi.fn(async () => ({})),
  };

  render(() => (
    <AIChatContext.Provider value={aiContextValue}>
      <ChatProvider>
        <ToolCallBlock
          block={askUserBlock}
          messageId="message-ask-user-1"
          blockIndex={0}
        />
      </ChatProvider>
    </AIChatContext.Provider>
  ), host);

  return host;
}

describe('ToolCallBlock ask_user states', () => {
  it('shows an unavailable state instead of resolved when the thread still waits for input but the active prompt is missing', () => {
    const host = renderAskUserBlock({ runStatus: 'waiting_user', waitingPrompt: null });

    expect(host.textContent).toContain('Input unavailable');
    expect(host.textContent).toContain('Flower is still waiting for input, but the active prompt details are unavailable.');
    expect(host.textContent).not.toContain('This request has been handled.');
    expect(host.querySelector('.chat-tool-ask-user-block')?.className).not.toContain('chat-tool-ask-user-block-completed');
  });

  it('keeps the resolved copy for non-waiting threads', () => {
    const host = renderAskUserBlock({ runStatus: 'success', waitingPrompt: null });

    expect(host.textContent).toContain('Input resolved');
    expect(host.textContent).toContain('This request has been handled.');
    expect(host.querySelector('.chat-tool-ask-user-block')?.className).toContain('chat-tool-ask-user-block-completed');
  });
});
