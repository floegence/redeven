// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render as renderRoot } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlowerTurnLauncherAttachmentSourcePath } from '../../../../../flower_ui/src/flowerTurnLauncherCopy';
import { flowerTurnAdmissionError } from '../../../../../flower_ui/src/flowerTurnAdmission';
import type { FlowerSettingsSnapshot, FlowerModelDirectory } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { FlowerTurnLauncherSubmitInput } from '../../../../../flower_ui/src/FlowerTurnLauncherWindow';

import { FlowerTurnLauncherWindow } from './FlowerTurnLauncherWindow';
import { I18nProvider } from '../i18n';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from '../i18n/storageKey';
import {
  REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR,
  REDEVEN_WORKBENCH_WHEEL_ROLE_ATTR,
  REDEVEN_WORKBENCH_WHEEL_ROLE_LOCAL_SCROLL_VIEWPORT,
} from '../workbench/surface/workbenchWheelInteractive';

const disposers: Array<() => void> = [];
const render: typeof renderRoot = (...args) => {
  const dispose = renderRoot(...args);
  disposers.push(dispose);
  return dispose;
};

const filePreviewContextMock = vi.hoisted(() => ({
  openPreview: vi.fn(async () => undefined),
}));

const fileStreamReaderMock = vi.hoisted(() => ({
  readFileBytesOnce: vi.fn(),
}));

vi.mock('solid-js/web', async (importOriginal) => ({
  ...await importOriginal<typeof import('solid-js/web')>(),
  Portal: (props: { children: import('solid-js').JSX.Element }) => props.children,
}));

vi.mock('@floegence/floe-webapp-core/ui', async (importOriginal) => ({
  LOCAL_INTERACTION_SURFACE_ATTR: (await importOriginal<typeof import('@floegence/floe-webapp-core/ui')>()).LOCAL_INTERACTION_SURFACE_ATTR,
  PromptCard: (await importOriginal<typeof import('@floegence/floe-webapp-core/ui')>()).PromptCard,
  resolveFloatingWindowViewport: (await importOriginal<typeof import('@floegence/floe-webapp-core/ui')>()).resolveFloatingWindowViewport,
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
        <button data-testid="floating-window-close" onClick={() => props.onOpenChange?.(false)}>Window close</button>
        <div>{props.children}</div>
        <Show when={props.footer}>
          <div data-testid="floating-window-footer">{props.footer}</div>
        </Show>
      </div>
    ) : null
  ),
  Dialog: (props: any) => (
    <Show when={props.open}>
      <div data-testid="dialog" class={props.class}>
        <div>{props.title}</div>
        <div>{props.bodyDescription}</div>
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
    Code: Icon,
    MessageSquare: Icon,
    Paperclip: Icon,
    Activity: Icon,
    Bot: Icon,
    Check: Icon,
    AlertTriangle: Icon,
    Terminal: Icon,
    X: Icon,
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
    if (normalized.endsWith('.html')) return { mode: 'html', language: 'html' };
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
    <div data-testid="file-preview-content" data-preview-mode={props.descriptor.mode} data-preview-bytes={props.bytes ? JSON.stringify([...props.bytes]) : undefined} data-preview-truncated={String(!!props.truncated)}>
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
        <div>{props.headerActions}</div>
        <div>{props.children}</div>
        <div>{props.footer}</div>
      </div>
    </Show>
  ),
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
  await new Promise(resolve => setTimeout(resolve, 60));
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
  vi.stubGlobal('crypto', {
    getRandomValues: vi.fn((buffer: Uint8Array) => {
      buffer.fill(0);
      buffer[buffer.length - 1] = 1;
      return buffer;
    }),
  });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  window.localStorage.clear();
  delete window.redevenDesktopLanguage;
  filePreviewContextMock.openPreview.mockClear();
  fileStreamReaderMock.readFileBytesOnce.mockClear();
});

afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('FlowerTurnLauncherWindow', () => {
  it('uses the shared layer band with an independent content-sized ask card', () => {
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

    const card = host.querySelector('[data-floe-prompt-card]');
    expect(card).not.toBeNull();
    expect((card?.parentElement as HTMLElement).style.zIndex).toBe('1000');
    expect(card?.getAttribute('role')).toBe('dialog');
    expect(host.querySelector('[data-testid="floating-window"]')).toBeNull();
    expect(host.querySelector('.flower-turn-launcher-footer')).toBeNull();
  });

  it('retains the context footer only in panel placement', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
        open
        placement="panel"
        intent={{ ...baseIntent, suggested_working_dir: '/Users/demo/project' }}
        onClose={() => undefined}
        onSubmit={async () => undefined}
      />
    ), host);

    expect(host.querySelector('[data-testid="floating-window"]')).toBeNull();
    expect(host.querySelector('.flower-turn-launcher-footer')).not.toBeNull();
    expect(host.textContent).toContain('Working dir');
    expect(host.textContent).toContain('/Users/demo/project');
  });

  it('uses the upstream reading viewport and single input focus boundary', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    render(() => <FlowerTurnLauncherWindow open intent={baseIntent} onClose={() => undefined} onSubmit={async () => undefined} />, host);
    const body = host.querySelector('.floe-prompt-card-body');
    expect(body?.getAttribute(REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR)).toBe('true');
    expect(body?.getAttribute(REDEVEN_WORKBENCH_WHEEL_ROLE_ATTR)).toBe(REDEVEN_WORKBENCH_WHEEL_ROLE_LOCAL_SCROLL_VIEWPORT);
    expect(body?.querySelector('.floe-prompt-card-question')).toBeNull();
    expect(body?.querySelector('[data-floe-input-surface] textarea')).toBeTruthy();
    expect(host.querySelector('.flower-turn-launcher-avatar')).toBeNull();
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
    expect(host.textContent).not.toContain('工作目录');
    expect(host.querySelector('.flower-composer-context-references')?.getAttribute('aria-label')).toBe('关联上下文');
    expect(host.querySelector('textarea')?.getAttribute('aria-label')).toBe('你');
    expect(host.querySelector('.flower-composer-context-reference')?.textContent).toBe('main.ts');
    const selectionButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.title.includes('预览来自 /Users/demo/project/src/main.ts 的已选内容'),
    );
    expect(selectionButton?.getAttribute('title')).toBe('预览来自 /Users/demo/project/src/main.ts 的已选内容\nmain.ts');

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = host.querySelector(':is(.floe-prompt-card-submit, [data-testid="flower-turn-launcher-inline-send"])') as HTMLButtonElement | null;
    expect(textarea?.value).toBe('Please keep this user prompt in English.');
    expect(textarea?.getAttribute('placeholder')).toBeNull();
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

    const editorShell = host.querySelector('.floe-prompt-card-composer');
    const inlineSend = host.querySelector(':is(.floe-prompt-card-submit, [data-testid="flower-turn-launcher-inline-send"])');

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

    const sendButton = host.querySelector(':is(.floe-prompt-card-submit, [data-testid="flower-turn-launcher-inline-send"])') as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();
    expect(sendButton?.className).toContain('floe-prompt-card-submit');
    expect(sendButton?.querySelector('svg')).toBeTruthy();
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
    textarea.dispatchEvent(new Event('compositionend', { bubbles: true }));
    const sendButton = host.querySelector(':is(.floe-prompt-card-submit, [data-testid="flower-turn-launcher-inline-send"])') as HTMLButtonElement;
    const contextButton = host.querySelector('.flower-composer-context-reference button') as HTMLButtonElement;
    const closeButton = host.querySelector('.floe-prompt-card-close') as HTMLButtonElement;

    sendButton.click();

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(sendButton.disabled).toBe(true);
    expect(sendButton.getAttribute('aria-busy')).toBe('true');
    expect(sendButton.getAttribute('aria-label')).toBe('Sending...');
    expect(sendButton.querySelector('.animate-spin')).toBeTruthy();
    expect(textarea.disabled).toBe(true);
    expect(contextButton.disabled).toBe(true);

    sendButton.click();
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    contextButton.click();
    closeButton.click();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    pending.resolve();
    await flushAsync();

    expect(sendButton.disabled).toBe(false);
    expect(sendButton.getAttribute('aria-busy')).toBe('false');
    expect(sendButton.querySelector('svg')).toBeTruthy();
    expect(textarea.disabled).toBe(false);

    closeButton.click();
    expect(onClose).toHaveBeenCalledTimes(1);
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

    const sendButton = host.querySelector(':is(.floe-prompt-card-submit, [data-testid="flower-turn-launcher-inline-send"])') as HTMLButtonElement;
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(sendButton.disabled).toBe(true);
    expect(sendButton.getAttribute('aria-busy')).toBe('true');
    expect(sendButton.querySelector('.animate-spin')).toBeTruthy();

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
    const sendButton = host.querySelector(':is(.floe-prompt-card-submit, [data-testid="flower-turn-launcher-inline-send"])') as HTMLButtonElement;
    sendButton.click();
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    firstAttempt.reject(new Error('Runtime unavailable'));
    await flushAsync();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Runtime unavailable');
    expect(textarea.value).toBe('Keep this draft');
    expect(textarea.disabled).toBe(false);
    expect(document.activeElement).toBe(textarea);
    expect(sendButton.disabled).toBe(false);
    expect(sendButton.getAttribute('aria-busy')).toBe('false');
    expect(sendButton.querySelector('svg')).toBeTruthy();

    sendButton.click();
    await flushAsync();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[0]?.[0].client_request_id).toBe(
      onSubmit.mock.calls[1]?.[0].client_request_id,
    );
  });

  it('presents an unresolved admission as status instead of a failed-send alert', async () => {
    let attempts = 0;
    const onSubmit = vi.fn(async (_input: FlowerTurnLauncherSubmitInput) => {
      attempts += 1;
      if (attempts === 1) throw flowerTurnAdmissionError('unknown', new Error('response lost'));
    });
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FlowerTurnLauncherWindow
        open
        intent={{ ...baseIntent, initial_prompt: 'Send this once' }}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />
    ), host);

    const sendButton = host.querySelector(':is(.floe-prompt-card-submit, [data-testid="flower-turn-launcher-inline-send"])') as HTMLButtonElement;
    sendButton.click();
    await flushAsync();

    expect(host.querySelector('[role="alert"]')).toBeNull();
    const admissionStatus = host.querySelector('.flower-turn-launcher-unknown[role="status"]');
    expect(admissionStatus).toBeTruthy();
    expect(admissionStatus?.textContent).toContain('Delivery is still being confirmed.');
    expect((host.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);

    sendButton.click();
    await flushAsync();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1]?.[0]).toEqual(onSubmit.mock.calls[0]?.[0]);
  });

  it('distinguishes providers and preserves disabled model availability in the dropdown', async () => {
    const directory: FlowerModelDirectory = { current_model_id: 'primary/sonnet', sources: [], models: [
      { id: 'primary/sonnet', label: 'Primary / Sonnet', provider_id: 'primary', provider_name: 'Primary', provider_type: 'anthropic', source: 'runtime_config', state: 'ready' },
      { id: 'gateway/sonnet', label: 'Gateway / Sonnet', provider_id: 'gateway', provider_name: 'Gateway', provider_type: 'openai_compatible', source: 'runtime_config', state: 'ready' },
      { id: 'gateway/unavailable', label: 'Gateway / Unavailable', provider_id: 'gateway', provider_name: 'Gateway', provider_type: 'openai_compatible', source: 'runtime_config', state: 'unavailable', reason: 'missing_keys' },
    ] };
    const host = document.createElement('div'); document.body.appendChild(host);
    render(() => <FlowerTurnLauncherWindow open intent={baseIntent} onClose={() => undefined} onSubmit={async () => undefined}
      modelSource={{ loadSettings: async () => ({ defaults: { permission_type: 'approval_required' }, model_profile: null, model_directory: directory, provider_secrets: [] }) }} />, host);
    const trigger = host.querySelector<HTMLButtonElement>('[role=combobox]')!;
    await vi.waitFor(() => expect(trigger.textContent).toContain('Sonnet'));
    trigger.click();
    await vi.waitFor(() => expect(host.querySelectorAll('[role=group]')).toHaveLength(2));
    const gateway = host.querySelector('[role=group][aria-label=Gateway]')!;
    const choices = gateway.querySelectorAll<HTMLElement>('[role=option]');
    expect(choices[0].textContent).toContain('Sonnet');
    expect(choices[1].getAttribute('aria-disabled')).toBe('true');
    expect(choices[1].getAttribute('aria-description')).toBeTruthy();
    expect(choices[1].querySelector('.flower-model-menu-unavailable')).not.toBeNull();
    choices[1].click();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    choices[0].click();
    await flushAsync();
    trigger.click();
    expect(host.querySelector('[role=group][aria-label=Gateway] [role=option]')?.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('[role=group][aria-label=Primary] [role=option]')?.getAttribute('aria-selected')).toBe('false');
  });

  it('keeps the captured files and model when discovery finishes after unknown admission', async () => {
    const settings = deferred<FlowerSettingsSnapshot>();
    const file = new File(['attached context'], 'notes.txt', { type: 'text/plain' });
    const onSubmit = vi.fn(async (_input: FlowerTurnLauncherSubmitInput) => {
      throw flowerTurnAdmissionError('unknown', new Error('response lost'));
    });
    const host = document.createElement('div'); document.body.appendChild(host);
    render(() => <FlowerTurnLauncherWindow open intent={{ ...baseIntent, pending_attachments: [file] }}
      modelSource={{ loadSettings: () => settings.promise }} onClose={() => undefined} onSubmit={onSubmit} />, host);
    const send = host.querySelector<HTMLButtonElement>('.floe-prompt-card-submit')!;
    expect(send.disabled).toBe(false);
    send.click();
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    settings.resolve({ defaults: { permission_type: 'approval_required' }, model_profile: null, provider_secrets: [],
      conversation_preferences: { revision: 1, model_id: 'late/model', reasoning_by_model: {} } });
    await flushAsync();
    expect(host.querySelector<HTMLButtonElement>('[role=combobox]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('.floe-prompt-card-attach')!.disabled).toBe(true);
    send.click(); await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][0]).toBe(onSubmit.mock.calls[0][0]);
    expect(onSubmit.mock.calls[1][0].intent.pending_attachments).toEqual([file]);
    expect(onSubmit.mock.calls[1][0].model_id).toBeUndefined();
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
    const sendButton = host.querySelector(':is(.floe-prompt-card-submit, [data-testid="flower-turn-launcher-inline-send"])') as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();
    sendButton?.click();
    await flushAsync();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      client_request_id: 'client_00000000-0000-4000-8000-000000000001',
      prompt: '你好，Flower',
      intent: baseIntent,
    });
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
    expect(onSubmit).toHaveBeenCalledWith({
      client_request_id: 'client_00000000-0000-4000-8000-000000000001',
      prompt: 'deploy this change',
      intent: baseIntent,
    });
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
      button.title.includes('Preview selected content from /Users/demo/notes.md'),
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

  it('renders linked context above the editor without introductory copy', () => {
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

    expect(host.querySelector('.floe-prompt-card-question')).toBeNull();
    expect(host.querySelector('textarea')?.getAttribute('placeholder')).toBeNull();
    expect(host.querySelector('.floe-prompt-card-references')?.compareDocumentPosition(host.querySelector('textarea')!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(host.querySelector('.flower-composer-context-references')?.getAttribute('aria-label')).toBe('Linked context');
    expect(host.querySelector('.flower-composer-context-reference')?.hasAttribute('data-floe-prompt-reference')).toBe(true);
    expect(host.querySelector('.floe-prompt-card-composer')?.textContent).toContain('project');
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
      expect(host.textContent).not.toContain('Showing the attached snapshot that Flower will receive.');
      expect(host.textContent).toContain('export default [];');
    });
  });

  it.each([false, true])('routes an HTML attachment snapshot through bounded page preview (oversized: %s)', async oversized => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const source = oversized ? 'x'.repeat(3 * 1024 * 1024) : '<h1>Attached report</h1>';
    const attachment = setFlowerTurnLauncherAttachmentSourcePath(
      new File([source], 'report.html', { type: 'text/html' }), '/workspace/report.html',
    );
    const dispose = render(() => <FlowerTurnLauncherWindow open intent={{ ...baseIntent,
      source_surface: 'file_browser', context_items: [{ kind: 'file_path', path: '/workspace/report.html', is_directory: false }],
      pending_attachments: [attachment],
    }} onClose={() => undefined} onSubmit={async () => undefined} />, host);
    try {
      host.querySelector<HTMLButtonElement>('button[aria-label="Preview attached snapshot for report.html"]')!.click();
      await vi.waitFor(() => expect(host.querySelector('[data-preview-mode]')?.getAttribute('data-preview-mode')).toBe(oversized ? 'unsupported' : 'html'));
      expect(host.textContent).toContain(oversized ? 'This document is too large to preview.' : source);
    } finally { dispose(); }
  });

  it.each([false, true])('retains original CSV snapshot bytes and source truncation (truncated: %s)', async truncated => {
    const host = document.createElement('div'); document.body.append(host);
    const source = truncated ? new TextEncoder().encode('x'.repeat(120001)) : new Uint8Array([0xc4, 0xe3, 0xba, 0xc3, 44, 48, 48, 49]);
    const attachment = setFlowerTurnLauncherAttachmentSourcePath(new File([source], 'encoded.csv', { type: 'text/csv' }), '/workspace/encoded.csv');
    const dispose = render(() => <FlowerTurnLauncherWindow open intent={{ ...baseIntent, source_surface: 'file_browser',
      context_items: [{ kind: 'file_path', path: '/workspace/encoded.csv', is_directory: false }], pending_attachments: [attachment],
    }} onClose={() => undefined} onSubmit={async () => undefined} />, host);
    try {
      host.querySelector<HTMLButtonElement>('button[aria-label="Preview attached snapshot for encoded.csv"]')!.click();
      await vi.waitFor(() => expect(host.querySelector('[data-preview-bytes]')?.getAttribute('data-preview-bytes')).toBe(JSON.stringify([...source])));
      expect(host.querySelector('[data-preview-truncated]')?.getAttribute('data-preview-truncated')).toBe(String(truncated));
    } finally { dispose(); }
  });

  it('previews the frozen spreadsheet bytes without a placeholder notice', async () => {
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
      expect(host.querySelector('[data-preview-mode]')?.getAttribute('data-preview-mode')).toBe('xlsx');
      expect(host.querySelector('[data-preview-bytes]')?.getAttribute('data-preview-bytes')).toBe('[1,2,3]');
      expect(host.textContent).not.toContain('Spreadsheet snapshots are sent to Flower');
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
