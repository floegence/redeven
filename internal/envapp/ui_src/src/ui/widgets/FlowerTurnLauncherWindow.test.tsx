// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlowerTurnLauncherAttachmentSourcePath } from '../../../../../flower_ui/src/flowerTurnLauncherCopy';

import { FlowerTurnLauncherWindow } from './FlowerTurnLauncherWindow';
import { I18nProvider } from '../i18n';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from '../i18n/storageKey';
import {
  REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR,
  REDEVEN_WORKBENCH_WHEEL_ROLE_ATTR,
  REDEVEN_WORKBENCH_WHEEL_ROLE_LOCAL_SCROLL_VIEWPORT,
} from '../workbench/surface/workbenchWheelInteractive';

const filePreviewContextMock = vi.hoisted(() => ({
  openPreview: vi.fn(async () => undefined),
}));

const fileStreamReaderMock = vi.hoisted(() => ({
  readFileBytesOnce: vi.fn(),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
  Button: (props: any) => {
    const Icon = props.icon;
    return (
      <button
        type="button"
        class={props.class}
        data-testid={props['data-testid']}
        data-variant={props.variant}
        data-size={props.size}
        onClick={props.onClick}
        disabled={props.disabled || props.loading}
        title={props.title}
        aria-label={props['aria-label']}
        aria-busy={props['aria-busy']}
      >
        {props.loading
          ? <span data-testid="button-loading-indicator" class="animate-spin" />
          : (Icon ? <Icon /> : null)}
        {props.children}
      </button>
    );
  },
  FloatingWindow: (props: any) => (
    props.open ? (
      <div
        data-testid="floating-window"
        data-z-index={String(props.zIndex ?? '')}
        data-default-width={String(props.defaultSize?.width ?? '')}
        data-default-height={String(props.defaultSize?.height ?? '')}
        class={props.class}
      >
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
    Activity: Icon,
    AlertTriangle: Icon,
    Terminal: Icon,
    ArrowUp: () => <span data-testid="arrow-up-icon" />,
  };
});

vi.mock('./FilePreviewContext', () => ({
  useFilePreviewContext: () => ({
    openPreview: filePreviewContextMock.openPreview,
  }),
}));

vi.mock('../icons/FlowerIcon', () => ({
  FlowerIcon: () => <span data-testid="flower-icon" />,
}));

vi.mock('../utils/filePreview', () => ({
  describeFilePreview: (value: string) => {
    const normalized = String(value ?? '').toLowerCase();
    if (normalized.endsWith('.xlsx') || normalized.endsWith('.xls')) return { mode: 'xlsx' };
    return { mode: 'text' };
  },
  FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR: { mode: 'text', textPresentation: 'plain', wrapText: true },
  getExtDot: (value: string) => value.slice(value.lastIndexOf('.')).toLowerCase(),
  isLikelyTextContent: () => true,
  mimeFromExtDot: () => 'text/plain',
}));

vi.mock('../utils/fileStreamReader', () => fileStreamReaderMock);

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
      <div
        data-testid="floating-window"
        data-z-index={String(props.zIndex ?? '')}
        data-default-width={String(props.defaultSize?.width ?? '')}
        data-default-height={String(props.defaultSize?.height ?? '')}
        class={props.class}
      >
        <div>{props.title}</div>
        <div>{props.children}</div>
        <div>{props.footer}</div>
      </div>
    ) : null
  ),
}));

const baseIntent = {
  id: 'intent-1',
  source_surface: 'terminal' as const,
  context_items: [],
  pending_attachments: [],
  notes: [],
};

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
  window.localStorage.clear();
  delete window.redevenDesktopLanguage;
  filePreviewContextMock.openPreview.mockClear();
  fileStreamReaderMock.readFileBytesOnce.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('FlowerTurnLauncherWindow', () => {
  it('stays above the standard file preview surface', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
        open
        intent={baseIntent}
        onClose={() => undefined}
        onSubmit={async () => undefined}
      />
    ), host);

    const floatingWindow = host.querySelector('[data-testid="floating-window"]');

    expect(floatingWindow?.getAttribute('data-z-index')).toBe('160');
    expect(floatingWindow?.getAttribute('data-default-width')).toBe('560');
    expect(floatingWindow?.getAttribute('data-default-height')).toBe('640');
  });

  it('keeps the Flower message in the scroll region and docks the user composer at the bottom', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
        open
        intent={baseIntent}
        onClose={() => undefined}
        onSubmit={async () => undefined}
      />
    ), host);

    const scrollRegion = host.querySelector('[data-testid="flower-turn-launcher-scroll-region"]');
    const composerDock = host.querySelector('[data-testid="flower-turn-launcher-dock"]');
    const assistantAvatar = host.querySelector('[data-testid="flower-turn-launcher-avatar"]');
    const assistantSurface = host.querySelector('.flower-turn-launcher-message-surface');
    const assistantRow = host.querySelector('.flower-turn-launcher-message-row');
    const textarea = host.querySelector('textarea');

    expect(scrollRegion).toBeTruthy();
    expect(scrollRegion?.className).toContain('flower-turn-launcher-scroll-region');
    expect(scrollRegion?.getAttribute(REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR)).toBe('true');
    expect(scrollRegion?.getAttribute(REDEVEN_WORKBENCH_WHEEL_ROLE_ATTR)).toBe(REDEVEN_WORKBENCH_WHEEL_ROLE_LOCAL_SCROLL_VIEWPORT);
    expect(composerDock).toBeTruthy();
    expect(composerDock?.className).toContain('color-mix(in_srgb,var(--foreground)_32%,transparent)');
    expect(textarea && composerDock?.contains(textarea)).toBe(true);
    expect(textarea && scrollRegion?.contains(textarea)).toBe(false);
    expect(assistantAvatar).toBeTruthy();
    expect(assistantAvatar?.className).toContain('size-8');
    expect(assistantAvatar?.firstElementChild?.className).toContain('color-mix(in_srgb,var(--background)_55%,transparent)');
    expect(assistantAvatar?.lastElementChild?.className).toContain('var(--redeven-status-warning-soft)');
    expect(assistantRow).toBeTruthy();
    expect(assistantRow?.className).not.toContain('gap-2');
    expect(assistantSurface).toBeTruthy();
    expect(assistantSurface?.className).not.toContain('border-border/65');
    expect(assistantSurface?.className).toContain('color-mix(in_srgb,var(--foreground)_34%,transparent)');
  });

  it('renders the user composer as a flat bottom dock instead of a bordered chat card', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
        open
        intent={baseIntent}
        onClose={() => undefined}
        onSubmit={async () => undefined}
      />
    ), host);

    const composerDock = host.querySelector('[data-testid="flower-turn-launcher-dock"]');

    expect(composerDock?.querySelector('.flower-turn-launcher-input')).toBeTruthy();
    expect(composerDock?.querySelector('.chat-input-container')).toBeNull();
    expect(composerDock?.querySelector('.flower-turn-launcher-toolbar')).toBeNull();
  });

  it('localizes product chrome while preserving prompt and context content', async () => {
    window.localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, 'zh-CN');
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <I18nProvider>
        <FlowerTurnLauncherWindow
          open
          intent={{
            ...baseIntent,
            source_surface: 'file_preview',
            suggested_working_dir: '/Users/demo/project',
            context_items: [
              {
                kind: 'file_selection',
                path: '/Users/demo/project/src/main.ts',
                selection: 'const answer = 42;',
                selection_chars: 18,
              },
            ],
            initial_prompt: 'Please keep this user prompt in English.',
          }}
          onClose={() => undefined}
          onSubmit={async () => undefined}
        />
      </I18nProvider>
    ), host);
    await vi.waitFor(() => {
      expect(host.textContent).toContain('询问 Flower');
    });

    expect(host.textContent).toContain('询问 Flower');
    expect(host.textContent).toContain('工作目录');
    expect(host.textContent).toContain('关联上下文');
    expect(host.textContent).toContain('你');
    expect(host.textContent).toContain('回复 Flower');
    expect(host.textContent).toContain('已选内容');
    const selectionButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('已选内容'),
    );
    expect(selectionButton?.getAttribute('title')).toBe('预览来自 /Users/demo/project/src/main.ts 的已选内容');

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = host.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement | null;
    expect(textarea?.value).toBe('Please keep this user prompt in English.');
    expect(textarea?.getAttribute('placeholder')).toBe('询问这段选择内容、请求修改，或描述你的需求');
    expect(sendButton?.getAttribute('aria-label')).toBe('发送消息');
  });

  it('keeps the inline send button anchored inside the composer field', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
        open
        intent={baseIntent}
        onClose={() => undefined}
        onSubmit={async () => undefined}
      />
    ), host);

    const editorShell = host.querySelector('[data-testid="flower-turn-launcher-editor-shell"]');
    const inlineSend = host.querySelector('[data-testid="flower-turn-launcher-inline-send"]');

    expect(editorShell).toBeTruthy();
    expect(inlineSend).toBeTruthy();
    expect(inlineSend && editorShell?.contains(inlineSend)).toBe(true);
  });

  it('matches the Flower composer circular ArrowUp action', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
        open
        intent={{ ...baseIntent, initial_prompt: 'Inspect this context' }}
        onClose={() => undefined}
        onSubmit={async () => undefined}
      />
    ), host);

    const sendButton = host.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();
    expect(sendButton?.dataset.variant).toBe('primary');
    expect(sendButton?.dataset.size).toBe('icon');
    expect(sendButton?.className).toContain('flower-composer-submit');
    expect(sendButton?.className).toContain('flower-turn-launcher-send-btn');
    expect(sendButton?.className).toContain('rounded-full');
    expect(sendButton?.querySelector('[data-testid="arrow-up-icon"]')).toBeTruthy();
    expect(sendButton?.getAttribute('aria-busy')).toBe('false');
  });

  it('shows immediate loading and blocks duplicate actions after clicking send', async () => {
    const pending = deferred<void>();
    const onSubmit = vi.fn(() => pending.promise);
    const onClose = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
        open
        intent={{
          ...baseIntent,
          source_surface: 'file_browser',
          context_items: [{ kind: 'file_path', path: '/Users/demo/project', is_directory: true }],
        }}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    ), host);

    const textarea = composePrompt(host, 'Inspect this project');
    const sendButton = host.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement;
    const contextButton = host.querySelector('.flower-turn-launcher-message-surface button') as HTMLButtonElement;
    const closeButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Close');

    sendButton.click();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(sendButton.disabled).toBe(true);
    expect(sendButton.getAttribute('aria-busy')).toBe('true');
    expect(sendButton.getAttribute('aria-label')).toBe('Sending...');
    expect(sendButton.querySelector('[data-testid="button-loading-indicator"]')).toBeTruthy();
    expect(textarea.disabled).toBe(true);
    expect(contextButton.disabled).toBe(true);
    expect(closeButton?.disabled).toBe(true);

    sendButton.click();
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    contextButton.click();
    closeButton?.click();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    pending.resolve();
    await flushAsync();

    expect(sendButton.disabled).toBe(false);
    expect(sendButton.getAttribute('aria-busy')).toBe('false');
    expect(sendButton.querySelector('[data-testid="arrow-up-icon"]')).toBeTruthy();
    expect(textarea.disabled).toBe(false);
  });

  it('shows immediate loading after Enter submits the prompt', async () => {
    const pending = deferred<void>();
    const onSubmit = vi.fn(() => pending.promise);
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
        open
        intent={baseIntent}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />
    ), host);

    const textarea = composePrompt(host, 'Run the checks');
    textarea.dispatchEvent(new Event('compositionend', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));

    const sendButton = host.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement;
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(sendButton.disabled).toBe(true);
    expect(sendButton.getAttribute('aria-busy')).toBe('true');
    expect(sendButton.querySelector('[data-testid="button-loading-indicator"]')).toBeTruthy();

    pending.resolve();
    await flushAsync();
  });

  it('restores the ArrowUp action and preserves the draft after a failed send', async () => {
    const firstAttempt = deferred<void>();
    const onSubmit = vi.fn()
      .mockImplementationOnce(() => firstAttempt.promise)
      .mockResolvedValueOnce(undefined);
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
        open
        intent={baseIntent}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />
    ), host);

    const textarea = composePrompt(host, 'Keep this draft');
    const sendButton = host.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement;
    sendButton.click();
    firstAttempt.reject(new Error('Runtime unavailable'));
    await flushAsync();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Runtime unavailable');
    expect(textarea.value).toBe('Keep this draft');
    expect(textarea.disabled).toBe(false);
    expect(document.activeElement).toBe(textarea);
    expect(sendButton.disabled).toBe(false);
    expect(sendButton.getAttribute('aria-busy')).toBe('false');
    expect(sendButton.querySelector('[data-testid="arrow-up-icon"]')).toBeTruthy();

    sendButton.click();
    await flushAsync();
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('submits the visible composed prompt through the send button', async () => {
    const onSubmit = vi.fn(async () => undefined);
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
        open
        intent={baseIntent}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />
    ), host);

    composePrompt(host, '你好，Flower');
    const sendButton = host.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();
    sendButton?.click();
    await flushAsync();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ prompt: '你好，Flower', intent: baseIntent });
  });

  it('submits the composed prompt with Enter after composition ends', async () => {
    const onSubmit = vi.fn(async () => undefined);
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
        open
        intent={baseIntent}
        onClose={() => undefined}
        onSubmit={onSubmit}
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

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ prompt: 'deploy this change', intent: baseIntent });
  });

  it('keeps Shift+Enter available for a newline instead of sending', async () => {
    const onSubmit = vi.fn(async () => undefined);
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
        open
        intent={baseIntent}
        onClose={() => undefined}
        onSubmit={onSubmit}
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

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a selection preview when the highlighted context is clicked', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
          open
          intent={{
            ...baseIntent,
            source_surface: 'file_preview',
            context_items: [
              {
                kind: 'file_selection',
                path: '/Users/demo/notes.md',
                selection: 'const answer = 42;',
                selection_chars: 18,
              },
            ],
          }}
          onClose={() => undefined}
          onSubmit={async () => undefined}
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

  it('opens the live file preview from the selection secondary action', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
          open
          intent={{
            ...baseIntent,
            source_surface: 'file_preview',
            context_items: [
              {
                kind: 'file_selection',
                path: '/Users/demo/notes.md',
                selection: 'const answer = 42;',
                selection_chars: 18,
              },
            ],
          }}
          onClose={() => undefined}
          onSubmit={async () => undefined}
        />
    ), host);

    const liveFileButton = host.querySelector('button[aria-label="Open live file preview for notes.md"]') as HTMLButtonElement | null;
    expect(liveFileButton).toBeTruthy();
    liveFileButton?.click();
    await flushAsync();

    expect(filePreviewContextMock.openPreview).toHaveBeenCalledWith(expect.objectContaining({
      path: '/Users/demo/notes.md',
      name: 'notes.md',
      type: 'file',
    }));
    expect(host.querySelector('[data-testid="preview-window"]')).toBeFalsy();
  });

  it('renders the Flower bubble as a plain question with linked context below it', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
          open
          intent={{
            ...baseIntent,
            source_surface: 'file_browser',
            context_items: [
              {
                kind: 'file_path',
                path: '/Users/demo/project',
                is_directory: true,
              },
            ],
          }}
          onClose={() => undefined}
          onSubmit={async () => undefined}
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
      <FlowerTurnLauncherWindow
          open
          intent={{
            ...baseIntent,
            source_surface: 'file_browser',
            context_items: [
              {
                kind: 'file_path',
                path: '/Users/demo/project',
                is_directory: true,
              },
            ],
          }}
          onClose={() => undefined}
          onSubmit={async () => undefined}
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

  it('opens file-browser file linked context in the full live file preview', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
          open
          intent={{
            ...baseIntent,
            source_surface: 'file_browser',
            context_items: [
              {
                kind: 'file_path',
                path: '/Users/demo/app.ts',
                is_directory: false,
              },
            ],
          }}
          onClose={() => undefined}
          onSubmit={async () => undefined}
        />
    ), host);

    const fileButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('app.ts') && button.getAttribute('title')?.includes('/Users/demo/app.ts'),
    );
    expect(fileButton).toBeTruthy();
    fileButton?.click();
    await flushAsync();

    expect(filePreviewContextMock.openPreview).toHaveBeenCalledWith(expect.objectContaining({
      path: '/Users/demo/app.ts',
      name: 'app.ts',
      type: 'file',
    }));
    expect(host.querySelector('[data-testid="preview-window"]')).toBeFalsy();
  });

  it('opens file-preview file linked context in the full live file preview without the inline reader', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
          open
          intent={{
            ...baseIntent,
            source_surface: 'file_preview',
            context_items: [
              {
                kind: 'file_path',
                path: '/Users/demo/current.md',
                is_directory: false,
              },
            ],
          }}
          onClose={() => undefined}
          onSubmit={async () => undefined}
        />
    ), host);

    const fileButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('current.md') && button.getAttribute('title')?.includes('/Users/demo/current.md'),
    );
    expect(fileButton).toBeTruthy();
    fileButton?.click();
    await flushAsync();

    expect(filePreviewContextMock.openPreview).toHaveBeenCalledWith(expect.objectContaining({
      path: '/Users/demo/current.md',
      name: 'current.md',
      type: 'file',
    }));
    expect(fileStreamReaderMock.readFileBytesOnce).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="preview-window"]')).toBeFalsy();
  });

  it('collapses a matching file-browser attachment into one live file entry with an explicit snapshot action', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const attachment = setFlowerTurnLauncherAttachmentSourcePath(
      new File(['export default [];'], 'eslint.config.mjs', { type: 'text/plain' }),
      '/Users/demo/eslint.config.mjs',
    );

    render(() => (
      <FlowerTurnLauncherWindow
          open
          intent={{
            ...baseIntent,
            source_surface: 'file_browser',
            context_items: [
              {
                kind: 'file_path',
                path: '/Users/demo/eslint.config.mjs',
                is_directory: false,
              },
            ],
            pending_attachments: [attachment],
          }}
          onClose={() => undefined}
          onSubmit={async () => undefined}
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

    expect(filePreviewContextMock.openPreview).toHaveBeenCalledWith(expect.objectContaining({
      path: '/Users/demo/eslint.config.mjs',
      name: 'eslint.config.mjs',
      type: 'file',
    }));
    expect(host.querySelector('[data-testid="preview-window"]')).toBeFalsy();

    const snapshotButton = host.querySelector('button[aria-label="Preview attached snapshot for eslint.config.mjs"]') as HTMLButtonElement | null;
    expect(snapshotButton).toBeTruthy();
    snapshotButton?.click();
    await flushAsync();

    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="preview-window"]')).toBeTruthy();
      expect(host.textContent).toContain('Showing the attached snapshot that Flower will receive.');
      expect(host.textContent).toContain('export default [];');
    });
  });

  it('shows a lightweight attached snapshot notice for spreadsheet files instead of parsing them inline', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const attachment = setFlowerTurnLauncherAttachmentSourcePath(
      new File([new Uint8Array([1, 2, 3])], 'report.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      '/Users/demo/report.xlsx',
    );

    render(() => (
      <FlowerTurnLauncherWindow
          open
          intent={{
            ...baseIntent,
            source_surface: 'file_browser',
            context_items: [
              {
                kind: 'file_path',
                path: '/Users/demo/report.xlsx',
                is_directory: false,
              },
            ],
            pending_attachments: [attachment],
          }}
          onClose={() => undefined}
          onSubmit={async () => undefined}
        />
    ), host);

    const snapshotButton = host.querySelector('button[aria-label="Preview attached snapshot for report.xlsx"]') as HTMLButtonElement | null;
    expect(snapshotButton).toBeTruthy();
    snapshotButton?.click();
    await flushAsync();

    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="preview-window"]')).toBeTruthy();
      expect(host.textContent).toContain('Spreadsheet snapshots are sent to Flower');
      expect(host.textContent).toContain('Open live file preview');
      expect(host.textContent).not.toContain('Maximum call stack size exceeded');
    });
  });

  it('maps attachment preview stack overflows to a user-facing recovery message', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const brokenAttachment = new File(['broken'], 'broken.txt', { type: 'text/plain' });
    Object.defineProperty(brokenAttachment, 'arrayBuffer', {
      value: async () => {
        throw new RangeError('Maximum call stack size exceeded');
      },
    });

    render(() => (
      <FlowerTurnLauncherWindow
          open
          intent={{
            ...baseIntent,
            source_surface: 'file_browser',
            pending_attachments: [brokenAttachment],
          }}
          onClose={() => undefined}
          onSubmit={async () => undefined}
        />
    ), host);

    const attachmentButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('broken.txt') && button.getAttribute('title')?.includes('Preview attachment broken.txt'),
    );
    expect(attachmentButton).toBeTruthy();
    attachmentButton?.click();
    await flushAsync();

    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="preview-window"]')).toBeTruthy();
      expect(host.textContent).toContain('The attachment preview renderer could not open this snapshot.');
      expect(host.textContent).not.toContain('Maximum call stack size exceeded');
    });
  });
});
