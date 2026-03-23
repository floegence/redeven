// @vitest-environment jsdom

import { createSignal } from 'solid-js';
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
      options?: Array<{
        option_id: string;
        label: string;
        description?: string;
        detail_input_mode?: string;
        detail_input_placeholder?: string;
      }>;
    }>;
  } | null;
}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const [drafts, setDrafts] = createSignal<Record<string, { selectedOptionId?: string; answers: string[] }>>({});
  const submitStructuredPromptResponse = vi.fn(async () => ({}));

  const aiContextValue: any = {
    activeThreadId: () => 'thread-1',
    activeThread: () => ({
      thread_id: 'thread-1',
      title: 'Thread 1',
      run_status: opts.runStatus,
    }),
    activeThreadWaitingPrompt: () => opts.waitingPrompt ?? null,
    getStructuredPromptDrafts: () => drafts(),
    setStructuredPromptDraft: (_threadId: string, _promptId: string, questionId: string, draft: { selectedOptionId?: string; answers: string[] } | null) => {
      setDrafts((prev) => {
        const next = { ...prev };
        if (!draft) {
          delete next[questionId];
          return next;
        }
        next[questionId] = draft;
        return next;
      });
    },
    submitStructuredPromptResponse,
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

  return { host, submitStructuredPromptResponse };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ToolCallBlock ask_user states', () => {
  it('shows an unavailable state instead of resolved when the thread still waits for input but the active prompt is missing', () => {
    const { host } = renderAskUserBlock({ runStatus: 'waiting_user', waitingPrompt: null });

    expect(host.textContent).toContain('Input unavailable');
    expect(host.textContent).toContain('Flower is still waiting for input, but the active prompt details are unavailable.');
    expect(host.textContent).not.toContain('This request has been handled.');
    expect(host.querySelector('.chat-tool-ask-user-block')?.className).not.toContain('chat-tool-ask-user-block-completed');
  });

  it('keeps the resolved copy for non-waiting threads', () => {
    const { host } = renderAskUserBlock({ runStatus: 'success', waitingPrompt: null });

    expect(host.textContent).toContain('Input resolved');
    expect(host.textContent).toContain('This request has been handled.');
    expect(host.querySelector('.chat-tool-ask-user-block')?.className).toContain('chat-tool-ask-user-block-completed');
  });

  it('auto-submits safe single-choice prompts without rendering the explicit submit row', async () => {
    const { host, submitStructuredPromptResponse } = renderAskUserBlock({
      runStatus: 'waiting_user',
      waitingPrompt: {
        prompt_id: 'prompt-1',
        message_id: 'message-ask-user-1',
        tool_id: 'tool-ask-user-1',
        questions: [
          {
            id: 'question_1',
            header: 'Direction',
            question: 'Choose a direction.',
            is_other: false,
            is_secret: false,
            options: [
              { option_id: 'proceed', label: 'Proceed' },
              { option_id: 'pause', label: 'Pause' },
            ],
          },
        ],
      },
    });

    expect(host.querySelector('.chat-tool-ask-user-submit-row')).toBeNull();
    expect(host.textContent).toContain('Selecting an option will continue immediately.');

    const radio = host.querySelector('input[type="radio"]') as HTMLInputElement | null;
    expect(radio).toBeTruthy();
    radio!.checked = true;
    radio!.dispatchEvent(new Event('change', { bubbles: true }));
    await flushAsync();

    expect(submitStructuredPromptResponse).toHaveBeenCalledTimes(1);
    expect(submitStructuredPromptResponse).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-1',
      promptId: 'prompt-1',
      answers: {
        question_1: {
          selectedOptionId: 'proceed',
          answers: [],
        },
      },
    }));
  });

  it('shows a detail input when the selected option requires extra detail', async () => {
    const { host } = renderAskUserBlock({
      runStatus: 'waiting_user',
      waitingPrompt: {
        prompt_id: 'prompt-1',
        message_id: 'message-ask-user-1',
        tool_id: 'tool-ask-user-1',
        questions: [
          {
            id: 'question_1',
            header: 'Situation',
            question: 'Choose the closest situation.',
            is_other: false,
            is_secret: false,
            options: [
              { option_id: 'working', label: 'Already working' },
              {
                option_id: 'other',
                label: 'Other',
                detail_input_mode: 'required',
                detail_input_placeholder: 'Describe your current situation',
              },
            ],
          },
        ],
      },
    });

    expect(host.querySelector('.chat-tool-ask-user-custom-input')).toBeNull();

    const radios = host.querySelectorAll('input[type="radio"]');
    expect(radios.length).toBe(2);
    const otherRadio = radios[1] as HTMLInputElement;
    otherRadio.checked = true;
    otherRadio.dispatchEvent(new Event('change', { bubbles: true }));
    await flushAsync();

    const detailInput = host.querySelector('.chat-tool-ask-user-custom-input') as HTMLInputElement | null;
    expect(detailInput).toBeTruthy();
    expect(detailInput?.placeholder).toBe('Describe your current situation');
    expect(host.textContent).toContain('More detail is required for the selected option.');

    const continueButton = host.querySelector('.chat-tool-ask-user-custom-submit') as HTMLButtonElement | null;
    expect(continueButton).toBeTruthy();
    expect(continueButton?.disabled).toBe(true);

    detailInput!.value = 'Working and studying part time';
    detailInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushAsync();

    expect((host.querySelector('.chat-tool-ask-user-custom-submit') as HTMLButtonElement | null)?.disabled).toBe(false);
  });

  it('treats legacy optional detail prompts as required detail before submit', async () => {
    const { host } = renderAskUserBlock({
      runStatus: 'waiting_user',
      waitingPrompt: {
        prompt_id: 'prompt-1',
        message_id: 'message-ask-user-1',
        tool_id: 'tool-ask-user-1',
        questions: [
          {
            id: 'question_1',
            header: 'Situation',
            question: 'Choose the closest situation.',
            is_other: false,
            is_secret: false,
            options: [
              { option_id: 'working', label: 'Already working' },
              {
                option_id: 'other',
                label: 'Other',
                detail_input_mode: 'optional',
                detail_input_placeholder: 'Describe your current situation',
              },
            ],
          },
        ],
      },
    });

    const radios = host.querySelectorAll('input[type="radio"]');
    expect(radios.length).toBe(2);
    const otherRadio = radios[1] as HTMLInputElement;
    otherRadio.checked = true;
    otherRadio.dispatchEvent(new Event('change', { bubbles: true }));
    await flushAsync();

    expect(host.textContent).toContain('More detail is required for the selected option.');
    expect((host.querySelector('.chat-tool-ask-user-custom-submit') as HTMLButtonElement | null)?.disabled).toBe(true);
  });
});
