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
  Button: (props: any) => (
    <button type="button" onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  ),
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
    Send: Icon,
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
    expect(textarea && composerDock?.contains(textarea)).toBe(true);
    expect(textarea && scrollRegion?.contains(textarea)).toBe(false);
    expect(assistantAvatar).toBeTruthy();
    expect(assistantAvatar?.className).toContain('size-8');
    expect(assistantRow).toBeTruthy();
    expect(assistantRow?.className).not.toContain('gap-2');
    expect(assistantSurface).toBeTruthy();
    expect(assistantSurface?.className).not.toContain('border-border/65');
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
    await flushAsync();

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
