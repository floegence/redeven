// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FlowerComposer, type FlowerComposerApi } from './FlowerComposer';
import { pushFlowerComposerHistoryEntry } from './flowerComposerHistory';

const notificationErrorMock = vi.fn();
const notificationInfoMock = vi.fn();
const notificationSuccessMock = vi.fn();
const storageState = new Map<string, string>();

const chatContextState = {
  sendMessage: vi.fn(async () => undefined),
  uploadAttachment: vi.fn(async (file: File) => `mock://${file.name}`),
  config: {
    allowAttachments: true,
    acceptedFileTypes: '.txt,image/*',
    maxAttachmentSize: 10_485_760,
    maxAttachments: 5,
    placeholder: 'Type a message...',
  },
};

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  useNotification: () => ({
    error: notificationErrorMock,
    info: notificationInfoMock,
    success: notificationSuccessMock,
  }),
}));

vi.mock('../chat', async () => {
  const actual = await vi.importActual<typeof import('../chat')>('../chat');
  return {
    ...actual,
    AttachmentPreview: (props: any) => (
      <div data-testid="attachment-preview">
        {(props.attachments ?? []).map((attachment: any) => (
          <button
            type="button"
            data-testid={`attachment-${attachment.id}`}
            onClick={() => props.onRemove?.(attachment.id)}
          >
            {attachment.file?.name ?? attachment.id}
          </button>
        ))}
      </div>
    ),
    useChatContext: () => ({
      config: () => chatContextState.config,
      sendMessage: chatContextState.sendMessage,
      uploadAttachment: chatContextState.uploadAttachment,
    }),
  };
});

function flushAsync(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

function makeAttachment(id: string, name = `${id}.txt`) {
  return {
    id,
    file: new File(['hello'], name, { type: 'text/plain' }),
    type: 'file' as const,
    uploadProgress: 100,
    status: 'uploaded' as const,
    url: `mock://${name}`,
  };
}

async function renderComposer(options?: {
  historyScopeKey?: string;
  executionMode?: 'act' | 'plan';
  onExecutionModeChange?: (mode: 'act' | 'plan') => void;
  onPickWorkingDir?: () => void;
}) {
  let api: FlowerComposerApi | null = null;
  const onExecutionModeChange = options?.onExecutionModeChange ?? vi.fn();
  const onPickWorkingDir = options?.onPickWorkingDir ?? vi.fn();

  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => (
    <FlowerComposer
      class="flower-chat-input"
      historyScopeKey={options?.historyScopeKey ?? 'flower-test'}
      executionMode={options?.executionMode ?? 'act'}
      workingDirLabel="/workspace"
      workingDirTitle="/workspace"
      onExecutionModeChange={onExecutionModeChange}
      onPickWorkingDir={onPickWorkingDir}
      onApiReady={(value) => {
        api = value;
      }}
    />
  ), host);

  await flushAsync();

  return {
    host,
    dispose,
    api: () => api,
    onExecutionModeChange,
    onPickWorkingDir,
  };
}

function composerTextarea(host: HTMLElement): HTMLTextAreaElement {
  const textarea = host.querySelector('textarea');
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('composer textarea not found');
  }
  return textarea;
}

function inputComposer(host: HTMLElement, value: string): HTMLTextAreaElement {
  const textarea = composerTextarea(host);
  textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  return textarea;
}

function setSelection(textarea: HTMLTextAreaElement, start: number, end = start): void {
  textarea.focus();
  textarea.setSelectionRange(start, end);
  textarea.dispatchEvent(new Event('select', { bubbles: true }));
}

function pressKey(textarea: HTMLTextAreaElement, key: string): void {
  textarea.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  }));
}

describe('FlowerComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageState.clear();
    window.redevenDesktopStateStorage = {
      getItem: (key) => storageState.get(key) ?? null,
      setItem: (key, value) => {
        storageState.set(key, value);
      },
      removeItem: (key) => {
        storageState.delete(key);
      },
      keys: () => Array.from(storageState.keys()),
    };
    chatContextState.sendMessage.mockResolvedValue(undefined);
    chatContextState.uploadAttachment.mockImplementation(async (file: File) => `mock://${file.name}`);
    const raf = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('recalls prompt history and restores the saved draft snapshot on escape', async () => {
    pushFlowerComposerHistoryEntry({
      scopeKey: 'history-scope',
      text: 'previous prompt',
      createdAtUnixMs: 10,
    });

    const { host, dispose, api } = await renderComposer({
      historyScopeKey: 'history-scope',
    });

    try {
      api()?.replaceDraft({
        text: 'draft in progress',
        attachments: [makeAttachment('attachment-1')],
      });
      await flushAsync();

      const textarea = composerTextarea(host);
      setSelection(textarea, textarea.value.length);
      pressKey(textarea, 'ArrowUp');
      await flushAsync();

      expect(textarea.value).toBe('previous prompt');
      expect(host.querySelector('[data-testid="attachment-preview"]')).toBeNull();

      pressKey(textarea, 'Escape');
      await flushAsync();

      expect(textarea.value).toBe('draft in progress');
      expect(host.querySelector('[data-testid="attachment-attachment-1"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('executes /plan from the slash popup and keeps the remaining draft', async () => {
    const onExecutionModeChange = vi.fn();
    const { host, dispose } = await renderComposer({
      historyScopeKey: 'plan-scope',
      onExecutionModeChange,
    });

    try {
      const textarea = inputComposer(host, '/plan investigate failing tests');
      setSelection(textarea, 5);
      await flushAsync();

      expect(host.querySelector('[data-testid="flower-composer-slash-popup"]')).toBeTruthy();

      pressKey(textarea, 'Enter');
      await flushAsync();

      expect(onExecutionModeChange).toHaveBeenCalledWith('plan');
      expect(textarea.value).toBe('investigate failing tests');
    } finally {
      dispose();
    }
  });

  it('navigates slash commands and opens the working directory picker', async () => {
    const onPickWorkingDir = vi.fn();
    const { host, dispose } = await renderComposer({
      historyScopeKey: 'cwd-scope',
      onPickWorkingDir,
    });

    try {
      const textarea = inputComposer(host, '/c');
      setSelection(textarea, 2);
      await flushAsync();

      pressKey(textarea, 'ArrowDown');
      pressKey(textarea, 'Enter');
      await flushAsync();

      expect(onPickWorkingDir).toHaveBeenCalledTimes(1);
      expect(textarea.value).toBe('');
    } finally {
      dispose();
    }
  });

  it('clears the draft text and attachments through /clear', async () => {
    const { host, dispose, api } = await renderComposer({
      historyScopeKey: 'clear-scope',
    });

    try {
      api()?.replaceDraft({
        text: '/clear',
        attachments: [makeAttachment('attachment-2')],
      });
      await flushAsync();

      const textarea = composerTextarea(host);
      setSelection(textarea, 6);
      await flushAsync();

      const button = host.querySelector('[data-testid="flower-composer-command-clear"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('clear command button not found');
      }
      button.click();
      await flushAsync();

      expect(textarea.value).toBe('');
      expect(host.querySelector('[data-testid="attachment-preview"]')).toBeNull();
    } finally {
      dispose();
    }
  });
});
