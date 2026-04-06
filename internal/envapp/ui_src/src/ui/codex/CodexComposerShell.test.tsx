// @vitest-environment jsdom

import { createMemo, createSignal } from 'solid-js';
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
  hostDisabledReason?: string;
  workingDirPath?: string;
  workingDirLabel?: string;
  workingDirTitle?: string;
  workingDirLocked?: boolean;
  workingDirDisabled?: boolean;
  supportsImages?: boolean;
  capabilitiesLoading?: boolean;
  submitting?: boolean;
  primaryActionKind?: 'send' | 'queue';
  primaryActionDisabled?: boolean;
  primaryActionDisabledReason?: string;
  showSendNowAction?: boolean;
  sendNowDisabled?: boolean;
  sendNowDisabledReason?: string;
  showStopAction?: boolean;
  stopPending?: boolean;
  stopDisabled?: boolean;
  stopDisabledReason?: string;
  guidanceNote?: string;
  attachments?: ReadonlyArray<{
    id: string;
    name: string;
    mime_type: string;
    size_bytes: number;
    data_url: string;
    preview_url: string;
  }>;
  mentions?: ReadonlyArray<{
    id: string;
    name: string;
    path: string;
    kind: 'file';
    is_image: boolean;
  }>;
  onSend?: () => void;
  onQueue?: () => void;
  onStop?: () => void;
  onOpenWorkingDirPicker?: () => void;
  onAddAttachments?: (files: readonly File[]) => Promise<void>;
  onAddFileMentions?: (mentions: ReadonlyArray<{ name: string; path: string; is_image: boolean }>) => void;
  onResetComposer?: () => void;
  onStartNewThreadDraft?: () => void;
  modelValue?: string;
  modelOptions?: ReadonlyArray<{ value: string; label: string; description?: string }>;
  onModelChange?: (value: string) => void;
  effortValue?: string;
  effortOptions?: ReadonlyArray<{ value: string; label: string; description?: string }>;
  onEffortChange?: (value: string) => void;
  approvalPolicyValue?: string;
  approvalPolicyOptions?: ReadonlyArray<{ value: string; label: string; description?: string }>;
  onApprovalPolicyChange?: (value: string) => void;
  sandboxModeValue?: string;
  sandboxModeOptions?: ReadonlyArray<{ value: string; label: string; description?: string }>;
  onSandboxModeChange?: (value: string) => void;
}) {
  const onSend = options?.onSend ?? vi.fn();
  const onQueue = options?.onQueue ?? vi.fn();
  const onStop = options?.onStop ?? vi.fn();
  const onOpenWorkingDirPicker = options?.onOpenWorkingDirPicker ?? vi.fn();
  const onAddAttachments = options?.onAddAttachments ?? vi.fn(async () => undefined);
  const onAddFileMentions = options?.onAddFileMentions ?? vi.fn();
  const onResetComposer = options?.onResetComposer ?? vi.fn();
  const onStartNewThreadDraft = options?.onStartNewThreadDraft ?? vi.fn();
  const onModelChange = options?.onModelChange ?? vi.fn();
  const onEffortChange = options?.onEffortChange ?? vi.fn();
  const onApprovalPolicyChange = options?.onApprovalPolicyChange ?? vi.fn();
  const onSandboxModeChange = options?.onSandboxModeChange ?? vi.fn();
  const hostAvailable = options?.hostAvailable ?? true;
  const primaryActionKind = options?.primaryActionKind ?? 'send';
  const hasDraftContent = (
    !!String(options?.initialText ?? '').trim() ||
    (options?.attachments?.length ?? 0) > 0 ||
    (options?.mentions?.length ?? 0) > 0
  );

  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => {
    const [text, setText] = createSignal(options?.initialText ?? '');
    const [modelValue, setModelValue] = createSignal(options?.modelValue ?? 'gpt-5.4');
    const [effortValue, setEffortValue] = createSignal(options?.effortValue ?? 'medium');
    const [approvalPolicyValue, setApprovalPolicyValue] = createSignal(options?.approvalPolicyValue ?? 'on-request');
    const [sandboxModeValue, setSandboxModeValue] = createSignal(options?.sandboxModeValue ?? 'workspace-write');
    const runtimeControls = createMemo(() => ([
      {
        id: 'model' as const,
        label: 'Model',
        value: modelValue(),
        options: options?.modelOptions ?? [
          { value: 'gpt-5.4', label: 'GPT-5.4', description: 'Default host model' },
        ],
        placeholder: 'Default',
        disabled: !(options?.hostAvailable ?? true),
        variant: 'value' as const,
        onChange: (value: string) => {
          onModelChange(value);
          setModelValue(value);
        },
      },
      {
        id: 'effort' as const,
        label: 'Effort',
        value: effortValue(),
        options: options?.effortOptions ?? [{ value: 'medium', label: 'MEDIUM' }],
        placeholder: 'Default',
        disabled: !(options?.hostAvailable ?? true),
        variant: 'value' as const,
        onChange: (value: string) => {
          onEffortChange(value);
          setEffortValue(value);
        },
      },
      {
        id: 'approval' as const,
        label: 'Approval',
        value: approvalPolicyValue(),
        options: options?.approvalPolicyOptions ?? [{ value: 'on-request', label: 'On request' }],
        placeholder: 'Never',
        disabled: !(options?.hostAvailable ?? true),
        variant: 'policy' as const,
        onChange: (value: string) => {
          onApprovalPolicyChange(value);
          setApprovalPolicyValue(value);
        },
      },
      {
        id: 'sandbox' as const,
        label: 'Sandbox',
        value: sandboxModeValue(),
        options: options?.sandboxModeOptions ?? [{ value: 'workspace-write', label: 'Workspace write' }],
        placeholder: 'Full access',
        disabled: !(options?.hostAvailable ?? true),
        variant: 'policy' as const,
        onChange: (value: string) => {
          onSandboxModeChange(value);
          setSandboxModeValue(value);
        },
      },
    ]));
    return (
      <CodexComposerShell
        workingDirPath={options?.workingDirPath ?? '/workspace'}
        workingDirLabel={options?.workingDirLabel ?? '/workspace'}
        workingDirTitle={options?.workingDirTitle ?? '/workspace'}
        workingDirLocked={options?.workingDirLocked ?? false}
        workingDirDisabled={options?.workingDirDisabled ?? false}
        runtimeControls={runtimeControls()}
        attachments={options?.attachments ?? []}
        mentions={options?.mentions ?? []}
        supportsImages={options?.supportsImages ?? true}
        capabilitiesLoading={options?.capabilitiesLoading ?? false}
        composerText={text()}
        submitting={options?.submitting ?? false}
        primaryActionKind={primaryActionKind}
        primaryActionDisabled={options?.primaryActionDisabled ?? (!hostAvailable || !hasDraftContent || (primaryActionKind === 'send' && Boolean(options?.submitting)))}
        primaryActionDisabledReason={options?.primaryActionDisabledReason ?? (!hostAvailable ? (options?.hostDisabledReason ?? '') : '')}
        showSendNowAction={options?.showSendNowAction ?? false}
        sendNowDisabled={options?.sendNowDisabled ?? (!hostAvailable || !hasDraftContent || Boolean(options?.submitting))}
        sendNowDisabledReason={options?.sendNowDisabledReason ?? (!hostAvailable ? (options?.hostDisabledReason ?? '') : '')}
        showStopAction={options?.showStopAction ?? false}
        stopPending={options?.stopPending ?? false}
        stopDisabled={options?.stopDisabled ?? false}
        stopDisabledReason={options?.stopDisabledReason ?? ''}
        guidanceNote={options?.guidanceNote ?? ''}
        hostAvailable={hostAvailable}
        hostDisabledReason={options?.hostDisabledReason ?? ''}
        onOpenWorkingDirPicker={onOpenWorkingDirPicker}
        onAddAttachments={onAddAttachments}
        onRemoveAttachment={() => undefined}
        onAddFileMentions={onAddFileMentions}
        onRemoveMention={() => undefined}
        onComposerInput={setText}
        onResetComposer={onResetComposer}
        onStartNewThreadDraft={onStartNewThreadDraft}
        onSend={onSend}
        onQueue={onQueue}
        onStop={onStop}
      />
    );
  }, host);

  return {
    host,
    dispose,
    onSend,
    onQueue,
    onStop,
    onOpenWorkingDirPicker,
    onAddAttachments,
    onAddFileMentions,
    onResetComposer,
    onStartNewThreadDraft,
    onModelChange,
    onEffortChange,
    onApprovalPolicyChange,
    onSandboxModeChange,
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

  it('splits context controls from execution strategy and collapses selected labels at rest', () => {
    const { host, dispose } = renderComposer({
      workingDirPath: '/workspace/ui',
      workingDirLabel: '~/ui',
      workingDirTitle: '/workspace/ui',
    });

    const contextGroup = host.querySelector('.codex-chat-input-meta-group-context') as HTMLDivElement | null;
    const strategyGroup = host.querySelector('.codex-chat-input-meta-group-strategy') as HTMLDivElement | null;
    const valueSubgroup = host.querySelector('.codex-chat-input-meta-subgroup-values') as HTMLDivElement | null;
    const policySubgroup = host.querySelector('.codex-chat-input-meta-subgroup-policies') as HTMLDivElement | null;
    if (!contextGroup || !strategyGroup || !valueSubgroup || !policySubgroup) throw new Error('composer meta groups not found');

    expect(contextGroup.querySelector('button[title="Add attachments"]')).not.toBeNull();
    expect(contextGroup.querySelector('.codex-chat-working-dir-chip')?.className).toContain('codex-chat-path-chip');
    expect(valueSubgroup.querySelectorAll('[data-codex-select-variant="value"]').length).toBe(2);
    expect(policySubgroup.querySelectorAll('[data-codex-select-variant="policy"]').length).toBe(2);
    expect(strategyGroup.querySelectorAll('[data-codex-select-collapsed="true"]').length).toBe(4);
    expect(strategyGroup.querySelector('.codex-chat-select-chip-label')).toBeNull();
    dispose();
  });

  it('renders mentions and attachments in a lower-priority draft object lane', () => {
    const { host, dispose } = renderComposer({
      mentions: [{
        id: 'mention_1',
        name: 'CodexPage.tsx',
        path: '/workspace/ui/src/CodexPage.tsx',
        kind: 'file',
        is_image: false,
      }],
      attachments: [{
        id: 'attachment_1',
        name: 'screen.png',
        mime_type: 'image/png',
        size_bytes: 4,
        data_url: 'data:image/png;base64,AAAA',
        preview_url: 'data:image/png;base64,AAAA',
      }],
    });

    const draftObjects = host.querySelector('.codex-chat-draft-objects') as HTMLDivElement | null;
    if (!draftObjects) throw new Error('draft object lane not found');

    expect(draftObjects.querySelector('.codex-chat-mention-strip')).not.toBeNull();
    expect(draftObjects.querySelector('.codex-chat-attachment-strip')).not.toBeNull();
    expect(draftObjects.textContent).toContain('CodexPage.tsx');
    expect(draftObjects.textContent).toContain('screen.png');
    expect(host.querySelector('.codex-chat-input-meta-rail .codex-chat-mention-strip')).toBeNull();
    expect(host.querySelector('.codex-chat-input-meta-rail .codex-chat-attachment-strip')).toBeNull();
    dispose();
  });

  it('keeps the empty-state guidance inside the textarea placeholder instead of a separate support row', async () => {
    const { host, dispose } = renderComposer();
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textarea) throw new Error('textarea not found');

    expect(textarea.placeholder).toContain('Use @ for file context, / for commands, or paste an image.');
    expect(host.textContent).not.toContain('Type @ for file context, / for commands, or paste an image.');

    textarea.dispatchEvent(new Event('focus'));
    await flushAsync();
    expect(host.textContent).not.toContain('Type @ for file context, / for commands, or paste an image.');

    textarea.value = 'Review this diff';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await flushAsync();
    expect(host.textContent).not.toContain('Type @ for file context, / for commands, or paste an image.');
    dispose();
  });

  it('surfaces host-level blocking feedback without falling back to the generic onboarding hint', () => {
    const { host, dispose } = renderComposer({
      hostAvailable: false,
      hostDisabledReason: 'Install codex first',
    });

    expect(host.textContent).toContain('Install codex first');
    expect(host.textContent).not.toContain('Type @ for file context, / for commands, or paste an image.');
    expect((host.querySelector('button[aria-label="Send to Codex"]') as HTMLButtonElement | null)?.disabled).toBe(true);
    expect((host.querySelector('button[title="Add attachments"]') as HTMLButtonElement | null)?.disabled).toBe(true);
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

  it('opens slash parameter options for /model and commits the highlighted value with the keyboard', async () => {
    const onModelChange = vi.fn();
    const { host, dispose } = renderComposer({
      initialText: '/model',
      modelOptions: [
        { value: 'gpt-5.4', label: 'GPT-5.4', description: 'Default host model' },
        { value: 'gpt-5.5', label: 'GPT-5.5', description: 'Faster coding model' },
      ],
      onModelChange,
    });
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textarea) throw new Error('textarea not found');

    textarea.focus();
    textarea.setSelectionRange(6, 6);
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
    await flushAsync();

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushAsync();

    const parameterPopup = host.querySelector('[data-codex-popup-kind="slash-parameter-options"]');
    expect(parameterPopup).not.toBeNull();
    expect(parameterPopup?.textContent).toContain('Default host model');
    expect(textarea.value).toBe('');

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushAsync();

    expect(onModelChange).toHaveBeenCalledWith('gpt-5.5');
    expect((host.querySelector('select[aria-label="Model"]') as HTMLSelectElement | null)?.value).toBe('gpt-5.5');
    expect(host.querySelector('[data-codex-popup-kind="slash-parameter-options"]')).toBeNull();
    dispose();
  });

  it('commits slash parameter options with the mouse and keeps the footer control synchronized', async () => {
    const onApprovalPolicyChange = vi.fn();
    const { host, dispose } = renderComposer({
      initialText: '/approval',
      approvalPolicyOptions: [
        { value: 'on-request', label: 'On request' },
        { value: 'never', label: 'Never' },
      ],
      onApprovalPolicyChange,
    });
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textarea) throw new Error('textarea not found');

    textarea.focus();
    textarea.setSelectionRange(9, 9);
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
    await flushAsync();

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushAsync();

    const option = Array.from(host.querySelectorAll('.codex-chat-popup-item')).find((node) => (
      node.textContent?.includes('Never')
    )) as HTMLButtonElement | undefined;
    if (!option) throw new Error('approval option not found');
    option.click();
    await flushAsync();

    expect(onApprovalPolicyChange).toHaveBeenCalledWith('never');
    expect((host.querySelector('select[aria-label="Approval"]') as HTMLSelectElement | null)?.value).toBe('never');
    expect(host.querySelector('[data-codex-popup-kind="slash-parameter-options"]')).toBeNull();
    dispose();
  });

  it('dismisses slash parameter options with escape without changing the runtime draft', async () => {
    const onSandboxModeChange = vi.fn();
    const { host, dispose } = renderComposer({
      initialText: '/sandbox',
      sandboxModeOptions: [
        { value: 'workspace-write', label: 'Workspace write' },
        { value: 'danger-full-access', label: 'Full access' },
      ],
      onSandboxModeChange,
    });
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textarea) throw new Error('textarea not found');

    textarea.focus();
    textarea.setSelectionRange(8, 8);
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
    await flushAsync();

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushAsync();
    expect(host.querySelector('[data-codex-popup-kind="slash-parameter-options"]')).not.toBeNull();

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flushAsync();

    expect(onSandboxModeChange).not.toHaveBeenCalled();
    expect((host.querySelector('select[aria-label="Sandbox"]') as HTMLSelectElement | null)?.value).toBe('workspace-write');
    expect(host.querySelector('[data-codex-popup-kind="slash-parameter-options"]')).toBeNull();
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

    const popup = host.querySelector('.codex-chat-popup-overlay [data-codex-popup-kind="file-mentions"]');
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

  it('promotes queue next to the primary action and keeps send now as a secondary action during an active turn', () => {
    const onSend = vi.fn();
    const onQueue = vi.fn();
    const onStop = vi.fn();
    const { host, dispose } = renderComposer({
      initialText: 'Review this diff',
      primaryActionKind: 'queue',
      showSendNowAction: true,
      guidanceNote: 'Queue next starts a fresh turn after this run finishes. Send now appends to the current turn.',
      onSend,
      onQueue,
      showStopAction: true,
      onStop,
    });

    const queueButton = host.querySelector('button[aria-label="Queue next Codex turn"]') as HTMLButtonElement | null;
    const sendNowButton = host.querySelector('button[aria-label="Send now to Codex"]') as HTMLButtonElement | null;
    const stopButton = host.querySelector('button[aria-label="Stop active Codex turn"]') as HTMLButtonElement | null;
    const guidance = host.querySelector('.codex-chat-input-guidance');

    if (!queueButton) throw new Error('queue button not found');
    if (!sendNowButton) throw new Error('send now button not found');
    if (!stopButton) throw new Error('stop button not found');

    expect(queueButton.disabled).toBe(false);
    expect(queueButton.textContent).toContain('Queue next');
    expect(sendNowButton.textContent).toContain('Send now');
    expect(stopButton.textContent).toContain('Stop');
    expect(guidance?.textContent).toContain('Queue next starts a fresh turn');

    queueButton.click();
    sendNowButton.click();
    stopButton.click();

    expect(onQueue).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
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
