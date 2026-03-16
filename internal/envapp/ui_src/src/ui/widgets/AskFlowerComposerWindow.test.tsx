// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AskFlowerComposerWindow } from './AskFlowerComposerWindow';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button type="button" onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  ),
  FloatingWindow: (props: any) => (
    props.open ? (
      <div data-testid="floating-window" class={props.class}>
        <div>{props.title}</div>
        <div>{props.children}</div>
        <div>{props.footer}</div>
      </div>
    ) : null
  ),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    ChevronDown: Icon,
    ChevronUp: Icon,
    Folder: Icon,
    FileText: Icon,
    Paperclip: Icon,
    Terminal: Icon,
    Send: Icon,
  };
});

vi.mock('../utils/askFlowerPath', () => ({
  resolveSuggestedWorkingDirAbsolute: ({ suggestedWorkingDirAbs }: { suggestedWorkingDirAbs?: string }) =>
    String(suggestedWorkingDirAbs ?? '').trim(),
}));

const baseIntent = {
  id: 'intent-1',
  source: 'terminal' as const,
  mode: 'append' as const,
  contextItems: [],
  pendingAttachments: [],
  notes: [],
};

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function composePrompt(host: HTMLElement, value: string): HTMLTextAreaElement {
  const textarea = host.querySelector('textarea');
  expect(textarea).toBeTruthy();
  const element = textarea as HTMLTextAreaElement;
  element.dispatchEvent(new Event('compositionstart', { bubbles: true }));
  element.value = value;
  element.dispatchEvent(new Event('compositionupdate', { bubbles: true }));
  return element;
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('AskFlowerComposerWindow', () => {
  it('submits the visible composed prompt through the send button', async () => {
    const onSend = vi.fn(async () => undefined);
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <AskFlowerComposerWindow
        open
        intent={baseIntent}
        onClose={() => undefined}
        onSend={onSend}
      />
    ), host);

    composePrompt(host, '你好，Flower');
    const sendButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Send'));
    expect(sendButton).toBeTruthy();
    sendButton?.click();
    await flushAsync();

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('你好，Flower');
  });

  it('submits the composed prompt with Ctrl+Enter after composition ends', async () => {
    const onSend = vi.fn(async () => undefined);
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <AskFlowerComposerWindow
        open
        intent={baseIntent}
        onClose={() => undefined}
        onSend={onSend}
      />
    ), host);

    const textarea = composePrompt(host, 'deploy this change');
    textarea.dispatchEvent(new Event('compositionend', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    await flushAsync();

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('deploy this change');
  });
});
