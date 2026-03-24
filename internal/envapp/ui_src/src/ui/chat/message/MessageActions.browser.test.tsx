import '../../../index.css';

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

async function settleStyles(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

afterEach(() => {
  document.body.innerHTML = '';
  retryMessageMock.mockReset();
  writeTextToClipboardMock.mockReset();
});

describe('MessageActions browser styles', () => {
  it('keeps the icon-only copy action borderless before and after the copied state swap', async () => {
    writeTextToClipboardMock.mockResolvedValue(undefined);

    const message: Message = {
      id: 'msg-1',
      role: 'assistant',
      status: 'complete',
      timestamp: 0,
      blocks: [
        { type: 'markdown', content: 'Alpha block' },
      ],
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <MessageActions message={message} />, host);
    await settleStyles();

    const copyButton = host.querySelector('button[aria-label="Copy message"]') as HTMLButtonElement | null;
    expect(copyButton).toBeTruthy();
    expect(copyButton?.querySelector('rect')).toBeTruthy();

    const before = getComputedStyle(copyButton!);
    expect(before.borderTopWidth).toBe('0px');
    expect(before.borderTopStyle).toBe('none');

    copyButton!.click();
    await settleStyles();

    const copiedButton = host.querySelector('button[aria-label="Copied"]') as HTMLButtonElement | null;
    expect(copiedButton).toBeTruthy();
    expect(copiedButton?.querySelector('rect')).toBeNull();
    expect(copiedButton?.querySelector('polyline')).toBeTruthy();

    const after = getComputedStyle(copiedButton!);
    expect(after.borderTopWidth).toBe('0px');
    expect(after.borderTopStyle).toBe('none');
  });
});
