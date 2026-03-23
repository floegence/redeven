// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AskFlowerComposerWindow } from './AskFlowerComposerWindow';
import { setAskFlowerAttachmentSourcePath } from '../utils/askFlowerAttachmentMetadata';

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

vi.mock('../icons/FlowerIcon', () => ({
  FlowerIcon: () => <span data-testid="flower-icon" />,
}));

vi.mock('../utils/filePreview', () => ({
  describeFilePreview: () => ({ mode: 'text' }),
  FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR: { mode: 'text', textPresentation: 'plain', wrapText: true },
  getExtDot: (value: string) => value.slice(value.lastIndexOf('.')).toLowerCase(),
  isLikelyTextContent: () => true,
  mimeFromExtDot: () => 'text/plain',
}));

vi.mock('../utils/fileStreamReader', () => ({
  readFileBytesOnce: vi.fn(),
}));

vi.mock('./FilePreviewContent', () => ({
  FilePreviewContent: (props: any) => (
    <div data-testid="file-preview-content">
      <div>{props.item?.path}</div>
      <div>{props.text}</div>
      <div>{props.message}</div>
    </div>
  ),
}));

vi.mock('./RemoteFileBrowser', () => ({
  RemoteFileBrowser: (props: any) => (
    <div data-testid="remote-file-browser">
      <div>{props.initialPathOverride}</div>
      <div>{props.stateScope}</div>
    </div>
  ),
}));

vi.mock('./PreviewWindow', () => ({
  PreviewWindow: (props: any) => (
    <Show when={props.open}>
      <div data-testid="preview-window" data-z-index={String(props.zIndex ?? '')} class={props.floatingClass ?? props.mobileClass}>
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
      <div data-testid="floating-window" data-z-index={String(props.zIndex ?? '')} class={props.class}>
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
  await new Promise((resolve) => setTimeout(resolve, 0));
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
  it('stays above the standard file preview surface', () => {
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

    const floatingWindow = host.querySelector('[data-testid="floating-window"]');

    expect(floatingWindow?.getAttribute('data-z-index')).toBe('160');
  });

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
    expect(composerDock?.querySelector('.ask-flower-composer-toolbar')).toBeNull();
  });

  it('keeps the inline send button anchored inside the composer field', () => {
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

    const editorShell = host.querySelector('[data-testid="ask-flower-composer-editor-shell"]');
    const inlineSend = host.querySelector('[data-testid="ask-flower-inline-send"]');

    expect(editorShell).toBeTruthy();
    expect(inlineSend).toBeTruthy();
    expect(inlineSend && editorShell?.contains(inlineSend)).toBe(true);
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
    const sendButton = host.querySelector('[data-testid="ask-flower-inline-send"]') as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();
    sendButton?.click();
    await flushAsync();

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('你好，Flower');
  });

  it('submits the composed prompt with Enter after composition ends', async () => {
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
      bubbles: true,
      cancelable: true,
    }));
    await flushAsync();

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('deploy this change');
  });

  it('keeps Shift+Enter available for a newline instead of sending', async () => {
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

    const textarea = composePrompt(host, 'keep editing');
    textarea.dispatchEvent(new Event('compositionend', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));
    await flushAsync();

    expect(onSend).not.toHaveBeenCalled();
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

  it('renders the Flower bubble as a plain question with linked context below it', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <AskFlowerComposerWindow
        open
        intent={{
          ...baseIntent,
          source: 'file_browser',
          contextItems: [
            {
              kind: 'file_path',
              path: '/Users/demo/project',
              isDirectory: true,
            },
          ],
        }}
        onClose={() => undefined}
        onSend={async () => undefined}
      />
    ), host);

    expect(host.textContent).toContain('What would you like to explore inside it?');
    expect(host.textContent).toContain('Linked context');
    expect(host.textContent).not.toContain('Question');
    expect(host.textContent).not.toContain('Files');
  });

  it('opens directory linked context in a floating file browser window', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <AskFlowerComposerWindow
        open
        intent={{
          ...baseIntent,
          source: 'file_browser',
          contextItems: [
            {
              kind: 'file_path',
              path: '/Users/demo/project',
              isDirectory: true,
            },
          ],
        }}
        onClose={() => undefined}
        onSend={async () => undefined}
      />
    ), host);

    const directoryButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('project') && button.getAttribute('title')?.includes('/Users/demo/project'),
    );
    expect(directoryButton).toBeTruthy();
    directoryButton?.click();
    await flushAsync();

    expect(host.querySelector('[data-testid="remote-file-browser"]')).toBeTruthy();
    expect(host.textContent).toContain('/Users/demo/project');
  });

  it('collapses a matching file-browser attachment into a single linked context entry and previews the attached snapshot', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const attachment = setAskFlowerAttachmentSourcePath(
      new File(['export default [];'], 'eslint.config.mjs', { type: 'text/plain' }),
      '/Users/demo/eslint.config.mjs',
    );

    render(() => (
      <AskFlowerComposerWindow
        open
        intent={{
          ...baseIntent,
          source: 'file_browser',
          contextItems: [
            {
              kind: 'file_path',
              path: '/Users/demo/eslint.config.mjs',
              isDirectory: false,
            },
          ],
          pendingAttachments: [attachment],
        }}
        onClose={() => undefined}
        onSend={async () => undefined}
      />
    ), host);

    expect(host.textContent).not.toContain('1 linked');
    expect(host.textContent).not.toContain('Queued attachment');
    expect(host.textContent).not.toContain('Ctrl/⌘');

    const fileButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('eslint.config.mjs') && button.getAttribute('title')?.includes('/Users/demo/eslint.config.mjs'),
    );
    expect(fileButton).toBeTruthy();
    fileButton?.click();
    await flushAsync();

    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="preview-window"]')).toBeTruthy();
      expect(host.textContent).toContain('Showing the attached snapshot that Flower will receive.');
      expect(host.textContent).toContain('export default [];');
    });
  });
});
