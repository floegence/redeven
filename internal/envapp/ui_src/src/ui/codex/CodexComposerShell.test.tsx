// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodexComposerShell } from './CodexComposerShell';
import { resetCodexPretextModuleForTests } from './pretextLoader';

const rpcMocks = {
  fs: {
    list: vi.fn(),
  },
};

const pretextMocks = {
  prepare: vi.fn(() => ({ prepared: true })),
  layout: vi.fn(() => ({ height: 156, lineCount: 8 })),
};

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    Send: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Select: (props: any) => (
    <select
      class={props.class}
      value={props.value ?? ''}
      disabled={props.disabled}
      aria-label={props['aria-label']}
      onChange={(event) => props.onChange?.(event.currentTarget.value)}
    >
      <option value="">{props.placeholder ?? ''}</option>
      {(props.options ?? []).map((option: any) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => rpcMocks,
}));

vi.mock('@chenglou/pretext', () => pretextMocks);

function flushAsync(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

function renderComposer(options?: {
  initialText?: string;
  hostAvailable?: boolean;
  workingDirPath?: string;
  workingDirLabel?: string;
  workingDirTitle?: string;
  workingDirLocked?: boolean;
  workingDirDisabled?: boolean;
  onSend?: () => void;
  onOpenWorkingDirPicker?: () => void;
  onAddAttachments?: (files: readonly File[]) => Promise<void>;
  onAddFileMentions?: (mentions: ReadonlyArray<{ name: string; path: string; is_image: boolean }>) => void;
  onResetComposer?: () => void;
  onStartNewThreadDraft?: () => void;
}) {
  const onSend = options?.onSend ?? vi.fn();
  const onOpenWorkingDirPicker = options?.onOpenWorkingDirPicker ?? vi.fn();
  const onAddAttachments = options?.onAddAttachments ?? vi.fn(async () => undefined);
  const onAddFileMentions = options?.onAddFileMentions ?? vi.fn();
  const onResetComposer = options?.onResetComposer ?? vi.fn();
  const onStartNewThreadDraft = options?.onStartNewThreadDraft ?? vi.fn();

  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => {
    const [text, setText] = createSignal(options?.initialText ?? '');
    return (
      <CodexComposerShell
        workingDirPath={options?.workingDirPath ?? '/workspace'}
        workingDirLabel={options?.workingDirLabel ?? '/workspace'}
        workingDirTitle={options?.workingDirTitle ?? '/workspace'}
        workingDirLocked={options?.workingDirLocked ?? false}
        workingDirDisabled={options?.workingDirDisabled ?? false}
        modelValue="gpt-5.4"
        modelOptions={[{ value: 'gpt-5.4', label: 'GPT-5.4' }]}
        effortValue="medium"
        effortOptions={[{ value: 'medium', label: 'MEDIUM' }]}
        approvalPolicyValue="on-request"
        approvalPolicyOptions={[{ value: 'on-request', label: 'On request' }]}
        sandboxModeValue="workspace-write"
        sandboxModeOptions={[{ value: 'workspace-write', label: 'Workspace write' }]}
        attachments={[]}
        mentions={[]}
        supportsImages
        capabilitiesLoading={false}
        composerText={text()}
        submitting={false}
        hostAvailable={options?.hostAvailable ?? true}
        hostDisabledReason=""
        onOpenWorkingDirPicker={onOpenWorkingDirPicker}
        onModelChange={() => undefined}
        onEffortChange={() => undefined}
        onApprovalPolicyChange={() => undefined}
        onSandboxModeChange={() => undefined}
        onAddAttachments={onAddAttachments}
        onRemoveAttachment={() => undefined}
        onAddFileMentions={onAddFileMentions}
        onRemoveMention={() => undefined}
        onComposerInput={setText}
        onResetComposer={onResetComposer}
        onStartNewThreadDraft={onStartNewThreadDraft}
        onSend={onSend}
      />
    );
  }, host);

  return {
    host,
    dispose,
    onSend,
    onOpenWorkingDirPicker,
    onAddAttachments,
    onAddFileMentions,
    onResetComposer,
    onStartNewThreadDraft,
  };
}

afterEach(() => {
  rpcMocks.fs.list.mockReset();
  pretextMocks.prepare.mockClear();
  pretextMocks.layout.mockClear();
  resetCodexPretextModuleForTests();
  document.body.innerHTML = '';
});

describe('CodexComposerShell', () => {
  it('opens the working directory picker from the new-thread chip', () => {
    const onOpenWorkingDirPicker = vi.fn();
    const { host, dispose } = renderComposer({ onOpenWorkingDirPicker });

    const button = host.querySelector('button[aria-label="Select working directory"]') as HTMLButtonElement | null;
    if (!button) throw new Error('working directory button not found');

    button.click();

    expect(onOpenWorkingDirPicker).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('renders a locked working directory chip without opening the picker', () => {
    const onOpenWorkingDirPicker = vi.fn();
    const { host, dispose } = renderComposer({
      workingDirPath: '/workspace/ui',
      workingDirLabel: '~/ui',
      workingDirTitle: '/workspace/ui',
      workingDirLocked: true,
      onOpenWorkingDirPicker,
    });

    const button = host.querySelector('button[aria-label="Working directory locked"]') as HTMLButtonElement | null;
    if (!button) throw new Error('locked working directory button not found');

    button.click();

    expect(button.textContent).toContain('~/ui');
    expect(button.className).toContain('codex-chat-working-dir-chip-locked');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.tabIndex).toBe(-1);
    expect(onOpenWorkingDirPicker).not.toHaveBeenCalled();
    dispose();
  });

  it('routes pasted image files into the Codex attachment pipeline', async () => {
    const onAddAttachments = vi.fn(async () => undefined);
    const { host, dispose } = renderComposer({ onAddAttachments });
    const textarea = host.querySelector('textarea');
    if (!textarea) throw new Error('textarea not found');

    const file = new File(['png'], 'screen.png', { type: 'image/png' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      configurable: true,
      value: {
        items: [{
          kind: 'file',
          getAsFile: () => file,
        }],
      },
    });

    textarea.dispatchEvent(event);
    await flushAsync();

    expect(event.defaultPrevented).toBe(true);
    expect(onAddAttachments).toHaveBeenCalledWith([file]);
    dispose();
  });

  it('keeps non-image paste on the native textarea path', async () => {
    const onAddAttachments = vi.fn(async () => undefined);
    const { host, dispose } = renderComposer({ onAddAttachments });
    const textarea = host.querySelector('textarea');
    if (!textarea) throw new Error('textarea not found');

    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      configurable: true,
      value: {
        items: [{
          kind: 'string',
          getAsFile: () => null,
        }],
      },
    });

    textarea.dispatchEvent(event);
    await flushAsync();

    expect(event.defaultPrevented).toBe(false);
    expect(onAddAttachments).not.toHaveBeenCalled();
    dispose();
  });

  it('shows slash commands and executes the selected command before send', async () => {
    const onResetComposer = vi.fn();
    const onSend = vi.fn();
    const { host, dispose } = renderComposer({
      initialText: '/clear',
      onResetComposer,
      onSend,
    });
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textarea) throw new Error('textarea not found');

    textarea.focus();
    textarea.setSelectionRange(6, 6);
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
    await flushAsync();

    expect(host.querySelector('[data-codex-popup-kind="slash-commands"]')).not.toBeNull();
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushAsync();

    expect(onResetComposer).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    dispose();
  });

  it('shows file mention suggestions and replaces the typed @ token on selection', async () => {
    rpcMocks.fs.list.mockResolvedValue({
      entries: [
        {
          name: 'CodexComposerShell.tsx',
          path: '/workspace/src/CodexComposerShell.tsx',
          isDirectory: false,
          size: 1,
          modifiedAt: 1,
          createdAt: 1,
        },
      ],
    });
    const onAddFileMentions = vi.fn();
    const { host, dispose } = renderComposer({
      initialText: 'Review @Codex',
      onAddFileMentions,
    });
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textarea) throw new Error('textarea not found');

    textarea.focus();
    textarea.setSelectionRange(13, 13);
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
    await flushAsync();
    await flushAsync();

    const popup = host.querySelector('[data-codex-popup-kind="file-mentions"]');
    expect(popup).not.toBeNull();

    const option = Array.from(host.querySelectorAll('.codex-chat-popup-item')).find((node) => (
      node.textContent?.includes('CodexComposerShell.tsx')
    )) as HTMLButtonElement | undefined;
    if (!option) throw new Error('mention option not found');
    option.click();
    await flushAsync();

    expect(onAddFileMentions).toHaveBeenCalledWith([{
      name: 'CodexComposerShell.tsx',
      path: '/workspace/src/CodexComposerShell.tsx',
      is_image: false,
    }]);
    expect(textarea.value).toBe('Review ');
    dispose();
  });

  it('does not submit while IME composition is active', async () => {
    const onSend = vi.fn();
    const { host, dispose } = renderComposer({
      initialText: 'Review this diff',
      onSend,
    });
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textarea) throw new Error('textarea not found');

    textarea.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushAsync();

    expect(onSend).not.toHaveBeenCalled();
    dispose();
  });

  it('autosizes the Codex textarea through the Codex-local pretext path', async () => {
    const requestFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    const cancelFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);
    const { host, dispose } = renderComposer({
      initialText: 'Review this diff',
    });
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textarea) throw new Error('textarea not found');

    textarea.style.fontFamily = '"Segoe UI", Arial, sans-serif';
    textarea.style.fontSize = '13px';
    textarea.style.lineHeight = '1.5';
    textarea.style.minHeight = '56px';
    textarea.style.maxHeight = '320px';
    textarea.style.paddingTop = '0px';
    textarea.style.paddingBottom = '0px';
    textarea.style.paddingLeft = '0px';
    textarea.style.paddingRight = '0px';
    Object.defineProperty(textarea, 'clientWidth', {
      configurable: true,
      get: () => 280,
    });
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => 56,
    });
    textarea.getBoundingClientRect = () => ({
      width: 280,
      height: 56,
      top: 0,
      right: 280,
      bottom: 56,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

    textarea.value = 'Review this diff with a longer autosize payload';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await flushAsync();
    await flushAsync();

    expect(pretextMocks.prepare).toHaveBeenCalled();
    expect(pretextMocks.layout).toHaveBeenCalled();
    expect(textarea.style.height).toBe('156px');
    requestFrameSpy.mockRestore();
    cancelFrameSpy.mockRestore();
    dispose();
  });
});
