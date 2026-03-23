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
        choices: [
          {
            choice_id: 'custom',
            label: 'Your answer',
            kind: 'write',
            input_placeholder: 'Type your answer',
          },
        ],
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
        choices: [
          {
            choice_id: 'custom',
            label: 'Your answer',
            kind: 'write',
            input_placeholder: 'Type your answer',
          },
        ],
      },
    ],
  },
};

type MockAskUserChoice = {
  choiceId: string;
  label: string;
  description?: string;
  kind: 'select' | 'write';
  inputPlaceholder?: string;
};

type MockAskUserQuestion = {
  id: string;
  header: string;
  question: string;
  isSecret?: boolean;
  choices: MockAskUserChoice[];
};

function renderAskUserBlock(opts: {
  runStatus: string;
  initialDrafts?: Record<string, { choiceId?: string; text?: string }>;
  waitingPrompt?: {
    promptId: string;
    messageId: string;
    toolId: string;
    questions?: MockAskUserQuestion[];
  } | null;
}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const [drafts, setDrafts] = createSignal<Record<string, { choiceId?: string; text?: string }>>(opts.initialDrafts ?? {});
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
    setStructuredPromptDraft: (_threadId: string, _promptId: string, questionId: string, draft: { choiceId?: string; text?: string } | null) => {
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
            choices: [
              { choiceId: 'proceed', label: 'Proceed', kind: 'select' },
              { choiceId: 'pause', label: 'Pause', kind: 'select' },
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

  it('renders an explicit custom write choice alongside fixed options', async () => {
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
            choices: [
              { choiceId: 'working', label: 'Already working', kind: 'select' },
              { choiceId: 'studying', label: 'Studying full time', kind: 'select' },
              {
                choiceId: 'other',
                label: 'None of the above',
                description: 'Type another answer.',
                kind: 'write',
                inputPlaceholder: 'Type another answer',
              },
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

  it('shows a detail input when the selected option requires extra detail', async () => {
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
            choices: [
              { choiceId: 'working', label: 'Already working', kind: 'select' },
              {
                choiceId: 'other',
                label: 'Other',
                kind: 'write',
                inputPlaceholder: 'Describe your current situation',
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
            choices: [
              {
                choiceId: 'write',
                label: 'Your answer',
                kind: 'write',
                inputPlaceholder: 'Type your answer',
              },
            ],
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
