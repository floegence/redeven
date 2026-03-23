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
        is_secret: false,
        response_mode: 'write',
        write_label: 'Your answer',
        write_placeholder: 'Type your answer',
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
        is_secret: false,
        response_mode: 'write',
        write_label: 'Your answer',
        write_placeholder: 'Type your answer',
      },
    ],
  },
};

type MockAskUserChoice = {
  choiceId: string;
  label: string;
  description?: string;
  kind?: 'select';
};

type MockAskUserQuestion = {
  id: string;
  header: string;
  question: string;
  isSecret?: boolean;
  responseMode?: 'select' | 'write' | 'select_or_write';
  writeLabel?: string;
  writePlaceholder?: string;
  choices?: MockAskUserChoice[];
};

function renderAskUserBlock(opts: {
  runStatus: string;
  initialDrafts?: Record<string, { choiceId?: string; text?: string; writeSelected?: boolean }>;
  waitingPrompt?: {
    promptId: string;
    messageId: string;
    toolId: string;
    questions?: MockAskUserQuestion[];
  } | null;
}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const [drafts, setDrafts] = createSignal<Record<string, { choiceId?: string; text?: string; writeSelected?: boolean }>>(opts.initialDrafts ?? {});
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
    setStructuredPromptDraft: (_threadId: string, _promptId: string, questionId: string, draft: { choiceId?: string; text?: string; writeSelected?: boolean } | null) => {
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
        promptId: 'prompt-1',
        messageId: 'message-ask-user-1',
        toolId: 'tool-ask-user-1',
        questions: [
          {
            id: 'question_1',
            header: 'Direction',
            question: 'Choose a direction.',
            isSecret: false,
            responseMode: 'select',
            choices: [
              { choiceId: 'proceed', label: 'Proceed' },
              { choiceId: 'pause', label: 'Pause' },
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
          choiceId: 'proceed',
        },
      },
    }));
  });

  it('renders a standardized write fallback alongside fixed options', async () => {
    const { host } = renderAskUserBlock({
      runStatus: 'waiting_user',
      waitingPrompt: {
        promptId: 'prompt-1',
        messageId: 'message-ask-user-1',
        toolId: 'tool-ask-user-1',
        questions: [
          {
            id: 'question_1',
            header: 'Situation',
            question: 'Choose the closest situation.',
            isSecret: false,
            responseMode: 'select_or_write',
            writeLabel: 'None of the above',
            writePlaceholder: 'Type another answer',
            choices: [
              { choiceId: 'working', label: 'Already working' },
              { choiceId: 'studying', label: 'Studying full time' },
            ],
          },
        ],
      },
    });

    expect(host.textContent).toContain('None of the above');
    expect(host.querySelector('.chat-tool-ask-user-custom-input')).toBeNull();

    const radios = host.querySelectorAll('input[type="radio"]');
    expect(radios.length).toBe(3);
    const fallbackRadio = radios[2] as HTMLInputElement;
    fallbackRadio.checked = true;
    fallbackRadio.dispatchEvent(new Event('change', { bubbles: true }));
    await flushAsync();

    const detailInput = host.querySelector('.chat-tool-ask-user-custom-input') as HTMLInputElement | null;
    expect(detailInput).toBeTruthy();
    expect(detailInput?.placeholder).toBe('Type another answer');
    expect(host.textContent).toContain('Type your answer to continue.');
    expect((host.querySelector('.chat-tool-ask-user-custom-submit') as HTMLButtonElement | null)?.disabled).toBe(true);

    detailInput!.value = 'Working and studying part time';
    detailInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushAsync();

    expect((host.querySelector('.chat-tool-ask-user-custom-submit') as HTMLButtonElement | null)?.disabled).toBe(false);

    const firstRadio = radios[0] as HTMLInputElement;
    firstRadio.checked = true;
    firstRadio.dispatchEvent(new Event('change', { bubbles: true }));
    await flushAsync();

    expect(host.querySelector('.chat-tool-ask-user-custom-input')).toBeNull();
    expect((host.querySelector('.chat-tool-ask-user-custom-submit') as HTMLButtonElement | null)?.disabled).toBe(false);
  });

  it('uses the configured write placeholder for the standardized write fallback', async () => {
    const { host } = renderAskUserBlock({
      runStatus: 'waiting_user',
      waitingPrompt: {
        promptId: 'prompt-1',
        messageId: 'message-ask-user-1',
        toolId: 'tool-ask-user-1',
        questions: [
          {
            id: 'question_1',
            header: 'Situation',
            question: 'Choose the closest situation.',
            isSecret: false,
            responseMode: 'select_or_write',
            writeLabel: 'Other',
            writePlaceholder: 'Describe your current situation',
            choices: [
              { choiceId: 'working', label: 'Already working' },
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
    expect(host.textContent).toContain('Type your answer to continue.');

    const continueButton = host.querySelector('.chat-tool-ask-user-custom-submit') as HTMLButtonElement | null;
    expect(continueButton).toBeTruthy();
    expect(continueButton?.disabled).toBe(true);

    detailInput!.value = 'Working and studying part time';
    detailInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushAsync();

    expect((host.querySelector('.chat-tool-ask-user-custom-submit') as HTMLButtonElement | null)?.disabled).toBe(false);
  });

  it('renders a direct input for write-only questions without radio choices', async () => {
    const { host } = renderAskUserBlock({
      runStatus: 'waiting_user',
      waitingPrompt: {
        promptId: 'prompt-1',
        messageId: 'message-ask-user-1',
        toolId: 'tool-ask-user-1',
        questions: [
          {
            id: 'question_1',
            header: 'Clarify',
            question: 'What should Flower inspect next?',
            isSecret: false,
            responseMode: 'write',
            writeLabel: 'Your answer',
            writePlaceholder: 'Type your answer',
            choices: [],
          },
        ],
      },
    });

    expect(host.querySelectorAll('input[type="radio"]').length).toBe(0);
    const detailInput = host.querySelector('.chat-tool-ask-user-custom-input') as HTMLInputElement | null;
    expect(detailInput).toBeTruthy();
    expect(detailInput?.placeholder).toBe('Type your answer');
    expect((host.querySelector('.chat-tool-ask-user-custom-submit') as HTMLButtonElement | null)?.disabled).toBe(true);

    detailInput!.value = 'Inspect the build logs.';
    detailInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushAsync();

    expect((host.querySelector('.chat-tool-ask-user-custom-submit') as HTMLButtonElement | null)?.disabled).toBe(false);
  });
});
