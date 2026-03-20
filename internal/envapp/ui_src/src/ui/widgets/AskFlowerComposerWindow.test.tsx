// @vitest-environment jsdom

import { Show } from 'solid-js';
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
  Dialog: (props: any) => (
    <Show when={props.open}>
      <div data-testid="dialog" class={props.class}>
        <div>{props.title}</div>
        <div>{props.description}</div>
        <div>{props.children}</div>
        <div>{props.footer}</div>
      </div>
    </Show>
  ),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    Folder: Icon,
    FileText: Icon,
    Paperclip: Icon,
    Terminal: Icon,
    Send: Icon,
  };
});

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({
    client: () => null,
  }),
}));

vi.mock('./FilePreviewContext', () => ({
  useFilePreviewContext: () => ({
    openPreview: vi.fn(),
  }),
}));

vi.mock('../services/detachedSurface', () => ({
  buildDetachedFileBrowserSurface: (params: any) => params,
  openDetachedSurfaceWindow: vi.fn(),
}));

vi.mock('../icons/FlowerIcon', () => ({
  FlowerIcon: () => <span data-testid="flower-icon" />,
}));

vi.mock('../utils/filePreview', () => ({
  describeFilePreview: () => ({ mode: 'text' }),
  isLikelyTextContent: () => true,
}));

vi.mock('../utils/fileStreamReader', () => ({
  readFileBytesOnce: vi.fn(),
}));

vi.mock('./PreviewWindow', () => ({
  PreviewWindow: (props: any) => (
    <Show when={props.open}>
      <div data-testid="preview-window" class={props.floatingClass ?? props.mobileClass}>
        <div>{props.title}</div>
        <div>{props.description}</div>
        <div>{props.children}</div>
        <div>{props.footer}</div>
      </div>
    </Show>
  ),
  PREVIEW_WINDOW_Z_INDEX: 150,
}));

vi.mock('./PersistentFloatingWindow', () => ({
  PersistentFloatingWindow: (props: any) => (
    props.open ? (
      <div data-testid="floating-window" class={props.class}>
        <div>{props.title}</div>
        <div>{props.children}</div>
        <div>{props.footer}</div>
      </div>
    ) : null
  ),
}));

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
  it('keeps the Flower message in the scroll region and docks the user composer at the bottom', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <AskFlowerComposerWindow
        open
        intent={baseIntent}
        onClose={() => undefined}
        onSend={async () => undefined}
      />
    ), host);

    const scrollRegion = host.querySelector('[data-testid="ask-flower-scroll-region"]');
    const composerDock = host.querySelector('[data-testid="ask-flower-composer-dock"]');
    const assistantAvatar = host.querySelector('[data-testid="ask-flower-avatar"]');
    const textarea = host.querySelector('textarea');

    expect(scrollRegion).toBeTruthy();
    expect(composerDock).toBeTruthy();
    expect(textarea && composerDock?.contains(textarea)).toBe(true);
    expect(textarea && scrollRegion?.contains(textarea)).toBe(false);
    expect(assistantAvatar).toBeTruthy();
  });

  it('renders the user composer as a flat bottom dock instead of a bordered chat card', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <AskFlowerComposerWindow
        open
        intent={baseIntent}
        onClose={() => undefined}
        onSend={async () => undefined}
      />
    ), host);

    const composerDock = host.querySelector('[data-testid="ask-flower-composer-dock"]');

    expect(composerDock?.querySelector('.ask-flower-flat-input')).toBeTruthy();
    expect(composerDock?.querySelector('.chat-input-container')).toBeNull();
  });

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

  it('shows a selection preview when the highlighted context is clicked', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <AskFlowerComposerWindow
        open
        intent={{
          ...baseIntent,
          source: 'file_preview',
          contextItems: [
            {
              kind: 'file_selection',
              path: '/Users/demo/notes.md',
              selection: 'const answer = 42;',
              selectionChars: 18,
            },
          ],
        }}
        onClose={() => undefined}
        onSend={async () => undefined}
      />
    ), host);

    const selectionButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('selected content'),
    );
    expect(selectionButton).toBeTruthy();
    selectionButton?.click();
    await flushAsync();

    expect(host.querySelector('[data-testid="preview-window"]')).toBeTruthy();
    expect(host.textContent).toContain('const answer = 42;');
  });
});
