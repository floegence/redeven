// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { MessageActions } from './MessageActions';

const retryMessageMock = vi.hoisted(() => vi.fn());
const writeTextToClipboardMock = vi.hoisted(() => vi.fn());

vi.mock('../ChatProvider', () => ({
  useChatContext: () => ({
    retryMessage: retryMessageMock,
  }),
}));

vi.mock('../../utils/clipboard', () => ({
  writeTextToClipboard: (...args: unknown[]) => writeTextToClipboardMock(...args),
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  retryMessageMock.mockReset();
  writeTextToClipboardMock.mockReset();
});

describe('MessageActions', () => {
  it('copies extracted message text and briefly shows the copied check state', async () => {
    vi.useFakeTimers();
    writeTextToClipboardMock.mockResolvedValue(undefined);

    const message: Message = {
      id: 'msg-1',
      role: 'assistant',
      status: 'complete',
      timestamp: 0,
      blocks: [
        { type: 'markdown', content: 'Alpha block' },
        { type: 'code', language: 'typescript', content: 'const value = 1;' },
        { type: 'shell', command: 'pwd', output: '/workspace', status: 'success' },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <MessageActions message={message} />, host);

    const copyButton = host.querySelector('button[aria-label="Copy message"]') as HTMLButtonElement | null;
    copyButton?.click();
    await flushAsync();

    expect(writeTextToClipboardMock).toHaveBeenCalledWith('Alpha block\n\nconst value = 1;\n\npwd\n\n/workspace');
    expect(host.querySelector('button[aria-label="Copied"]')).toBeTruthy();
    expect(host.querySelector('.chat-message-action-btn-copied')).toBeTruthy();

    vi.advanceTimersByTime(1600);
    await flushAsync();

    expect(host.querySelector('button[aria-label="Copy message"]')).toBeTruthy();
    expect(host.querySelector('.chat-message-action-btn-copied')).toBeFalsy();
  });
});
