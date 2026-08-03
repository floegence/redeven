// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  FlowerAttachmentUploadInput,
  FlowerLiveBootstrap,
  FlowerLiveEventsResponse,
  FlowerRouterDecision,
  FlowerAttachmentCapability,
  FlowerStagedAttachment,
  FlowerSettingsSnapshot,
  FlowerTurnLaunchInput,
  FlowerTurnLaunchReceipt,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { flowerTurnAdmissionUncertainFailure } from '../../../../flower_ui/src/flowerTurnAdmission';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import {
  adapter,
  decision,
  deferred,
  disposeRenderedSurface,
  flush,
  flowerSurfaceNotifications,
  inputRequest,
  inputAdmissionReceipt,
  launchReceipt,
  activityItem,
  activityTimeline,
  liveBootstrap,
  modelIOStatus,
  mutableSettingsAdapter,
  renderSurfaceWithAdapter,
  renderSurfaceWithDraftCoordinator,
  settingsSnapshot,
  subagentSummary,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function selectedThreadReady(root: ParentNode, threadID: string): boolean {
  const surface = root.querySelector('#redeven-flower-surface');
  return surface?.getAttribute('data-flower-selected-thread-id') === threadID
    && surface?.getAttribute('data-flower-selected-thread-loading') === 'false';
}

function launchReceiptFor(
  input: FlowerTurnLaunchInput,
  threadID: string,
  canonicalID: string,
  kind: 'start' | 'queued' = 'start',
): FlowerTurnLaunchReceipt {
  return launchReceipt(threadID, canonicalID, kind, input.client_request_id);
}

it('launches once after asynchronous handler resolution with an in-memory draft', async () => {
  const coordinator = createFlowerComposerDraftCoordinator();
  const handler = deferred<FlowerRouterDecision>();
  const surfaceAdapter = adapter();
  const launchTurn = vi.fn(surfaceAdapter.launchTurn);
  const resolveHandler = vi.fn(() => handler.promise);
  const runtime = renderSurfaceWithDraftCoordinator({ ...surfaceAdapter, launchTurn, resolveHandler }, coordinator);
  await waitFor(() => Boolean(runtime.querySelector('textarea')));
  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = 'in-memory send';
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await waitFor(() => !(runtime.querySelector('button.flower-composer-submit') as HTMLButtonElement).disabled);
  const send = runtime.querySelector('button.flower-composer-submit') as HTMLButtonElement;
  send.click();
  await waitFor(() => runtime.querySelector('.flower-composer')?.getAttribute('aria-busy') === 'true');

  handler.resolve(decision());
  await waitFor(() => launchTurn.mock.calls.length === 1);
  expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'in-memory send' }));
});

it('admits only one turn when Send and Enter race a fresh attachment capability read', async () => {
  const coordinator = createFlowerComposerDraftCoordinator();
  const freshCapability = deferred<FlowerAttachmentCapability>();
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'capability-1', enabled: true, supports_long_text: true,
    max_attachments: 20, max_file_size_bytes: 1_000_000, max_total_size_bytes: 10_000_000,
    routes: { 'text/plain': 'tool_read' },
  };
  let capabilityCalls = 0;
  const surfaceAdapter = adapter();
  const launchTurn = vi.fn(surfaceAdapter.launchTurn);
  const uploadAttachment = vi.fn(async (input): Promise<FlowerStagedAttachment> => ({
    attachment_id: 'upl_double_submit_________', name: input.file.name, mime_type: input.file.type,
    size_bytes: input.file.size, digest_sha256: 'a'.repeat(64), source: 'file',
    capability_revision: capability.revision,
    locator: `attachment://v1/upl_double_submit_________/${input.file.name}`,
  }));
  const loadAttachmentCapability = vi.fn(() => {
    capabilityCalls += 1;
    return capabilityCalls === 1 ? Promise.resolve(capability) : freshCapability.promise;
  });
  const runtime = renderSurfaceWithDraftCoordinator({
    ...surfaceAdapter, launchTurn, uploadAttachment, loadAttachmentCapability,
  }, coordinator);
  await waitFor(() => capabilityCalls === 1 && Boolean(runtime.querySelector('input[type="file"]')));
  const picker = runtime.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['attachment'], 'notes.txt', { type: 'text/plain' });
  Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => vi.mocked(surfaceAdapter.createAttachmentStagingScope!).mock.calls.length === 1);
  await waitFor(() => runtime.querySelector('[data-attachment-status]') !== null);
  expect(runtime.querySelector('[data-attachment-status]')?.getAttribute('data-attachment-status')).toBe('staged_ready');
  expect(uploadAttachment).toHaveBeenCalledOnce();

  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = 'one turn only';
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await waitFor(() => !(runtime.querySelector('button.flower-composer-submit') as HTMLButtonElement).disabled);
  (runtime.querySelector('button.flower-composer-submit') as HTMLButtonElement).click();
  textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(() => capabilityCalls === 2);
  freshCapability.resolve(capability);
  await waitFor(() => launchTurn.mock.calls.length === 1);
  expect(launchTurn).toHaveBeenCalledTimes(1);
});

it('shows which models support the attachments already in the composer', async () => {
  const supportedCapability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'capability-supported', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
    routes: { 'text/plain': 'tool_read' },
  };
  const unsupportedCapability: FlowerAttachmentCapability = {
    ...supportedCapability,
    model_id: 'openai/gpt-5.4',
    revision: 'capability-unsupported',
    routes: { 'text/plain': 'unsupported' },
  };
  const snapshot: FlowerSettingsSnapshot = {
    ...settingsSnapshot(),
    model_profile: {
      ...settingsSnapshot().model_profile!,
      providers: [{
        ...settingsSnapshot().model_profile!.providers[0]!,
        models: [
          { model_name: 'gpt-5.2', context_window: 400_000, input_modalities: ['text'] },
          { model_name: 'gpt-5.4', context_window: 400_000, input_modalities: ['text'] },
        ],
      }],
    },
  };
  const surfaceAdapter = adapter();
  const loadAttachmentCapability = vi.fn(async (modelID: string) => (
    modelID === unsupportedCapability.model_id ? unsupportedCapability : supportedCapability
  ));
  const uploadAttachment = vi.fn(async (input: FlowerAttachmentUploadInput): Promise<FlowerStagedAttachment> => ({
    attachment_id: 'upl_model_support________',
    name: input.file.name,
    mime_type: input.file.type,
    size_bytes: input.file.size,
    digest_sha256: 'b'.repeat(64),
    source: 'file',
    capability_revision: supportedCapability.revision,
    locator: `attachment://v1/upl_model_support________/${input.file.name}`,
  }));
  const runtime = renderSurfaceWithDraftCoordinator({
    ...surfaceAdapter,
    loadSettings: vi.fn(async () => snapshot),
    loadAttachmentCapability,
    uploadAttachment,
  }, createFlowerComposerDraftCoordinator());

  await waitFor(() => Boolean(runtime.querySelector('input[type="file"]')));
  const picker = runtime.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['release notes'], 'notes.txt', { type: 'text/plain' });
  Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => runtime.querySelector('[data-attachment-status="staged_ready"]') !== null);

  (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
  await waitFor(() => runtime.querySelectorAll('.flower-model-menu-attachment-status').length === 2);
  await waitFor(() => Array.from(runtime.querySelectorAll('.flower-model-menu-attachment-status'))
    .every((status) => status.getAttribute('data-state') !== 'checking'));

  const options = Array.from(runtime.querySelectorAll('.flower-model-menu-item'));
  const current = options.find((option) => option.textContent?.includes('gpt-5.2'));
  const alternate = options.find((option) => option.textContent?.includes('gpt-5.4'));
  expect(current?.querySelector('.flower-model-menu-attachment-status')).toMatchObject({
    textContent: 'Supports current attachments',
  });
  expect(current?.querySelector('.flower-model-menu-attachment-status')?.getAttribute('data-state')).toBe('supported');
  expect(alternate?.querySelector('.flower-model-menu-attachment-status')).toMatchObject({
    textContent: 'Does not support current attachments',
  });
  expect(alternate?.querySelector('.flower-model-menu-attachment-status')?.getAttribute('data-state')).toBe('unsupported');
});

it('leaves an over-limit paste to the browser when attachments are unavailable', async () => {
  const runtime = renderSurfaceWithAdapter(adapter());
  await waitFor(() => Boolean(runtime.querySelector('textarea')));
  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = 'keep this';
  textarea.setSelectionRange(4, 4);
  const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(paste, 'clipboardData', {
    value: { files: [], getData: (type: string) => type === 'text/plain' ? 'x'.repeat(50_001) : '' },
  });

  textarea.dispatchEvent(paste);

  expect(paste.defaultPrevented).toBe(false);
  expect(textarea.value).toBe('keep this');
  expect(runtime.querySelector('[data-attachment-item]')).toBeNull();
});

it('retains an exact over-limit paste and selection when local limits reject conversion', async () => {
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'capability-small', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 128, max_total_size_bytes: 256,
    routes: { 'text/plain': 'tool_read' },
  };
  const surfaceAdapter = adapter();
  const runtime = renderSurfaceWithDraftCoordinator({
    ...surfaceAdapter,
    loadAttachmentCapability: vi.fn(async () => capability),
    uploadAttachment: vi.fn(async () => { throw new Error('upload should not start'); }),
  }, createFlowerComposerDraftCoordinator());
  await waitFor(() => Boolean(runtime.querySelector('input[type="file"]')));
  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  const payload = 'x'.repeat(50_001);
  textarea.value = 'keep [replace] ending';
  textarea.setSelectionRange(5, 14);
  const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(paste, 'clipboardData', {
    value: { files: [], getData: (type: string) => type === 'text/plain' ? payload : '' },
  });

  textarea.dispatchEvent(paste);
  await waitFor(() => (
    textarea.value === `keep ${payload} ending`
    && textarea.selectionStart === 5 + payload.length
    && textarea.selectionEnd === 5 + payload.length
  ));

  expect(paste.defaultPrevented).toBe(true);
  expect(textarea.selectionStart).toBe(5 + payload.length);
  expect(textarea.selectionEnd).toBe(5 + payload.length);
  expect(runtime.querySelector('[data-attachment-item]')).toBeNull();
});

it('keeps an exact over-limit paste in the editor until its attachment is staged', async () => {
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'capability-long-paste', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
    routes: { 'text/plain': 'tool_read', 'text/plain; charset=utf-8': 'tool_read' },
  };
  const completion = deferred<FlowerStagedAttachment>();
  const uploadAttachment = vi.fn((input: FlowerAttachmentUploadInput) => completion.promise.then((staged) => ({
    ...staged,
    name: input.file.name,
  })));
  const runtime = renderSurfaceWithDraftCoordinator({
    ...adapter(),
    loadAttachmentCapability: vi.fn(async () => capability),
    uploadAttachment,
  }, createFlowerComposerDraftCoordinator());
  await waitFor(() => Boolean(runtime.querySelector('input[type="file"]')));
  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  const payload = 'x'.repeat(50_001);
  textarea.focus();
  textarea.value = 'before after';
  textarea.setSelectionRange(7, 7);
  const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(paste, 'clipboardData', {
    value: { files: [], getData: (type: string) => type === 'text/plain' ? payload : '' },
  });

  textarea.dispatchEvent(paste);
  await waitFor(() => uploadAttachment.mock.calls.length === 1);
  expect(textarea.value).toBe(`before ${payload}after`);

  completion.resolve({
    attachment_id: 'upl_long_paste____________', name: 'long.txt', mime_type: 'text/plain; charset=utf-8',
    size_bytes: payload.length, digest_sha256: 'c'.repeat(64), source: 'long_text',
    text_stats: { code_points: payload.length, lines: 1 }, capability_revision: capability.revision,
    locator: 'attachment://v1/upl_long_paste/long.txt',
  });
  await waitFor(() => textarea.value === 'before after');
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(runtime.querySelector('[data-attachment-status="staged_ready"]')).not.toBeNull();
  expect(document.activeElement).toBe(textarea);
  expect(textarea.selectionStart).toBe(7);
  expect(textarea.selectionEnd).toBe(7);
});

it('does not reclaim focus after an over-limit paste finishes staging', async () => {
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'capability-long-paste-focus', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
    routes: { 'text/plain': 'tool_read', 'text/plain; charset=utf-8': 'tool_read' },
  };
  const completion = deferred<FlowerStagedAttachment>();
  const uploadAttachment = vi.fn(() => completion.promise);
  const runtime = renderSurfaceWithDraftCoordinator({
    ...adapter(), loadAttachmentCapability: vi.fn(async () => capability), uploadAttachment,
  }, createFlowerComposerDraftCoordinator());
  await waitFor(() => Boolean(runtime.querySelector('textarea')));
  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  const payload = 'y'.repeat(50_001);
  textarea.focus();
  const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(paste, 'clipboardData', {
    value: { files: [], getData: (type: string) => type === 'text/plain' ? payload : '' },
  });
  textarea.dispatchEvent(paste);
  await waitFor(() => uploadAttachment.mock.calls.length === 1);
  const modelTrigger = runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement;
  modelTrigger.focus();

  completion.resolve({
    attachment_id: 'upl_long_paste_focus______', name: 'long.txt', mime_type: 'text/plain; charset=utf-8',
    size_bytes: payload.length, digest_sha256: 'e'.repeat(64), source: 'long_text',
    text_stats: { code_points: payload.length, lines: 1 }, capability_revision: capability.revision,
    locator: 'attachment://v1/upl_long_paste_focus/long.txt',
  });
  await waitFor(() => textarea.value === '');
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  expect(document.activeElement).toBe(modelTrigger);
});

it('preserves an exact over-limit paste when staging fails', async () => {
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'capability-long-paste-failure', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
    routes: { 'text/plain': 'tool_read', 'text/plain; charset=utf-8': 'tool_read' },
  };
  const completion = deferred<FlowerStagedAttachment>();
  const coordinator = createFlowerComposerDraftCoordinator();
  const runtime = renderSurfaceWithDraftCoordinator({
    ...adapter(),
    loadAttachmentCapability: vi.fn(async () => capability),
    uploadAttachment: vi.fn(() => completion.promise),
  }, coordinator);
  await waitFor(() => Boolean(runtime.querySelector('input[type="file"]')));
  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  const payload = '失败内容'.repeat(16_667);
  textarea.value = 'prefix';
  textarea.setSelectionRange(6, 6);
  const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(paste, 'clipboardData', {
    value: { files: [], getData: (type: string) => type === 'text/plain' ? payload : '' },
  });

  textarea.dispatchEvent(paste);
  await waitFor(() => textarea.value === `prefix${payload}`);
  completion.reject(new Error('offline'));
  await waitFor(() => coordinator.attachmentController('__new_thread__', () => {
    throw new Error('missing shared controller');
  }).snapshot().items.length === 0);

  expect(textarea.value).toBe(`prefix${payload}`);
});

it('uploads a failed long-text paste only once when the user sends the preserved text', async () => {
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'capability-long-paste-send-after-failure', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
    routes: { 'text/plain': 'tool_read', 'text/plain; charset=utf-8': 'tool_read' },
  };
  const retryCompletion = deferred<FlowerStagedAttachment>();
  let attempts = 0;
  const uploadAttachment = vi.fn((_input: FlowerAttachmentUploadInput) => {
    attempts += 1;
    if (attempts === 1) return Promise.reject(new Error('offline'));
    return retryCompletion.promise;
  });
  const launchTurn = vi.fn(adapter().launchTurn);
  const coordinator = createFlowerComposerDraftCoordinator();
  const runtime = renderSurfaceWithDraftCoordinator({
    ...adapter(),
    loadAttachmentCapability: vi.fn(async () => capability),
    uploadAttachment,
    launchTurn,
  }, coordinator);
  await waitFor(() => Boolean(runtime.querySelector('textarea')));
  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  const payload = 'q'.repeat(50_001);
  const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(paste, 'clipboardData', {
    value: { files: [], getData: (type: string) => type === 'text/plain' ? payload : '' },
  });
  textarea.dispatchEvent(paste);
  await waitFor(() => textarea.value === payload);
  await waitFor(() => uploadAttachment.mock.calls.length === 1);
  await waitFor(() => coordinator.attachmentController('__new_thread__', () => {
    throw new Error('missing shared controller');
  }).snapshot().items.length === 0);

  const submit = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;
  await waitFor(() => !submit.disabled);
  submit.click();
  await waitFor(() => uploadAttachment.mock.calls.length === 2);
  const retryInput = uploadAttachment.mock.calls[1]?.[0];
  expect(retryInput?.source).toBe('long_text');
  expect(retryInput?.file.size).toBe(new TextEncoder().encode(payload).byteLength);
  retryCompletion.resolve({
    attachment_id: 'upl_long_paste_once________',
    name: retryInput!.file.name,
    mime_type: retryInput!.file.type,
    size_bytes: retryInput!.file.size,
    digest_sha256: 'd'.repeat(64),
    source: 'long_text',
    capability_revision: capability.revision,
    locator: 'attachment://v1/upl_long_paste_once/long.txt',
    text_stats: { code_points: payload.length, lines: 1 },
  });
  await waitFor(() => launchTurn.mock.calls.length === 1);
  expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
    prompt: '',
    attachment_ids: ['upl_long_paste_once________'],
  }));
  expect(uploadAttachment).toHaveBeenCalledTimes(2);
});

it('keeps concurrent editor changes and discards the staged long-paste duplicate', async () => {
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'capability-long-paste-edit', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
    routes: { 'text/plain': 'tool_read', 'text/plain; charset=utf-8': 'tool_read' },
  };
  const completion = deferred<FlowerStagedAttachment>();
  const uploadAttachment = vi.fn(() => completion.promise);
  const runtime = renderSurfaceWithDraftCoordinator({
    ...adapter(), loadAttachmentCapability: vi.fn(async () => capability), uploadAttachment,
  }, createFlowerComposerDraftCoordinator());
  await waitFor(() => Boolean(runtime.querySelector('input[type="file"]')));
  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  const payload = 'z'.repeat(50_001);
  const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(paste, 'clipboardData', {
    value: { files: [], getData: (type: string) => type === 'text/plain' ? payload : '' },
  });
  textarea.dispatchEvent(paste);
  await waitFor(() => uploadAttachment.mock.calls.length === 1);
  textarea.value = `${payload} user edit`;
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
  completion.resolve({
    attachment_id: 'upl_long_paste_edit_______', name: 'long.txt', mime_type: 'text/plain; charset=utf-8',
    size_bytes: payload.length, digest_sha256: 'd'.repeat(64), source: 'long_text',
    text_stats: { code_points: payload.length, lines: 1 }, capability_revision: capability.revision,
    locator: 'attachment://v1/upl_long_paste_edit/long.txt',
  });

  await waitFor(() => runtime.querySelector('[data-attachment-status]') === null);
  expect(textarea.value).toBe(`${payload} user edit`);
});

it('shares one in-memory draft across Activity and Workbench without conflict UI', async () => {
  const coordinator = createFlowerComposerDraftCoordinator();
  coordinator.open('__new_thread__').mutate((value) => ({ ...value, text: 'seeded from Activity' }));
  coordinator.open('thread-1').mutate((value) => ({ ...value, text: 'thread-scoped draft' }));
  const newThreadAdapter = () => ({ ...adapter(), listThreads: vi.fn(async () => []) });
  const activity = renderSurfaceWithDraftCoordinator(newThreadAdapter(), coordinator);
  const workbench = renderSurfaceWithDraftCoordinator(newThreadAdapter(), coordinator);
  await waitFor(() => (
    (activity.querySelector('textarea') as HTMLTextAreaElement | null)?.value === 'seeded from Activity'
    && (workbench.querySelector('textarea') as HTMLTextAreaElement | null)?.value === 'seeded from Activity'
  ));

  coordinator.open('__new_thread__').mutate((value) => ({ ...value, text: 'shared from Workbench' }));
  await waitFor(() => (workbench.querySelector('textarea') as HTMLTextAreaElement).value === 'shared from Workbench');

  const remounted = renderSurfaceWithDraftCoordinator(newThreadAdapter(), coordinator);
  await waitFor(() => (remounted.querySelector('textarea') as HTMLTextAreaElement | null)?.value === 'shared from Workbench');

  const switcher = renderSurfaceWithDraftCoordinator(adapter(), coordinator);
  await waitFor(() => (switcher.querySelector('textarea') as HTMLTextAreaElement | null)?.value === 'shared from Workbench');
  (switcher.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
  await waitFor(() => (
    selectedThreadReady(switcher, 'thread-1')
    && (switcher.querySelector('textarea') as HTMLTextAreaElement).value === 'thread-scoped draft'
  ));
  (switcher.querySelector('button[aria-label="New chat"]') as HTMLButtonElement).click();
  await waitFor(() => (switcher.querySelector('textarea') as HTMLTextAreaElement).value === 'shared from Workbench');

  expect(activity.querySelector('.flower-composer-draft-conflict')).toBeNull();
  expect(workbench.querySelector('.flower-composer-draft-conflict')).toBeNull();
  expect(coordinator.read('__new_thread__').value.text).toBe('shared from Workbench');
});

it('keeps a selected attachment when its originating surface unmounts during staging creation', async () => {
  const coordinator = createFlowerComposerDraftCoordinator();
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'capability-remount-staging', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
    routes: { 'text/plain': 'tool_read' },
  };
  const scopeCreation = deferred<{
    staging_scope_id: string;
    target_id: string;
    capability: string;
    expires_at_unix_ms: number;
  }>();
  const stagingScope = {
    staging_scope_id: 'staging-remount', target_id: 'client-remount', capability: 'remount-secret',
    expires_at_unix_ms: Date.now() + 60_000,
  };
  const uploadAttachment = vi.fn(async (input: FlowerAttachmentUploadInput): Promise<FlowerStagedAttachment> => ({
    attachment_id: 'upl_remount______________', name: input.file.name, mime_type: input.file.type,
    size_bytes: input.file.size, digest_sha256: 'a'.repeat(64), source: input.source,
    capability_revision: capability.revision, locator: 'attachment://v1/upl_remount/remount.txt',
  }));
  const surfaceAdapter = {
    ...adapter(),
    listThreads: vi.fn(async () => []),
    loadAttachmentCapability: vi.fn(async () => capability),
    createAttachmentStagingScope: vi.fn(() => scopeCreation.promise),
    uploadAttachment,
  };
  const activity = renderSurfaceWithDraftCoordinator(surfaceAdapter, coordinator);
  await waitFor(() => Boolean(activity.querySelector('input[type="file"]')));
  const picker = activity.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(picker, 'files', {
    configurable: true,
    value: [new File(['remount'], 'remount.txt', { type: 'text/plain' })],
  });
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  expect(coordinator.attachmentController('__new_thread__', () => {
    throw new Error('missing shared controller');
  }).snapshot().items).toHaveLength(1);

  disposeRenderedSurface(activity);
  const workbench = renderSurfaceWithDraftCoordinator(surfaceAdapter, coordinator);
  scopeCreation.resolve(stagingScope);

  await waitFor(() => uploadAttachment.mock.calls.length === 1);
  await waitFor(() => workbench.querySelector('[data-attachment-status="staged_ready"]') !== null);
  expect(uploadAttachment).toHaveBeenCalledWith(expect.objectContaining({ staging_scope: stagingScope }));
});

it('retains a file and retries staging from a remounted surface after scope creation fails', async () => {
  const coordinator = createFlowerComposerDraftCoordinator();
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'capability-remount-retry', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
    routes: { 'text/plain': 'tool_read' },
  };
  const stagingScope = {
    staging_scope_id: 'staging-remount-retry', target_id: 'client-remount-retry', capability: 'retry-secret',
    expires_at_unix_ms: Date.now() + 60_000,
  };
  let scopeAttempt = 0;
  const createAttachmentStagingScope = vi.fn(async () => {
    scopeAttempt += 1;
    if (scopeAttempt === 1) throw new Error('staging unavailable');
    return stagingScope;
  });
  const uploadAttachment = vi.fn(async (input: FlowerAttachmentUploadInput): Promise<FlowerStagedAttachment> => ({
    attachment_id: 'upl_remount_retry________', name: input.file.name, mime_type: input.file.type,
    size_bytes: input.file.size, digest_sha256: 'b'.repeat(64), source: input.source,
    capability_revision: capability.revision, locator: 'attachment://v1/upl_remount_retry/retry.txt',
  }));
  const surfaceAdapter = {
    ...adapter(),
    listThreads: vi.fn(async () => []),
    loadAttachmentCapability: vi.fn(async () => capability),
    createAttachmentStagingScope,
    uploadAttachment,
  };
  const activity = renderSurfaceWithDraftCoordinator(surfaceAdapter, coordinator);
  await waitFor(() => Boolean(activity.querySelector('input[type="file"]')));
  const picker = activity.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(picker, 'files', {
    configurable: true,
    value: [new File(['retry'], 'retry.txt', { type: 'text/plain' })],
  });
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => coordinator.attachmentController('__new_thread__', () => {
    throw new Error('missing shared controller');
  }).snapshot().items[0]?.status === 'upload_error');

  disposeRenderedSurface(activity);
  const workbench = renderSurfaceWithDraftCoordinator(surfaceAdapter, coordinator);
  await waitFor(() => workbench.querySelector('[data-attachment-status="upload_error"] button') !== null);
  (workbench.querySelector('[data-attachment-status="upload_error"] button') as HTMLButtonElement).click();

  await waitFor(() => uploadAttachment.mock.calls.length === 1);
  expect(createAttachmentStagingScope).toHaveBeenCalledTimes(2);
  expect(uploadAttachment).toHaveBeenCalledWith(expect.objectContaining({ staging_scope: stagingScope }));
});

it('shares one connection-local attachment capability and locks every surface during admission', async () => {
  const coordinator = createFlowerComposerDraftCoordinator();
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'capability-shared-surface', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
    routes: { 'text/plain': 'tool_read' },
  };
  const stagingScope = {
    staging_scope_id: 'staging-shared-surface',
    target_id: 'client-shared-surface',
    capability: 'shared-connection-secret',
    expires_at_unix_ms: Date.now() + 60_000,
  };
  const refreshedStagingScope = {
    staging_scope_id: 'staging-shared-surface-refreshed',
    target_id: 'client-shared-surface-refreshed',
    capability: 'shared-connection-secret-refreshed',
    expires_at_unix_ms: Date.now() + 120_000,
  };
  const stagingScopes = [stagingScope, refreshedStagingScope];
  const createAttachmentStagingScope = vi.fn(async () => stagingScopes.shift()!);
  const releaseAttachmentStagingScope = vi.fn(async () => undefined);
  const loadAttachmentCapability = vi.fn(async () => capability);
  const uploadAttachment = vi.fn(async (input: FlowerAttachmentUploadInput): Promise<FlowerStagedAttachment> => ({
    attachment_id: 'upl_shared_surface________',
    name: input.file.name,
    mime_type: input.file.type,
    size_bytes: input.file.size,
    digest_sha256: 'f'.repeat(64),
    source: 'file',
    capability_revision: capability.revision,
    locator: 'attachment://v1/upl_shared_surface/notes.txt',
  }));
  const launchCompletion = deferred<FlowerTurnLaunchReceipt>();
  let sharedLaunchInput: FlowerTurnLaunchInput | null = null;
  const launchTurn = vi.fn((input: FlowerTurnLaunchInput) => {
    sharedLaunchInput = input;
    return launchCompletion.promise;
  });
  const surfaceAdapter = {
    ...adapter(),
    listThreads: vi.fn(async () => []),
    loadAttachmentCapability,
    createAttachmentStagingScope,
    releaseAttachmentStagingScope,
    uploadAttachment,
    launchTurn,
  };
  const activity = renderSurfaceWithDraftCoordinator(surfaceAdapter, coordinator);
  await waitFor(() => loadAttachmentCapability.mock.calls.length >= 1);
  const workbench = renderSurfaceWithDraftCoordinator(surfaceAdapter, coordinator);
  await waitFor(() => loadAttachmentCapability.mock.calls.length >= 2);
  await flush();

  const picker = activity.querySelector('input[type="file"]') as HTMLInputElement;
  expect((activity.querySelector('button.flower-composer-attachment-button') as HTMLButtonElement).disabled).toBe(false);
  expect(picker.disabled).toBe(false);
  Object.defineProperty(picker, 'files', {
    configurable: true,
    value: [new File(['shared attachment'], 'notes.txt', { type: 'text/plain' })],
  });
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => createAttachmentStagingScope.mock.calls.length === 1);
  await flush();
  const sharedController = coordinator.attachmentController(
    '__new_thread__',
    () => { throw new Error('missing shared controller'); },
  );
  const sharedControllerSnapshot = sharedController.snapshot();
  expect(sharedControllerSnapshot).toMatchObject({
    capability,
    staging_scope: stagingScope,
  });
  await waitFor(() => sharedController.snapshot().items.length === 1);
  await waitFor(() => uploadAttachment.mock.calls.length === 1);
  await waitFor(() => coordinator.read('__new_thread__').value.attachments.length === 1);
  await waitFor(() => sharedController.snapshot().items[0]?.status === 'staged_ready');
  await waitFor(() => workbench.querySelector('[data-attachment-status="staged_ready"]') !== null);

  const textarea = workbench.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = 'send from Workbench';
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await waitFor(() => !(workbench.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
  (workbench.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
  await waitFor(() => launchTurn.mock.calls.length === 1);

  expect(createAttachmentStagingScope).toHaveBeenCalledTimes(1);
  expect(uploadAttachment).toHaveBeenCalledWith(expect.objectContaining({ staging_scope: stagingScope }));
  expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
    prompt: 'send from Workbench',
    staging_scope: stagingScope,
    attachment_ids: ['upl_shared_surface________'],
  }));
  expect(textarea.disabled).toBe(true);
  expect((activity.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
  expect((activity.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled).toBe(true);
  expect((activity.querySelector('.flower-composer') as HTMLElement).inert).toBe(true);
  expect((activity.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).disabled).toBe(true);

  textarea.value = 'late mutation from another surface';
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
  Object.defineProperty(picker, 'files', {
    configurable: true,
    value: [new File(['late attachment'], 'late.txt', { type: 'text/plain' })],
  });
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
  expect(coordinator.read('__new_thread__').value.text).toBe('send from Workbench');
  expect(sharedController.snapshot().items).toHaveLength(1);
  expect(launchTurn).toHaveBeenCalledTimes(1);
  expect(launchTurn).toHaveBeenLastCalledWith(expect.objectContaining({
    prompt: 'send from Workbench',
    attachment_ids: ['upl_shared_surface________'],
  }));

  launchCompletion.resolve(launchReceiptFor(sharedLaunchInput!, 'th_shared_surface', 'turn-shared-surface'));
  await waitFor(() => coordinator.read('__new_thread__').value.text === '');
  await waitFor(() => coordinator.read('th_shared_surface').value.text === '');

  expect(coordinator.read('__new_thread__').value.attachments).toEqual([]);
  expect(coordinator.read('th_shared_surface').value.attachments).toEqual([]);
  expect((activity.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');

  await waitFor(() => {
    const attachmentButton = activity.querySelector('.flower-composer-attachment-button') as HTMLButtonElement | null;
    return Boolean(attachmentButton && !attachmentButton.disabled);
  });
  const refreshedPicker = activity.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(refreshedPicker, 'files', {
    configurable: true,
    value: [new File(['second attachment'], 'second.txt', { type: 'text/plain' })],
  });
  refreshedPicker.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => createAttachmentStagingScope.mock.calls.length === 2);
  await waitFor(() => uploadAttachment.mock.calls.length === 2);

  expect(releaseAttachmentStagingScope).toHaveBeenCalledWith(stagingScope);
  expect(uploadAttachment.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
    staging_scope: refreshedStagingScope,
  }));
});

it('does not let a deferred long-paste conversion cross another surface send claim', async () => {
  const coordinator = createFlowerComposerDraftCoordinator();
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'capability-long-paste-claim', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
    routes: { 'text/plain; charset=utf-8': 'tool_read' },
  };
  const stagingScope = {
    staging_scope_id: 'staging-long-paste-claim',
    target_id: 'client-long-paste-claim',
    capability: 'long-paste-claim-secret',
    expires_at_unix_ms: Date.now() + 60_000,
  };
  const scopeCompletion = deferred<typeof stagingScope>();
  const uploadCompletion = deferred<FlowerStagedAttachment>();
  const launchCompletion = deferred<FlowerTurnLaunchReceipt>();
  const createAttachmentStagingScope = vi.fn(() => scopeCompletion.promise);
  const releaseAttachmentStagingScope = vi.fn(async () => undefined);
  const uploadAttachment = vi.fn((_input: FlowerAttachmentUploadInput) => uploadCompletion.promise);
  let longPasteLaunchInput: FlowerTurnLaunchInput | null = null;
  const launchTurn = vi.fn((input: FlowerTurnLaunchInput) => {
    longPasteLaunchInput = input;
    return launchCompletion.promise;
  });
  const surfaceAdapter = {
    ...adapter(),
    listThreads: vi.fn(async () => []),
    loadAttachmentCapability: vi.fn(async () => capability),
    createAttachmentStagingScope,
    releaseAttachmentStagingScope,
    uploadAttachment,
    launchTurn,
  };
  const activity = renderSurfaceWithDraftCoordinator(surfaceAdapter, coordinator);
  await waitFor(() => {
    const attachmentButton = activity.querySelector('.flower-composer-attachment-button') as HTMLButtonElement | null;
    return Boolean(attachmentButton && !attachmentButton.disabled);
  });
  const workbench = renderSurfaceWithDraftCoordinator(surfaceAdapter, coordinator);
  await waitFor(() => {
    const attachmentButton = workbench.querySelector('.flower-composer-attachment-button') as HTMLButtonElement | null;
    return Boolean(attachmentButton && !attachmentButton.disabled);
  });
  const activityTextarea = activity.querySelector('textarea') as HTMLTextAreaElement;
  const longText = `${'p'.repeat(50_001)}\nexact ending`;
  const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(paste, 'clipboardData', {
    value: { files: [], getData: (type: string) => type === 'text/plain' ? longText : '' },
  });
  activityTextarea.dispatchEvent(paste);
  await waitFor(() => createAttachmentStagingScope.mock.calls.length === 1);
  await waitFor(() => (workbench.querySelector('textarea') as HTMLTextAreaElement).value === longText);

  const submit = workbench.querySelector('.flower-composer-submit') as HTMLButtonElement;
  await waitFor(() => !submit.disabled);
  submit.click();
  await waitFor(() => Boolean(coordinator.read('__new_thread__').value.client_request_id));
  scopeCompletion.resolve(stagingScope);
  await waitFor(() => uploadAttachment.mock.calls.length === 1);
  const sentUpload = uploadAttachment.mock.calls[0]?.[0] as FlowerAttachmentUploadInput;
  expect(sentUpload.source).toBe('long_text');
  expect(sentUpload.file.size).toBe(new TextEncoder().encode(longText).byteLength);
  uploadCompletion.resolve({
    attachment_id: 'upl_long_paste_claim______',
    name: sentUpload.file.name,
    mime_type: sentUpload.file.type,
    size_bytes: sentUpload.file.size,
    digest_sha256: 'e'.repeat(64),
    source: 'long_text',
    capability_revision: capability.revision,
    locator: 'attachment://v1/upl_long_paste_claim/long.txt',
    text_stats: { code_points: Array.from(longText).length, lines: 2 },
  });
  await waitFor(() => launchTurn.mock.calls.length === 1);
  expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
    prompt: '',
    attachment_ids: ['upl_long_paste_claim______'],
  }));
  expect(uploadAttachment).toHaveBeenCalledTimes(1);

  launchCompletion.resolve(launchReceiptFor(longPasteLaunchInput!, 'th_long_paste_claim', 'turn-long-paste-claim'));
  await waitFor(() => coordinator.read('__new_thread__').value.text === '');
  await waitFor(() => coordinator.read('th_long_paste_claim').value.text === '');
  await flush();
  expect(coordinator.read('__new_thread__').value.attachments).toEqual([]);
  expect(coordinator.read('th_long_paste_claim').value.attachments).toEqual([]);
  expect(coordinator.attachmentController('__new_thread__', () => {
    throw new Error('missing shared controller');
  }).snapshot().items).toEqual([]);
  expect(uploadAttachment).toHaveBeenCalledTimes(1);
  expect(createAttachmentStagingScope).toHaveBeenCalledTimes(1);
  expect(releaseAttachmentStagingScope).toHaveBeenCalledWith(stagingScope);
});

it('always prevents a file drop from navigating even when attachments are unavailable', async () => {
  const runtime = renderSurfaceWithAdapter(adapter());
  await waitFor(() => Boolean(runtime.querySelector('.flower-composer')));
  const composer = runtime.querySelector('.flower-composer') as HTMLDivElement;
  const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(drop, 'dataTransfer', {
    value: { types: ['Files'], files: [new File(['blocked'], 'blocked.txt', { type: 'text/plain' })] },
  });

  composer.dispatchEvent(drop);

  expect(drop.defaultPrevented).toBe(true);
});

it('treats 50,001 whitespace characters as sendable long text instead of an empty prompt', async () => {
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'capability-whitespace', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
    routes: { 'text/plain': 'tool_read' },
  };
  const uploadStarted = deferred<FlowerStagedAttachment>();
  const uploadAttachment = vi.fn((_input: FlowerAttachmentUploadInput) => uploadStarted.promise);
  const surfaceAdapter = adapter();
  const runtime = renderSurfaceWithDraftCoordinator({
    ...surfaceAdapter,
    loadAttachmentCapability: vi.fn(async () => capability),
    uploadAttachment,
  }, createFlowerComposerDraftCoordinator());
  await waitFor(() => Boolean(runtime.querySelector('textarea')));
  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = ' '.repeat(50_001);
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  const submit = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;

  await waitFor(() => submit.getAttribute('aria-label') === 'Send' && !submit.disabled);
  submit.click();
  await waitFor(() => uploadAttachment.mock.calls.length === 1);

  expect(uploadAttachment.mock.calls[0]?.[0]).toMatchObject({ source: 'long_text' });
  expect((uploadAttachment.mock.calls[0]?.[0] as FlowerAttachmentUploadInput).file.size).toBe(50_001);
});

it('cancels an exact long-text upload without losing the editor text and allows retry', async () => {
  const coordinator = createFlowerComposerDraftCoordinator();
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'capability-long-text', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
    routes: { 'text/plain': 'tool_read' },
  };
  const uploadAttempts: Array<Readonly<{
    input: FlowerAttachmentUploadInput;
    completion: ReturnType<typeof deferred<FlowerStagedAttachment>>;
  }>> = [];
  const uploadAttachment = vi.fn((input: FlowerAttachmentUploadInput) => {
    const completion = deferred<FlowerStagedAttachment>();
    uploadAttempts.push({ input, completion });
    input.signal.addEventListener('abort', () => {
      completion.reject(new DOMException('The upload was canceled.', 'AbortError'));
    }, { once: true });
    return completion.promise;
  });
  const surfaceAdapter = adapter();
  const launchTurn = vi.fn(surfaceAdapter.launchTurn);
  const runtime = renderSurfaceWithDraftCoordinator({
    ...surfaceAdapter,
    loadAttachmentCapability: vi.fn(async () => capability),
    uploadAttachment,
    launchTurn,
  }, coordinator);

  await waitFor(() => Boolean(runtime.querySelector('textarea')));
  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  const longText = `${'x'.repeat(50_001)}\nkeep this exact ending`;
  textarea.value = longText;
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

  const submit = runtime.querySelector('button.flower-composer-submit') as HTMLButtonElement;
  await waitFor(() => !submit.disabled && submit.getAttribute('aria-label') === 'Send');
  submit.click();

  await waitFor(() => uploadAttempts.length === 1);
  await waitFor(() => submit.getAttribute('aria-label') === 'Stop');
  expect(submit.disabled).toBe(false);
  expect(uploadAttempts[0]?.input.source).toBe('long_text');
  expect(uploadAttempts[0]?.input.signal.aborted).toBe(false);

  submit.click();
  await waitFor(() => uploadAttempts[0]?.input.signal.aborted === true);
  await waitFor(() => !submit.disabled && submit.getAttribute('aria-label') === 'Send');
  expect(textarea.value).toBe(longText);
  expect(coordinator.read('__new_thread__').value).toMatchObject({
    text: longText,
    mode: 'over_limit_editing',
  });
  expect(coordinator.read('__new_thread__').value.attachments).toEqual([]);
  expect(launchTurn).not.toHaveBeenCalled();

  submit.click();
  await waitFor(() => uploadAttempts.length === 2);
  const retry = uploadAttempts[1]!;
  retry.completion.resolve({
    attachment_id: 'upl_long_text_retry_______',
    name: retry.input.file.name,
    mime_type: retry.input.file.type,
    size_bytes: retry.input.file.size,
    digest_sha256: 'a'.repeat(64),
    locator: `floret-attachment:sha256:${'a'.repeat(64)}`,
    source: 'long_text',
    text_stats: { code_points: 50_024, lines: 2 },
    capability_revision: capability.revision,
  });

  await waitFor(() => launchTurn.mock.calls.length === 1);
  expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
    prompt: '',
    attachment_ids: ['upl_long_text_retry_______'],
  }));
});

it('keeps a staged long-text draft isolated after navigating to another thread', async () => {
  const text = 'restored exact text '.repeat(3_000);
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'capability-restore-navigation', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
    routes: { 'text/plain; charset=utf-8': 'tool_read' },
  };
  const attachment: FlowerStagedAttachment = {
    attachment_id: 'upl_restore_navigation____', name: 'long-text.txt',
    mime_type: 'text/plain; charset=utf-8', size_bytes: new TextEncoder().encode(text).byteLength,
    digest_sha256: 'b'.repeat(64), source: 'long_text', capability_revision: capability.revision,
    locator: 'attachment://v1/upl_restore_navigation____/long-text.txt',
    text_stats: { code_points: Array.from(text).length, lines: 1 },
  };
  const coordinator = createFlowerComposerDraftCoordinator();
  const deleteStagedAttachment = vi.fn(async () => undefined);
  const surfaceAdapter = adapter();
  const runtime = renderSurfaceWithDraftCoordinator({
    ...surfaceAdapter,
    loadAttachmentCapability: vi.fn(async () => capability),
    uploadAttachment: vi.fn(async () => attachment),
    deleteStagedAttachment,
  }, coordinator);
  await waitFor(() => Boolean(runtime.querySelector('input[type="file"]')));
  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(paste, 'clipboardData', {
    value: { files: [], getData: (type: string) => type === 'text/plain' ? text : '' },
  });
  textarea.dispatchEvent(paste);
  const restoreSelector = 'button[aria-label="Restore to editor"]';
  await waitFor(() => Boolean(runtime.querySelector(restoreSelector)));
  await waitFor(() => coordinator.read('__new_thread__').value.attachments.length === 1);
  (runtime.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
  await waitFor(() => selectedThreadReady(runtime, 'thread-1'));
  await flush();
  await flush();

  expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).not.toContain(text);
  expect(deleteStagedAttachment).not.toHaveBeenCalled();
  expect(coordinator.read('__new_thread__').value.attachments).toHaveLength(1);
});

function withCanonicalUserTurnID<T extends { readonly messages: readonly { readonly id: string }[] }>(threadValue: T, userEntryID: string, turnID: string): T {
  return {
    ...threadValue,
    messages: threadValue.messages.map((message) => (
      message.id === userEntryID ? { ...message, turn_id: turnID } : message
    )),
  } as T;
}

function layoutRect(width: number, height = 22): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function installComposerControlLayoutHarness(input: {
  availableWidth: number;
  itemWidths?: Partial<Record<string, number>>;
  moreWidth?: number;
}) {
  const records: Array<{ callback: ResizeObserverCallback; elements: Element[] }> = [];
  vi.stubGlobal('ResizeObserver', class {
    private readonly record: { callback: ResizeObserverCallback; elements: Element[] };

    constructor(callback: ResizeObserverCallback) {
      this.record = { callback, elements: [] };
      records.push(this.record);
    }

    observe(element: Element) {
      this.record.elements.push(element);
    }

    unobserve(element: Element) {
      this.record.elements = this.record.elements.filter((item) => item !== element);
    }

    disconnect() {
      this.record.elements = [];
    }
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function composerControlRect(this: HTMLElement) {
    if (this.classList.contains('flower-composer-controls-viewport')) {
      return layoutRect(input.availableWidth);
    }
    const itemID = this.getAttribute('data-flower-composer-control-measure');
    if (itemID) {
      return layoutRect(input.itemWidths?.[itemID] ?? 80);
    }
    if (this.getAttribute('data-flower-composer-more-measure') === 'true') {
      return layoutRect(input.moreWidth ?? 30);
    }
    return layoutRect(0);
  });

  return {
    trigger() {
      for (const record of records) {
        record.callback(
          record.elements.map((target) => ({ target }) as ResizeObserverEntry),
          {} as ResizeObserver,
        );
      }
    },
  };
}

const DESKTOP_MODEL_ID = `desktop:model_${'c'.repeat(64)}`;

function dualSourceSnapshot(input: Readonly<{
  remoteReady?: boolean;
  desktopReady?: boolean;
  remoteCurrentModelID?: string;
}> = {}): FlowerSettingsSnapshot {
  const base = settingsSnapshot(input.remoteReady ?? true);
  return {
    ...base,
    model_profile: {
      ...base.model_profile!,
      current_model_id: input.remoteCurrentModelID ?? 'openai/gpt-5.2',
      providers: [{
        ...base.model_profile!.providers[0],
        models: [
          ...base.model_profile!.providers[0].models,
          { model_name: 'gpt-5.4', context_window: 400000, input_modalities: ['text'] },
        ],
      }],
    },
    model_source: input.desktopReady ?? true
      ? {
          kind: 'desktop_model_source',
          state: 'ready',
          current_model_id: DESKTOP_MODEL_ID,
          label: 'Desktop',
          models: [{
            id: DESKTOP_MODEL_ID,
            label: 'Desktop / Local Model',
            context_window: 200000,
            input_modalities: ['text'],
          }],
        }
      : {
          kind: 'desktop_model_source',
          state: 'error',
          label: 'Desktop',
          diagnostic_message: 'Desktop model bridge binding failed.',
        },
  };
}

describe('FlowerSurface navigation launch/send', () => {
  it('groups remote and Desktop models while keeping Desktop selection session scoped', async () => {
    const snapshot = dualSourceSnapshot();
    const persistDefaultModel = vi.fn(async () => snapshot);
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => (
      launchReceiptFor(input, 'thread-desktop-session-draft', 'turn-desktop-session')
    ));
    const surfaceAdapter = {
      ...adapter(true),
      runtime: {
        ...adapter(true).runtime,
        display_name: 'Demo Env',
      },
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel,
      launchTurn,
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent?.includes('gpt-5.2') ?? false);
    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-model-menu-group-label').length === 2);
    expect(Array.from(runtime.querySelectorAll('.flower-model-menu-group-label')).map((label) => label.textContent?.trim())).toEqual([
      'Demo Env',
      'Desktop',
    ]);
    expect(Array.from(runtime.querySelectorAll('[data-model-source]')).map((item) => item.getAttribute('data-model-source'))).toEqual([
      'model_profile',
      'model_profile',
      'desktop_model_source',
    ]);

    const desktopOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('Desktop / Local Model')) as HTMLButtonElement;
    desktopOption.click();
    await waitFor(() => runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent?.includes('Desktop / Local Model') ?? false);
    expect(persistDefaultModel).not.toHaveBeenCalled();

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'use Desktop for this window';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      model_id: DESKTOP_MODEL_ID,
    }));

    (runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-reasoning-model-trigger')));
    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .some((item) => item.textContent?.includes('Desktop / Local Model')));
    expect(persistDefaultModel).not.toHaveBeenCalled();

    const remounted = renderSurfaceWithAdapter(surfaceAdapter);
    await waitFor(() => remounted.querySelector('.flower-model-reasoning-model-trigger')?.textContent?.includes('gpt-5.2') ?? false);
    expect(remounted.querySelector('.flower-model-reasoning-model-trigger')?.textContent).not.toContain('Desktop / Local Model');
  });

  it('persists remote selections as the next Env default', async () => {
    let snapshot = dualSourceSnapshot();
    const persistDefaultModel = vi.fn(async (modelID: string) => {
      snapshot = {
        ...snapshot,
        model_profile: {
          ...snapshot.model_profile!,
          current_model_id: modelID,
        },
      };
      return snapshot;
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel,
    });

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-reasoning-model-trigger')));
    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-menu')));
    const remoteOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('gpt-5.4')) as HTMLButtonElement;
    remoteOption.click();

    await waitFor(() => persistDefaultModel.mock.calls.length === 1);
    expect(persistDefaultModel).toHaveBeenCalledWith('openai/gpt-5.4');
    expect(runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent).toContain('gpt-5.4');

    const remounted = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel,
    });
    await waitFor(() => remounted.querySelector('.flower-model-reasoning-model-trigger')?.textContent?.includes('gpt-5.4') ?? false);
  });

  it('patches Desktop onto an existing thread without changing the remote default', async () => {
    const snapshot = dualSourceSnapshot();
    let selectedThread = thread({
      thread_id: 'thread-desktop-isolated',
      title: 'Desktop isolated',
      model_id: 'openai/gpt-5.2',
    });
    const setThreadModel = vi.fn(async (_threadID: string, modelID: string) => {
      selectedThread = { ...selectedThread, model_id: modelID };
      return liveBootstrap(selectedThread);
    });
    const persistDefaultModel = vi.fn(async () => snapshot);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => [selectedThread]),
      loadThread: vi.fn(async () => liveBootstrap(selectedThread)),
      setThreadModel,
      persistDefaultModel,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-desktop-isolated"] button')));
    (runtime.querySelector('[data-thread-id="thread-desktop-isolated"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-desktop-isolated'));
    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-menu')));
    const desktopOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('Desktop / Local Model')) as HTMLButtonElement;
    desktopOption.click();

    await waitFor(() => setThreadModel.mock.calls.length === 1);
    expect(setThreadModel).toHaveBeenCalledWith('thread-desktop-isolated', DESKTOP_MODEL_ID);
    expect(persistDefaultModel).not.toHaveBeenCalled();
    expect(runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent).toContain('Desktop / Local Model');

    (runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement).click();
    await waitFor(() => {
      const trigger = runtime.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger');
      return Boolean(trigger && !trigger.disabled && trigger.textContent?.includes('gpt-5.2'));
    });
    (runtime.querySelector('[data-thread-id="thread-desktop-isolated"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent?.includes('Desktop / Local Model') ?? false);
  });

  it('keeps model switching available when the selected source is unavailable', async () => {
    const snapshot = dualSourceSnapshot({ remoteReady: false, desktopReady: true });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel: vi.fn(async () => snapshot),
    });

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-reasoning-model-trigger')));
    expect(runtime.querySelector('.flower-model-reasoning-warning')).toBeTruthy();
    expect((runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).disabled).toBe(false);
    expect((runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(runtime.querySelector('.flower-setup-inline')).toBeNull();
    expect(runtime.querySelector('.flower-setup-guide')).toBeNull();

    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-menu')));
    const desktopOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('Desktop / Local Model')) as HTMLButtonElement;
    desktopOption.click();
    await waitFor(() => runtime.querySelector('.flower-model-reasoning-warning') === null);
  });

  it('keeps the remote default ready when the optional Desktop source is unavailable', async () => {
    const snapshot = dualSourceSnapshot({ remoteReady: true, desktopReady: false });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel: vi.fn(async () => snapshot),
    });

    await waitFor(() => runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent?.includes('gpt-5.2') ?? false);
    expect(runtime.querySelector('.flower-model-reasoning-warning')).toBeNull();
    expect(runtime.querySelector('.flower-setup-inline')).toBeNull();
    expect((runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).disabled).toBe(false);
  });

  it('uses only the compact setup footer when no source has a usable model', async () => {
    const snapshot = dualSourceSnapshot({ remoteReady: false, desktopReady: false });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(false),
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel: vi.fn(async () => snapshot),
    });

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-source-status-footer')));
    expect(runtime.querySelector('.flower-empty-state')).toBeTruthy();
    expect(runtime.querySelector('.flower-setup-guide')).toBeNull();
    expect(runtime.querySelector('.flower-model-reasoning-control')).toBeNull();
  });

  it('refreshes only the settings snapshot and preserves the composer session', async () => {
    const readySnapshot = dualSourceSnapshot({ remoteReady: false, desktopReady: true });
    const initialSnapshot: FlowerSettingsSnapshot = {
      ...readySnapshot,
      model_source: {
        kind: 'desktop_model_source',
        state: 'empty',
        label: 'Desktop',
      },
    };
    let currentSnapshot = initialSnapshot;
    const loadSettings = vi.fn(async () => currentSnapshot);
    const listThreads = vi.fn(async () => []);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(false),
      loadSettings,
      listThreads,
      modelSourceRecovery: {
        describe: () => 'Desktop has no usable model.',
        localSettings: { label: 'Local Flower settings', run: vi.fn(async () => undefined) },
        runtimeSettings: { label: 'Runtime settings', run: vi.fn(async () => undefined) },
        connectionCenter: { label: 'Connection center', run: vi.fn(async () => undefined) },
      },
    });

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-source-status')));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'keep this draft';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    currentSnapshot = readySnapshot;
    (runtime.querySelector('.flower-model-source-status-refresh') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-reasoning-model-trigger')));
    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .some((item) => item.textContent?.includes('Desktop / Local Model')));
    expect(textarea.value).toBe('keep this draft');
    expect(listThreads).toHaveBeenCalledTimes(1);
    expect(loadSettings).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['missing_keys', 'local_settings'],
    ['empty', 'local_settings'],
    ['unsupported', 'runtime_settings'],
    ['unbound', 'connection_center'],
    ['connecting', 'connection_center'],
    ['expired', 'connection_center'],
    ['error', 'connection_center'],
  ] as const)('routes Desktop source state %s to %s', async (state, expectedAction) => {
    const localSettings = vi.fn(async () => undefined);
    const runtimeSettings = vi.fn(async () => undefined);
    const connectionCenter = vi.fn(async () => undefined);
    const source = state === 'missing_keys'
      ? { kind: 'desktop_model_source' as const, state, label: 'Desktop' as const, missing_key_provider_ids: ['openai'] }
      : state === 'error'
        ? { kind: 'desktop_model_source' as const, state, label: 'Desktop' as const, diagnostic_message: 'Binding failed.' }
        : { kind: 'desktop_model_source' as const, state, label: 'Desktop' as const };
    const runtime = renderSurfaceWithAdapter({
      ...adapter(false),
      loadSettings: vi.fn(async () => ({
        defaults: { permission_type: 'approval_required' as const },
        model_profile: null,
        provider_secrets: [],
        model_source: source,
      })),
      listThreads: vi.fn(async () => []),
      modelSourceRecovery: {
        describe: () => `Desktop source is ${state}.`,
        localSettings: { label: 'Local Flower settings', run: localSettings },
        runtimeSettings: { label: 'Runtime settings', run: runtimeSettings },
        connectionCenter: { label: 'Connection center', run: connectionCenter },
      },
    });

    await waitFor(() => runtime.querySelector('.flower-model-source-status')?.getAttribute('data-state') === state);
    const message = runtime.querySelector('.flower-model-source-status-message') as HTMLElement;
    expect(message.title).toBe(message.textContent);
    expect(runtime.querySelector('.flower-setup-guide')).toBeNull();
    (runtime.querySelector(`[data-model-source-action="${expectedAction}"]`) as HTMLButtonElement).click();

    await waitFor(() => localSettings.mock.calls.length + runtimeSettings.mock.calls.length + connectionCenter.mock.calls.length === 1);
    expect(localSettings).toHaveBeenCalledTimes(expectedAction === 'local_settings' ? 1 : 0);
    expect(runtimeSettings).toHaveBeenCalledTimes(expectedAction === 'runtime_settings' ? 1 : 0);
    expect(connectionCenter).toHaveBeenCalledTimes(expectedAction === 'connection_center' ? 1 : 0);
  });

  it('keeps an unavailable thread model as a disabled ungrouped snapshot option', async () => {
    const snapshot = dualSourceSnapshot();
    const unavailableModelID = `desktop:model_${'d'.repeat(64)}`;
    const staleThread = thread({ thread_id: 'thread-stale-model', model_id: unavailableModelID });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => [staleThread]),
      loadThread: vi.fn(async () => liveBootstrap(staleThread)),
      setThreadModel: vi.fn(async () => liveBootstrap(staleThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-stale-model"] button')));
    (runtime.querySelector('[data-thread-id="thread-stale-model"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-stale-model'));
    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-model-source="thread_snapshot"]')));

    const staleOption = runtime.querySelector('[data-model-source="thread_snapshot"]') as HTMLButtonElement;
    expect(staleOption.disabled).toBe(true);
    expect(staleOption.closest('[data-model-source-group]')).toBeNull();
    expect(runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent).toContain(unavailableModelID);
  });

  it('patches an existing thread permission from the composer footer', async () => {
    const baseThread = thread({
      thread_id: 'thread-permission-existing',
      title: 'Permission existing',
      permission_type: 'approval_required',
    });
    const updatedThread = {
      ...baseThread,
      permission_type: 'full_access' as const,
      updated_at_ms: baseThread.updated_at_ms + 1,
    };
    const setThreadPermissionType = vi.fn(async () => liveBootstrap(updatedThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [baseThread]),
      loadThread: vi.fn(async () => liveBootstrap(baseThread)),
      setThreadPermissionType,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-permission-existing"] button')));
    (runtime.querySelector('[data-thread-id="thread-permission-existing"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-permission-existing'));
    await waitFor(() => Boolean(runtime.querySelector('button.flower-permission-trigger[data-permission-type="approval_required"]')));

    const trigger = runtime.querySelector('button.flower-permission-trigger') as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    trigger.click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-permission-menu')));
    (runtime.querySelector('.flower-permission-menu-item[data-permission-type="full_access"]') as HTMLButtonElement).click();
    await waitFor(() => setThreadPermissionType.mock.calls.length === 1);

    expect(setThreadPermissionType).toHaveBeenCalledWith('thread-permission-existing', 'full_access');
    await waitFor(() => runtime.querySelector('button.flower-permission-trigger')?.getAttribute('data-permission-type') === 'full_access');
  });

  it('does not reselect a thread when a permission patch resolves after switching away', async () => {
    const baseThread = thread({
      thread_id: 'thread-permission-slow-source',
      title: 'Permission slow source',
      permission_type: 'approval_required',
    });
    const targetThread = thread({
      thread_id: 'thread-permission-switch-target',
      title: 'Permission switch target',
      permission_type: 'approval_required',
      messages: [{
        id: 'm-permission-switch-target',
        role: 'assistant',
        content: 'Target thread remains selected.',
        status: 'complete',
        created_at_ms: 5,
      }],
    });
    const updatedThread = {
      ...baseThread,
      permission_type: 'full_access' as const,
      updated_at_ms: baseThread.updated_at_ms + 1,
    };
    const permissionPatch = deferred<FlowerLiveBootstrap>();
    const setThreadPermissionType = vi.fn(async () => permissionPatch.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [targetThread, baseThread]),
      loadThread: vi.fn(async (threadID: string) => liveBootstrap(threadID === targetThread.thread_id ? targetThread : baseThread)),
      setThreadPermissionType,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-permission-slow-source"] button')));
    (runtime.querySelector('[data-thread-id="thread-permission-slow-source"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-permission-slow-source'));
    (runtime.querySelector('button.flower-permission-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-permission-menu')));
    (runtime.querySelector('.flower-permission-menu-item[data-permission-type="full_access"]') as HTMLButtonElement).click();
    await waitFor(() => setThreadPermissionType.mock.calls.length === 1);

    (runtime.querySelector('[data-thread-id="thread-permission-switch-target"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-permission-switch-target'));

    permissionPatch.resolve(liveBootstrap(updatedThread));
    await flush();

    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe('thread-permission-switch-target');
    expect(runtime.textContent).toContain('Target thread remains selected.');
    expect(runtime.querySelector('button.flower-permission-trigger')?.getAttribute('data-permission-type')).toBe('approval_required');
  });

  it('keeps the permission selector available while a thread is running', async () => {
    const runningThread = thread({
      thread_id: 'thread-permission-running',
      title: 'Permission running',
      status: 'running',
      active_run_id: 'run-permission-running',
      permission_type: 'approval_required',
      model_io_status: modelIOStatus({ run_id: 'run-permission-running' }),
    });
    const updatedThread = {
      ...runningThread,
      permission_type: 'readonly' as const,
      updated_at_ms: runningThread.updated_at_ms + 1,
    };
    const setThreadPermissionType = vi.fn(async () => liveBootstrap(updatedThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      setThreadPermissionType,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-permission-running"] button')));
    (runtime.querySelector('[data-thread-id="thread-permission-running"] button') as HTMLButtonElement).click();
    await waitFor(() => {
      const trigger = runtime.querySelector('button.flower-permission-trigger') as HTMLButtonElement | null;
      return !!trigger && trigger.getAttribute('data-permission-type') === 'approval_required' && !trigger.disabled;
    });

    (runtime.querySelector('button.flower-permission-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-permission-menu')));
    (runtime.querySelector('.flower-permission-menu-item[data-permission-type="readonly"]') as HTMLButtonElement).click();
    await waitFor(() => setThreadPermissionType.mock.calls.length === 1);

    expect(setThreadPermissionType).toHaveBeenCalledWith('thread-permission-running', 'readonly');
  });

  it('rolls back a failed thread permission patch', async () => {
    const baseThread = thread({
      thread_id: 'thread-permission-failed',
      title: 'Permission failed',
      permission_type: 'approval_required',
    });
    const setThreadPermissionType = vi.fn(async () => {
      throw new Error('permission denied');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [baseThread]),
      loadThread: vi.fn(async () => liveBootstrap(baseThread)),
      setThreadPermissionType,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-permission-failed"] button')));
    (runtime.querySelector('[data-thread-id="thread-permission-failed"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('button.flower-permission-trigger[data-permission-type="approval_required"]')));

    (runtime.querySelector('button.flower-permission-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-permission-menu')));
    (runtime.querySelector('.flower-permission-menu-item[data-permission-type="full_access"]') as HTMLButtonElement).click();
    await waitFor(() => flowerSurfaceNotifications().some((notice) => notice.message === 'permission denied'));

    expect(runtime.querySelector('button.flower-permission-trigger')?.getAttribute('data-permission-type')).toBe('approval_required');
    expect(flowerSurfaceNotifications()).toContainEqual(expect.objectContaining({
      tone: 'error',
      title: 'Flower could not save permission.',
      message: 'permission denied',
    }));
    expect(runtime.querySelector('.flower-composer-error')).toBeNull();
  });

  it('sends the local permission draft when launching a new thread', async () => {
    const launchedThread = thread({
      thread_id: 'thread-permission-new',
      title: 'Permission new',
      permission_type: 'full_access',
      messages: [
        {
          id: 'm-permission-new-user',
          role: 'user',
          content: 'start with full access',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, launchedThread.thread_id, 'turn-permission-new'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread: vi.fn(async () => liveBootstrap(launchedThread)),
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('button.flower-permission-trigger[data-permission-type="approval_required"]')));
    (runtime.querySelector('button.flower-permission-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-permission-menu')));
    (runtime.querySelector('.flower-permission-menu-item[data-permission-type="full_access"]') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('button.flower-permission-trigger')?.getAttribute('data-permission-type') === 'full_access');

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'start with full access';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'start with full access',
      permission_type: 'full_access',
    }));
  });

  it('selects a working directory before launching a new thread', async () => {
    const launchedThread = thread({
      thread_id: 'thread-working-dir-new',
      title: 'Working dir new',
      working_dir: '/Users/alice/redeven',
      messages: [
        {
          id: 'm-working-dir-user',
          role: 'user',
          content: 'start in redeven',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const getWorkingDirectoryPathContext = vi.fn(async () => ({
      agentHomePathAbs: '/Users/alice',
      homePathAbs: '/Users/alice',
      defaultRootId: 'home',
      roots: [
        {
          id: 'home',
          label: 'Home',
          pathAbs: '/Users/alice',
          kind: 'home',
          permissions: { read: true, write: true },
        },
      ],
    }));
    const listWorkingDirectoryEntries = vi.fn(async (input: { path: string; showHidden?: boolean }) => {
      if (input.path === '/Users/alice') {
        return [
          {
            name: 'redeven',
            path: '/Users/alice/redeven',
            isDirectory: true,
            modifiedAt: 1,
          },
        ];
      }
      return [];
    });
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, launchedThread.thread_id, 'turn-working-dir-new'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread: vi.fn(async () => liveBootstrap(launchedThread)),
      getWorkingDirectoryPathContext,
      listWorkingDirectoryEntries,
      launchTurn,
    });

    await waitFor(() => runtime.querySelector('.flower-composer-footer .flower-working-dir-chip')?.textContent?.includes('alice') === true);
    expect(runtime.querySelector('.flower-chat-header .flower-working-dir-chip')).toBeNull();
    expect(runtime.querySelector('[data-flower-composer-more-panel="true"]')).toBeNull();
    const chip = runtime.querySelector('.flower-composer-footer .flower-working-dir-chip') as HTMLButtonElement;
    expect(chip.getAttribute('title')).toContain('/Users/alice');
    chip.click();

    await waitFor(() => Boolean(runtime.querySelector('[data-directory-picker-entry="/redeven"]')));
    (runtime.querySelector('[data-directory-picker-entry="/redeven"]') as HTMLButtonElement).click();
    (runtime.querySelector('[data-directory-picker-confirm="true"]') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-composer-footer .flower-working-dir-chip')?.textContent?.includes('redeven') === true);

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'start in redeven';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'start in redeven',
      working_dir: '/Users/alice/redeven',
    }));
    expect(listWorkingDirectoryEntries).toHaveBeenCalledWith({
      path: '/Users/alice',
      showHidden: false,
    });
  });

  it('keeps composer controls inline when footer space is sufficient', async () => {
    const layout = installComposerControlLayoutHarness({
      availableWidth: 720,
      itemWidths: {
        working_dir: 118,
        permission: 94,
        model_reasoning: 248,
      },
      moreWidth: 30,
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      getWorkingDirectoryPathContext: vi.fn(async () => ({
        agentHomePathAbs: '/Users/alice',
        homePathAbs: '/Users/alice',
        defaultRootId: 'home',
        roots: [],
      })),
      listWorkingDirectoryEntries: vi.fn(async () => []),
    });

    layout.trigger();

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-composer-controls="true"]')));
    expect(runtime.querySelector('.flower-chat-header .flower-working-dir-chip')).toBeNull();
    expect(runtime.querySelector('[data-flower-composer-inline-item="working_dir"] .flower-working-dir-chip')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-composer-inline-item="permission"] .flower-permission-trigger')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-composer-inline-item="model_reasoning"] .flower-model-reasoning-control')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-composer-more-panel="true"]')).toBeNull();
    expect(runtime.querySelector('button.flower-composer-more-button')).toBeNull();
  });

  it('hides reasoning for models without reasoning support and omits stale reasoning on launch', async () => {
    let currentSnapshot: FlowerSettingsSnapshot = {
      ...settingsSnapshot(true),
      model_profile: {
        ...settingsSnapshot(true).model_profile!,
        current_model_id: 'openai/gpt-5.2',
        providers: [{
          ...settingsSnapshot(true).model_profile!.providers[0],
          models: [
            {
              model_name: 'gpt-5.2',
              context_window: 400000,
              input_modalities: ['text'],
              reasoning_capability: {
                supported_levels: ['low', 'medium', 'high'],
                default_level: 'medium',
              },
              default_reasoning_selection: { level: 'medium' },
            },
            {
              model_name: 'plain-text',
              context_window: 200000,
              input_modalities: ['text'],
            },
          ],
        }],
      },
    };
    const launchedThread = thread({
      thread_id: 'thread-no-reasoning-launch',
      title: 'No reasoning launch',
      model_id: 'openai/plain-text',
    });
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, launchedThread.thread_id, 'turn-model-capability'));
    const surfaceAdapter = {
      ...adapter(true),
      loadSettings: vi.fn(async () => currentSnapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel: vi.fn(async (modelID: string) => {
        currentSnapshot = {
          ...currentSnapshot,
          model_profile: {
            ...currentSnapshot.model_profile!,
            current_model_id: modelID,
          },
        };
        return currentSnapshot;
      }),
      launchTurn,
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);
    const modelReasoningControl = () => runtime.querySelector('[data-flower-composer-control="model_reasoning"]') as HTMLElement | null;

    await waitFor(() => modelReasoningControl()?.getAttribute('data-has-reasoning') === 'true');
    expect(runtime.querySelector('.flower-reasoning-control-segment')).toBeTruthy();

    (runtime.querySelector('.flower-reasoning-segment-button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-reasoning-menu')));
    const highOption = Array.from(runtime.querySelectorAll('.flower-reasoning-menu-item'))
      .find((button) => button.textContent?.trim() === 'High') as HTMLButtonElement | undefined;
    highOption?.click();
    await waitFor(() => runtime.querySelector('.flower-reasoning-segment-button')?.textContent?.includes('High') === true);

    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-menu')));
    const plainOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('plain-text')) as HTMLButtonElement | undefined;
    plainOption?.click();

    await waitFor(() => surfaceAdapter.persistDefaultModel.mock.calls.length === 1);
    await waitFor(() => modelReasoningControl()?.getAttribute('data-has-reasoning') === 'false');
    expect(surfaceAdapter.persistDefaultModel).toHaveBeenCalledWith('openai/plain-text');
    expect(runtime.querySelector('.flower-reasoning-control-segment')).toBeNull();

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'launch without reasoning';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'launch without reasoning',
      model_id: 'openai/plain-text',
    }));
    const launchInput = launchTurn.mock.calls[0]?.[0];
    expect(launchInput).not.toHaveProperty('reasoning_selection');
  });

  it('selects opaque Desktop models and reasoning before launching a new thread', async () => {
    const deepSeekModelID = `desktop:model_${'3'.repeat(64)}`;
    const plainModelID = `desktop:model_${'4'.repeat(64)}`;
    let currentSnapshot: FlowerSettingsSnapshot = {
      ...settingsSnapshot(false),
      model_profile: null,
      provider_secrets: [],
      model_source: {
        kind: 'desktop_model_source',
        state: 'ready',
        current_model_id: deepSeekModelID,
        label: 'Desktop',
        models: [
          {
            id: deepSeekModelID,
            label: 'Desktop / DeepSeek / deepseek-v4-pro',
            context_window: 950000,
            max_output_tokens: 384000,
            input_modalities: ['text'],
            reasoning_capability: {
              kind: 'effort',
              supported_levels: ['high', 'max'],
              default_level: 'high',
              wire_shape: 'deepseek_reasoning_effort',
            },
          },
          {
            id: plainModelID,
            label: 'Desktop / Plain',
            context_window: 128000,
            max_output_tokens: 4096,
            input_modalities: ['text'],
          },
        ],
      },
    };
    const launchedThread = thread({
      thread_id: 'thread-desktop-source-launch',
      title: 'Desktop source launch',
      model_id: deepSeekModelID,
      reasoning_selection: { level: 'high' },
    });
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, launchedThread.thread_id, 'turn-reasoning'));
    const persistDefaultModel = vi.fn(async () => currentSnapshot);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(false),
      loadSettings: vi.fn(async () => currentSnapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel,
      launchTurn,
    });
    const modelReasoningControl = () => runtime.querySelector('[data-flower-composer-control="model_reasoning"]') as HTMLElement | null;

    await waitFor(() => modelReasoningControl()?.getAttribute('data-has-reasoning') === 'true');
    expect(runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent).toContain('deepseek-v4-pro');
    expect(runtime.querySelector('.flower-reasoning-segment-button')?.textContent).toContain('High');

    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-model-menu-item').length === 2);
    expect(Array.from(runtime.querySelectorAll('.flower-model-menu-item')).map((item) => item.textContent)).toEqual([
      expect.stringContaining('deepseek-v4-pro'),
      expect.stringContaining('Desktop / Plain'),
    ]);
    const plainOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('Desktop / Plain')) as HTMLButtonElement | undefined;
    plainOption?.click();
    await waitFor(() => modelReasoningControl()?.getAttribute('data-has-reasoning') === 'false');
    expect(persistDefaultModel).not.toHaveBeenCalled();

    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-menu')));
    const deepSeekOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('deepseek-v4-pro')) as HTMLButtonElement | undefined;
    deepSeekOption?.click();
    await waitFor(() => modelReasoningControl()?.getAttribute('data-has-reasoning') === 'true');
    expect(persistDefaultModel).not.toHaveBeenCalled();
    expect(runtime.querySelector('.flower-reasoning-segment-button')?.textContent).toContain('High');

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'launch through desktop source';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'launch through desktop source',
      model_id: deepSeekModelID,
      reasoning_selection: { level: 'high' },
    }));
  });

  it('writes a selected thread model as the next new-thread default', async () => {
    let selectedModelThread = thread({
      thread_id: 'thread-model-default',
      title: 'Model default',
      model_id: 'openai/gpt-5.2',
    });
    let currentSnapshot: FlowerSettingsSnapshot = {
      ...settingsSnapshot(true),
      model_profile: {
        ...settingsSnapshot(true).model_profile!,
        providers: [{
          ...settingsSnapshot(true).model_profile!.providers[0],
          models: [
            ...settingsSnapshot(true).model_profile!.providers[0].models,
            { model_name: 'gpt-5.4', context_window: 400000, input_modalities: ['text'] },
          ],
        }],
      },
    };
    const surfaceAdapter = {
      ...mutableSettingsAdapter(true),
      loadSettings: vi.fn(async () => currentSnapshot),
      listThreads: vi.fn(async () => [selectedModelThread]),
      loadThread: vi.fn(async () => liveBootstrap(selectedModelThread)),
      setThreadModel: vi.fn(async (_threadID: string, modelID: string) => {
        selectedModelThread = {
          ...selectedModelThread,
          model_id: modelID,
        };
        return liveBootstrap(selectedModelThread);
      }),
      persistDefaultModel: vi.fn(async (modelID: string) => {
        currentSnapshot = {
          ...currentSnapshot,
          model_profile: {
            ...currentSnapshot.model_profile!,
            current_model_id: modelID,
          },
        };
        return currentSnapshot;
      }),
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-model-default"] button')));
    (runtime.querySelector('[data-thread-id="thread-model-default"] button') as HTMLButtonElement).click();
    await waitFor(() => {
      const trigger = runtime.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger');
      return Boolean(trigger && !trigger.disabled && trigger.textContent?.includes('gpt-5.2'));
    });

    runtime.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger')!.click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-menu')));
    const nextModelOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('gpt-5.4')) as HTMLButtonElement | undefined;
    nextModelOption?.click();

    await waitFor(() => surfaceAdapter.persistDefaultModel.mock.calls.length === 1);
    expect(surfaceAdapter.setThreadModel).toHaveBeenCalledWith('thread-model-default', 'openai/gpt-5.4');
    expect(surfaceAdapter.persistDefaultModel).toHaveBeenCalledWith('openai/gpt-5.4');
    expect(surfaceAdapter.setThreadModel.mock.invocationCallOrder[0]).toBeLessThan(surfaceAdapter.persistDefaultModel.mock.invocationCallOrder[0]);
    expect(runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent).toContain('OpenAI / gpt-5.4');
  });

  it('keeps the selected thread model and toasts when updating the future default fails', async () => {
    let selectedModelThread = thread({
      thread_id: 'thread-model-default-fails',
      title: 'Model default failure',
      model_id: 'openai/gpt-5.2',
    });
    const currentSnapshot: FlowerSettingsSnapshot = {
      ...settingsSnapshot(true),
      model_profile: {
        ...settingsSnapshot(true).model_profile!,
        current_model_id: 'openai/gpt-5.2',
        providers: [{
          ...settingsSnapshot(true).model_profile!.providers[0],
          models: [
            ...settingsSnapshot(true).model_profile!.providers[0].models,
            { model_name: 'gpt-5.4', context_window: 400000, input_modalities: ['text'] },
          ],
        }],
      },
    };
    const surfaceAdapter = {
      ...mutableSettingsAdapter(true),
      loadSettings: vi.fn(async () => currentSnapshot),
      listThreads: vi.fn(async () => [selectedModelThread]),
      loadThread: vi.fn(async () => liveBootstrap(selectedModelThread)),
      setThreadModel: vi.fn(async (_threadID: string, modelID: string) => {
        selectedModelThread = {
          ...selectedModelThread,
          model_id: modelID,
        };
        return liveBootstrap(selectedModelThread);
      }),
      persistDefaultModel: vi.fn(async () => {
        throw new Error('default save failed');
      }),
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-model-default-fails"] button')));
    (runtime.querySelector('[data-thread-id="thread-model-default-fails"] button') as HTMLButtonElement).click();
    await waitFor(() => {
      const trigger = runtime.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger');
      return Boolean(trigger && !trigger.disabled && trigger.textContent?.includes('gpt-5.2'));
    });

    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-menu')));
    const nextModelOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('gpt-5.4')) as HTMLButtonElement | undefined;
    nextModelOption?.click();

    await waitFor(() => flowerSurfaceNotifications().some((notice) => notice.message.includes('default save failed')));
    expect(surfaceAdapter.setThreadModel).toHaveBeenCalledWith('thread-model-default-fails', 'openai/gpt-5.4');
    expect(surfaceAdapter.persistDefaultModel).toHaveBeenCalledWith('openai/gpt-5.4');
    expect(flowerSurfaceNotifications()).toContainEqual(expect.objectContaining({
      tone: 'error',
      title: 'Default model was not updated.',
      message: 'default save failed',
    }));
    expect(runtime.querySelector('.flower-composer-error')).toBeNull();
    expect(runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent).toContain('OpenAI / gpt-5.4');
  });

  it('moves overflowing composer controls into the More panel without changing working directory launch behavior', async () => {
    const layout = installComposerControlLayoutHarness({
      availableWidth: 230,
      itemWidths: {
        working_dir: 122,
        permission: 90,
        model_reasoning: 248,
      },
      moreWidth: 30,
    });
    const launchedThread = thread({
      thread_id: 'thread-working-dir-overflow',
      title: 'Working dir overflow',
      working_dir: '/Users/alice/redeven',
      messages: [
        {
          id: 'm-working-dir-overflow-user',
          role: 'user',
          content: 'start in overflow redeven',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const getWorkingDirectoryPathContext = vi.fn(async () => ({
      agentHomePathAbs: '/Users/alice',
      homePathAbs: '/Users/alice',
      defaultRootId: 'home',
      roots: [],
    }));
    const listWorkingDirectoryEntries = vi.fn(async (input: { path: string; showHidden?: boolean }) => {
      if (input.path === '/Users/alice') {
        return [{
          name: 'redeven',
          path: '/Users/alice/redeven',
          isDirectory: true,
          modifiedAt: 1,
        }];
      }
      return [];
    });
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, launchedThread.thread_id, 'turn-working-dir-overflow'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread: vi.fn(async () => liveBootstrap(launchedThread)),
      loadAttachmentCapability: vi.fn(async (modelID: string): Promise<FlowerAttachmentCapability> => ({
        model_id: modelID,
        revision: 'composer-action-order',
        enabled: true,
        supports_long_text: true,
        max_attachments: 4,
        max_file_size_bytes: 1_000_000,
        max_total_size_bytes: 2_000_000,
        routes: { 'text/plain': 'tool_read' },
      })),
      uploadAttachment: vi.fn(async () => {
        throw new Error('upload is not expected in the action-order test');
      }),
      getWorkingDirectoryPathContext,
      listWorkingDirectoryEntries,
      launchTurn,
    });

    layout.trigger();

    await waitFor(() => Boolean(
      runtime.querySelector('button.flower-composer-attachment-button')
      && runtime.querySelector('button.flower-composer-more-button'),
    ));
    const attachmentButton = runtime.querySelector('button.flower-composer-attachment-button') as HTMLButtonElement;
    const moreButton = runtime.querySelector('button.flower-composer-more-button') as HTMLButtonElement;
    expect(attachmentButton.compareDocumentPosition(moreButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(runtime.querySelector('[data-flower-composer-inline-item="permission"] .flower-permission-trigger')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-composer-inline-item="working_dir"]')).toBeNull();
    (runtime.querySelector('button.flower-composer-more-button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-composer-more-panel="true"]')));
    expect(runtime.querySelector('[data-flower-composer-more-item="working_dir"] .flower-working-dir-chip')).toBeTruthy();

    (runtime.querySelector('[data-flower-composer-more-item="working_dir"] .flower-working-dir-chip') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-directory-picker-entry="/redeven"]')));
    (runtime.querySelector('[data-directory-picker-entry="/redeven"]') as HTMLButtonElement).click();
    (runtime.querySelector('[data-directory-picker-confirm="true"]') as HTMLButtonElement).click();
    await waitFor(() => !runtime.querySelector('[data-flower-composer-more-panel="true"]'));
    (runtime.querySelector('button.flower-composer-more-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-composer-more-item="working_dir"] .flower-working-dir-chip')?.textContent?.includes('redeven') === true);

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'start in overflow redeven';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'start in overflow redeven',
      working_dir: '/Users/alice/redeven',
    }));
  });

  it('closes the composer More panel with Escape and outside pointer input', async () => {
    const layout = installComposerControlLayoutHarness({
      availableWidth: 180,
      itemWidths: {
        working_dir: 122,
        permission: 90,
        model_reasoning: 248,
      },
      moreWidth: 30,
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      getWorkingDirectoryPathContext: vi.fn(async () => ({
        agentHomePathAbs: '/Users/alice',
        homePathAbs: '/Users/alice',
        defaultRootId: 'home',
        roots: [],
      })),
      listWorkingDirectoryEntries: vi.fn(async () => []),
    });

    layout.trigger();

    await waitFor(() => Boolean(runtime.querySelector('button.flower-composer-more-button')));
    const moreButton = runtime.querySelector('button.flower-composer-more-button') as HTMLButtonElement;
    moreButton.click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-composer-more-panel="true"]')));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => runtime.querySelector('[data-flower-composer-more-panel="true"]') === null);

    moreButton.click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-composer-more-panel="true"]')));
    document.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    await waitFor(() => runtime.querySelector('[data-flower-composer-more-panel="true"]') === null);
  });

  it('copies an existing thread working directory from the composer footer chip', async () => {
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, input.thread_id ?? 'thread-1', 'turn-copy-workdir'));
    const existingThread = thread({
      thread_id: 'thread-existing-workdir',
      title: 'Existing working dir',
      working_dir: '/Users/alice/redeven',
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [existingThread]),
      loadThread: vi.fn(async () => liveBootstrap(existingThread)),
      getWorkingDirectoryPathContext: vi.fn(async () => {
        throw new Error('picker should not open for existing threads');
      }),
      listWorkingDirectoryEntries: vi.fn(async () => []),
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-existing-workdir"] button')));
    (runtime.querySelector('[data-thread-id="thread-existing-workdir"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-composer-footer .flower-working-dir-chip')?.textContent?.includes('redeven') === true);
    expect(runtime.querySelector('.flower-chat-header .flower-working-dir-chip')).toBeNull();

    const chip = runtime.querySelector('.flower-composer-footer .flower-working-dir-chip') as HTMLButtonElement;
    expect(chip.getAttribute('title')).toContain('/Users/alice/redeven');
    chip.click();
    await waitFor(() => writeText.mock.calls.length === 1);

    expect(writeText).toHaveBeenCalledWith('/Users/alice/redeven');
    expect(runtime.querySelector('[data-directory-picker="true"]')).toBeNull();
    expect(launchTurn).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
  });

  it('copies an existing thread working directory from the composer More panel without opening the picker', async () => {
    const layout = installComposerControlLayoutHarness({
      availableWidth: 180,
      itemWidths: {
        working_dir: 122,
        permission: 90,
        model_reasoning: 248,
      },
      moreWidth: 30,
    });
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, input.thread_id ?? 'thread-1', 'turn-copy-workdir-overflow'));
    const existingThread = thread({
      thread_id: 'thread-existing-workdir-overflow',
      title: 'Existing working dir overflow',
      working_dir: '/Users/alice/redeven',
    });
    const getWorkingDirectoryPathContext = vi.fn(async () => {
      throw new Error('picker should not open for existing threads');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [existingThread]),
      loadThread: vi.fn(async () => liveBootstrap(existingThread)),
      getWorkingDirectoryPathContext,
      listWorkingDirectoryEntries: vi.fn(async () => []),
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-existing-workdir-overflow"] button')));
    (runtime.querySelector('[data-thread-id="thread-existing-workdir-overflow"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-existing-workdir-overflow'));
    layout.trigger();
    await waitFor(() => Boolean(runtime.querySelector('button.flower-composer-more-button')));

    (runtime.querySelector('button.flower-composer-more-button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-composer-more-item="working_dir"] .flower-working-dir-chip')));
    (runtime.querySelector('[data-flower-composer-more-item="working_dir"] .flower-working-dir-chip') as HTMLButtonElement).click();
    await waitFor(() => writeText.mock.calls.length === 1);

    expect(writeText).toHaveBeenCalledWith('/Users/alice/redeven');
    expect(runtime.querySelector('[data-directory-picker="true"]')).toBeNull();
    expect(launchTurn).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
  });

  it('stops a running selected thread from the composer when the draft is empty', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-stop',
      title: 'Running stop',
      status: 'running',
    });
    const stoppedThread = thread({
      ...runningThread,
      status: 'canceled',
      model_io_status: null,
    });
    const stopThread = vi.fn(async () => liveBootstrap(stoppedThread));
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, stoppedThread.thread_id, 'turn-stopped'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-stop"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-stop"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-stop'));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Stop' && !button.disabled;
    });

    const stopButton = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;
    const stopIcon = stopButton.querySelector('svg');
    const stopIconRect = stopIcon?.querySelector('rect');
    expect(stopButton.className).toContain('flower-composer-submit');
    expect(stopButton.className).toContain('rounded-full');
    expect(stopIcon?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(stopIconRect?.getAttribute('x')).toBe('6');
    expect(stopIconRect?.getAttribute('y')).toBe('6');
    expect(stopIconRect?.getAttribute('width')).toBe('12');
    expect(stopIconRect?.getAttribute('height')).toBe('12');
    expect(stopIconRect?.getAttribute('stroke')).toBe('none');

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    stopButton.click();
    await waitFor(() => stopThread.mock.calls.length > 0);

    expect(stopThread).toHaveBeenCalledWith('thread-running-stop');
    expect(launchTurn).not.toHaveBeenCalled();
  });

  it('prevents duplicate stop clicks while thread stop is in flight', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-stop-once',
      title: 'Running stop once',
      status: 'running',
    });
    const stoppedThread = thread({
      ...runningThread,
      status: 'canceled',
      model_io_status: null,
    });
    const stopDeferred = deferred<FlowerLiveBootstrap>();
    const stopThread = vi.fn(() => stopDeferred.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-stop-once"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-stop-once"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-stop-once'));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Stop' && !button.disabled;
    });

    const stopButton = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;
    stopButton.click();
    stopButton.click();
    await waitFor(() => stopThread.mock.calls.length === 1);

    expect(stopThread).toHaveBeenCalledTimes(1);
    stopDeferred.resolve(liveBootstrap(stoppedThread));
    await waitFor(() => stopButton.disabled);
  });

  it('queues a non-empty composer draft on a running selected thread without stopping it', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-send-queue',
      title: 'Running send queue',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-running-send' }),
    });
    const stopThread = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }));
    let acceptedQueueID = '';
    const queuedThread = () => thread({
      ...runningThread,
      queued_turn_count: 1,
      queued_turns: [{
        queue_id: acceptedQueueID,
        prompt: 'continue while running',
        created_at_ms: 10,
      }],
    });
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => {
      acceptedQueueID = 'queue-running';
      return launchReceiptFor(input, runningThread.thread_id, acceptedQueueID, 'queued');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(acceptedQueueID ? queuedThread() : runningThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-send-queue"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-send-queue"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-send-queue'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'continue while running';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length > 0);

    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-running-send-queue',
      prompt: 'continue while running',
    }));
    await waitFor(() => Boolean(runtime.querySelector(`[data-flower-queued-turn-id="${acceptedQueueID}"]`)));
    expect(runtime.querySelector(`[data-flower-queued-turn-id="${acceptedQueueID}"]`)?.textContent).toContain('continue while running');
  });

  it('compacts a running selected thread without stopping or launching a new turn', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-compact',
      title: 'Running compact',
      status: 'running',
      active_run_id: 'run-compact',
      model_io_status: modelIOStatus({ run_id: 'run-compact' }),
      messages: [
        {
          id: 'm-compact-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-compact-assistant',
          role: 'assistant',
          content: 'working',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'working' }],
        },
      ],
    });
    const compactThreadContext = vi.fn(async () => liveBootstrap(runningThread, 3));
    const stopThread = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }));
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, runningThread.thread_id, 'turn-compaction-running'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      compactThreadContext,
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-compact"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-compact"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-compact'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Compact context' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => compactThreadContext.mock.calls.length === 1);

    expect(compactThreadContext).toHaveBeenCalledWith({
      thread_id: 'thread-running-compact',
      active_run_id: 'run-compact',
    });
    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).not.toHaveBeenCalled();
    await waitFor(() => (runtime.querySelector('textarea') as HTMLTextAreaElement).value === '');
  });

  it('does not execute compact from Enter before chat setup is ready', async () => {
    const selected = thread({
      thread_id: 'thread-compact-needs-setup',
      title: 'Compact needs setup',
      status: 'idle',
      messages: [
        {
          id: 'm-compact-needs-setup-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const compactThreadContext = vi.fn(async () => liveBootstrap(selected));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(false),
      listThreads: vi.fn(async () => [selected]),
      loadThread: vi.fn(async () => liveBootstrap(selected)),
      compactThreadContext,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-needs-setup"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-needs-setup"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-compact-needs-setup'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    await waitFor(() => Boolean(runtime.querySelector('.flower-settings-surface')));
    expect(compactThreadContext).not.toHaveBeenCalled();
  });

  it('executes compact from the slash menu, scrolls the transcript, and shows an immediate compaction divider', async () => {
    const compactingThread = thread({
      thread_id: 'thread-running-compact-menu',
      title: 'Running compact menu',
      status: 'running',
      active_run_id: 'run-compact-menu',
      model_io_status: modelIOStatus({ run_id: 'run-compact-menu' }),
      messages: [
        {
          id: 'm-compact-menu-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-compact-menu-assistant',
          role: 'assistant',
          content: 'working',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'working' }],
        },
      ],
    });
    const compactDeferred = deferred<FlowerLiveBootstrap>();
    const compactThreadContext = vi.fn(() => compactDeferred.promise);
    const stopThread = vi.fn(async () => liveBootstrap({ ...compactingThread, status: 'canceled' }));
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, compactingThread.thread_id, 'turn-compacting'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [compactingThread]),
      loadThread: vi.fn(async () => liveBootstrap(compactingThread)),
      compactThreadContext,
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-compact-menu"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-compact-menu"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-compact-menu'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const transcript = runtime.querySelector('.flower-chat-transcript') as HTMLElement;
    let scrollTop = 0;
    Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 180 });
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 920 });
    Object.defineProperty(transcript, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = Number(value);
      },
    });

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/com';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-command-menu')));

    (runtime.querySelector('.flower-composer-command-item') as HTMLButtonElement).click();
    await waitFor(() => compactThreadContext.mock.calls.length === 1);
    await waitFor(() => Boolean(runtime.querySelector('.flower-compaction-divider[data-flower-compaction-status="compacting"]')));
    await waitFor(() => scrollTop === 740);

    expect(compactThreadContext).toHaveBeenCalledWith({
      thread_id: 'thread-running-compact-menu',
      active_run_id: 'run-compact-menu',
    });
    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).not.toHaveBeenCalled();
    expect(textarea.value).toBe('');

    const timelineNodes = Array.from(runtime.querySelectorAll('[data-flower-message-id], .flower-compaction-divider'));
    expect(timelineNodes.map((node) => (
      node instanceof HTMLElement && node.hasAttribute('data-flower-message-id')
        ? node.getAttribute('data-flower-message-id')
        : `divider:${(node as HTMLElement).getAttribute('data-flower-compaction-status')}`
    ))).toEqual([
      'm-compact-menu-user',
      'm-compact-menu-assistant',
      'divider:compacting',
      'm-compact-menu-assistant',
    ]);

    compactDeferred.resolve(liveBootstrap({
      ...compactingThread,
      timeline_decorations: [{
        decoration_id: 'local-context-compaction-thread-running-compact-menu',
        kind: 'context_compaction',
        ordinal: 999,
        anchor: {
          target_kind: 'message',
          message_id: 'm-compact-menu-assistant',
          edge: 'after',
        },
        compaction: {
          operation_id: 'compact-menu-real',
          phase: 'start',
          status: 'compacting',
          updated_at_ms: Date.now() + 1_000,
        },
      }],
    }));
    await waitFor(() => compactThreadContext.mock.calls.length === 1);
  });

  it('executes the selected slash command from keyboard Enter without completing first', async () => {
    const runningThread = thread({
      thread_id: 'thread-compact-keyboard-suggest',
      title: 'Compact keyboard suggest',
      status: 'running',
      active_run_id: 'run-compact-keyboard',
      model_io_status: modelIOStatus({ run_id: 'run-compact-keyboard' }),
      messages: [{
        id: 'm-compact-keyboard-user',
        role: 'user',
        content: 'inspect the repository',
        status: 'complete',
        created_at_ms: 10,
      }],
    });
    const compactDeferred = deferred<FlowerLiveBootstrap>();
    const compactThreadContext = vi.fn(() => compactDeferred.promise);
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, runningThread.thread_id, 'turn-running-queued'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      compactThreadContext,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-keyboard-suggest"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-keyboard-suggest"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-compact-keyboard-suggest'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/com';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-command-menu')));
    const menu = runtime.querySelector('.flower-composer-command-menu') as HTMLElement;
    const option = runtime.querySelector('.flower-composer-command-item') as HTMLButtonElement;
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(menu.getAttribute('aria-activedescendant')).toBe(option.id);
    expect(textarea.getAttribute('aria-controls')).toBe(menu.id);
    expect(textarea.getAttribute('aria-expanded')).toBe('true');
    expect(textarea.getAttribute('aria-activedescendant')).toBe(option.id);

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => compactThreadContext.mock.calls.length === 1);
    expect(textarea.value).toBe('');
    expect(runtime.querySelector('.flower-compaction-divider[data-flower-compaction-status="compacting"]')).not.toBeNull();
    expect(launchTurn).not.toHaveBeenCalled();

    compactDeferred.resolve(liveBootstrap(runningThread));
    await waitFor(() => compactThreadContext.mock.calls.length === 1);
  });

  it('stops polling once a real compaction decoration replaces the local pending divider', async () => {
    const idleThread = thread({
      thread_id: 'thread-compact-pending-clears',
      title: 'Compact pending clears',
      status: 'success',
      messages: [
        {
          id: 'm-compact-pending-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-compact-pending-assistant',
          role: 'assistant',
          content: 'done',
          status: 'complete',
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'done' }],
        },
      ],
    });
    const realCompactionThread = thread({
      ...idleThread,
      context_compactions: [{
        operation_id: 'compact-pending-real',
        phase: 'complete',
        status: 'compacted',
        trigger: 'manual',
        reason: 'manual',
        updated_at_ms: 1,
      }],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-pending-real',
        kind: 'context_compaction',
        ordinal: 1,
        anchor: {
          target_kind: 'message',
          message_id: 'm-compact-pending-assistant',
          edge: 'after',
        },
        compaction: {
          operation_id: 'compact-pending-real',
          phase: 'complete',
          status: 'compacted',
          trigger: 'manual',
          reason: 'manual',
          updated_at_ms: 1,
        },
      }],
    });
    const listThreadLiveEvents = vi.fn(async () => ({
      stream_generation: 1,
      events: [],
      next_cursor: 1,
      retained_from_seq: 1,
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [idleThread]),
      loadThread: vi.fn(async () => liveBootstrap(idleThread)),
      compactThreadContext: vi.fn(async () => liveBootstrap(realCompactionThread, 2)),
      listThreadLiveEvents,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-pending-clears"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-pending-clears"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-compact-pending-clears'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Compact context' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-compaction-divider[data-flower-compaction-status="compacted"]')));
    expect(runtime.querySelectorAll('.flower-compaction-divider')).toHaveLength(1);
    const callsAfterRealDecoration = listThreadLiveEvents.mock.calls.length;
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    expect(listThreadLiveEvents).toHaveBeenCalledTimes(callsAfterRealDecoration);
  });

  it('emits a debug event when selected thread live polling times out', async () => {
    vi.useFakeTimers();
    const runningThread = thread({
      thread_id: 'thread-live-timeout-debug',
      title: 'Live timeout debug',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-live-timeout-debug' }),
      messages: [
        {
          id: 'm-live-timeout-user',
          role: 'user',
          content: 'watch live timeout',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const liveRequest = deferred<FlowerLiveEventsResponse>();
    const timeouts: unknown[] = [];
    const onTimeout = (event: Event) => {
      timeouts.push((event as CustomEvent).detail);
    };
    window.addEventListener('redeven:flower-live-events-timeout', onTimeout);
    try {
      const runtime = renderSurfaceWithAdapter({
        ...adapter(true),
        listThreads: vi.fn(async () => [runningThread]),
        loadThread: vi.fn(async () => liveBootstrap(runningThread, 7)),
        listThreadLiveEvents: vi.fn(() => liveRequest.promise),
      });

      await vi.waitFor(() => {
        expect(runtime.querySelector('[data-thread-id="thread-live-timeout-debug"] button')).toBeTruthy();
      });
      (runtime.querySelector('[data-thread-id="thread-live-timeout-debug"] button') as HTMLButtonElement).click();
      await vi.waitFor(() => {
        expect(runtime.querySelector('.flower-model-status-indicator')).toBeTruthy();
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.waitFor(() => {
        expect(timeouts).toHaveLength(1);
      });

      expect(timeouts[0]).toMatchObject({
        thread_id: 'thread-live-timeout-debug',
        cursor: 0,
        stream_generation: 1,
      });
    } finally {
      window.removeEventListener('redeven:flower-live-events-timeout', onTimeout);
    }
  });

  it('keeps a new pending compact divider when the selected thread already has historical compactions', async () => {
    const historicalCompactionThread = thread({
      thread_id: 'thread-compact-pending-history',
      title: 'Compact pending history',
      status: 'success',
      messages: [
        {
          id: 'm-compact-history-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-compact-history-assistant',
          role: 'assistant',
          content: 'done',
          status: 'complete',
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'done' }],
        },
      ],
      context_compactions: [{
        operation_id: 'compact-history-old',
        phase: 'complete',
        status: 'compacted',
        trigger: 'manual',
        reason: 'manual',
        updated_at_ms: 1,
      }],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-history-old',
        kind: 'context_compaction',
        ordinal: 1,
        anchor: {
          target_kind: 'message',
          message_id: 'm-compact-history-assistant',
          edge: 'after',
        },
        compaction: {
          operation_id: 'compact-history-old',
          phase: 'complete',
          status: 'compacted',
          trigger: 'manual',
          reason: 'manual',
          updated_at_ms: 1,
        },
      }],
    });
    const compactDeferred = deferred<FlowerLiveBootstrap>();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [historicalCompactionThread]),
      loadThread: vi.fn(async () => liveBootstrap(historicalCompactionThread)),
      compactThreadContext: vi.fn(() => compactDeferred.promise),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-pending-history"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-pending-history"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-compact-pending-history'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Compact context' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => runtime.querySelectorAll('.flower-compaction-divider').length === 2);
    expect(runtime.querySelector('.flower-compaction-divider[data-flower-compaction-status="compacted"]')).toBeTruthy();
    expect(runtime.querySelector('.flower-compaction-divider[data-flower-compaction-status="compacting"]')).toBeTruthy();
  });

  it('replaces a local compact divider when slash compact returns an already-running idle compaction', async () => {
    const alreadyCompactingThread = thread({
      thread_id: 'thread-compact-already-running',
      title: 'Compact already running',
      status: 'success',
      messages: [
        {
          id: 'm-compact-already-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-compact-already-assistant',
          role: 'assistant',
          content: 'done',
          status: 'complete',
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'done' }],
        },
      ],
      context_compactions: [{
        operation_id: 'compact-already-running',
        phase: 'start',
        status: 'compacting',
        trigger: 'manual',
        reason: 'manual',
        updated_at_ms: 30,
      }],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-already-running',
        kind: 'context_compaction',
        ordinal: 1,
        anchor: {
          target_kind: 'message',
          message_id: 'm-compact-already-assistant',
          edge: 'after',
        },
        compaction: {
          operation_id: 'compact-already-running',
          phase: 'start',
          status: 'compacting',
          trigger: 'manual',
          reason: 'manual',
          updated_at_ms: 30,
        },
      }],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [alreadyCompactingThread]),
      loadThread: vi.fn(async () => liveBootstrap(alreadyCompactingThread)),
      compactThreadContext: vi.fn(async () => liveBootstrap(alreadyCompactingThread, 2)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-already-running"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-already-running"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-compact-already-running'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Compact context' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => runtime.querySelectorAll('.flower-compaction-divider[data-flower-compaction-status="compacting"]').length === 1);
    expect(runtime.querySelector('[data-flower-decoration-id="context-compaction:compact-already-running"]')).toBeTruthy();
  });

  it('allows a normal send while an idle compact request is still pending', async () => {
    const compactingThread = thread({
      thread_id: 'thread-idle-compact-pending-send',
      title: 'Idle compact pending send',
      status: 'success',
      messages: [
        {
          id: 'm-idle-compact-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-idle-compact-assistant',
          role: 'assistant',
          content: 'done',
          status: 'complete',
          created_at_ms: 20,
        },
      ],
    });
    const compactDeferred = deferred<FlowerLiveBootstrap>();
    const compactThreadContext = vi.fn(() => compactDeferred.promise);
    let acceptedQueueID = '';
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => {
      acceptedQueueID = 'queue-idle-compact';
      return launchReceiptFor(input, compactingThread.thread_id, acceptedQueueID, 'queued');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [compactingThread]),
      loadThread: vi.fn(async () => liveBootstrap(acceptedQueueID ? thread({
        ...compactingThread,
        queued_turn_count: 1,
        queued_turns: [{
          queue_id: acceptedQueueID,
          prompt: 'continue after compact starts',
          created_at_ms: 30,
        }],
      }) : compactingThread)),
      compactThreadContext,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-idle-compact-pending-send"] button')));
    (runtime.querySelector('[data-thread-id="thread-idle-compact-pending-send"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-idle-compact-pending-send'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Compact context' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => compactThreadContext.mock.calls.length === 1);
    await waitFor(() => (runtime.querySelector('textarea') as HTMLTextAreaElement).value === '');

    textarea.value = 'continue after compact starts';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-idle-compact-pending-send',
      prompt: 'continue after compact starts',
    }));
    await waitFor(() => runtime.querySelector(`[data-flower-queued-turn-id="${acceptedQueueID}"]`)?.textContent?.includes('continue after compact starts') ?? false);
    expect(runtime.querySelector(`[data-flower-queued-turn-id="${acceptedQueueID}"]`)?.getAttribute('data-flower-queued-turn-state')).toBe('queued');
    expect(runtime.querySelector('[data-flower-message-id="m-idle-compact-user"]')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-id="continue after compact starts"]')).toBeNull();
    expect(compactThreadContext).toHaveBeenCalledTimes(1);
  });

  it('renders multiple server-owned queued sends with duplicate prompts as distinct turns', async () => {
    const compactingThread = thread({
      thread_id: 'thread-idle-compact-multi-pending',
      title: 'Idle compact multi pending',
      status: 'success',
      messages: [
        {
          id: 'm-idle-compact-multi-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-idle-compact-multi-assistant',
          role: 'assistant',
          content: 'done',
          status: 'complete',
          created_at_ms: 20,
        },
      ],
    });
    const pendingQueueIDs: string[] = [];
    const launchTurn = vi
      .fn(async (input: FlowerTurnLaunchInput) => {
        const queueID = `queue-${pendingQueueIDs.length + 1}`;
        pendingQueueIDs.push(queueID);
        return launchReceiptFor(input, compactingThread.thread_id, queueID, 'queued');
      });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [compactingThread]),
      loadThread: vi.fn(async () => liveBootstrap(pendingQueueIDs.length > 0 ? thread({
        ...compactingThread,
        queued_turn_count: pendingQueueIDs.length,
        queued_turns: pendingQueueIDs.map((queueID, index) => ({
          queue_id: queueID,
          prompt: 'repeat queued follow-up',
          created_at_ms: 50_000 + index,
        })),
      }) : compactingThread)),
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-idle-compact-multi-pending"] button')));
    (runtime.querySelector('[data-thread-id="thread-idle-compact-multi-pending"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-idle-compact-multi-pending'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(50_000);
    try {
      const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
      for (const prompt of ['repeat queued follow-up', 'repeat queued follow-up']) {
        textarea.value = prompt;
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
        await waitFor(() => {
          const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
          return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
        });
        (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
        await waitFor(() => (runtime.querySelector('textarea') as HTMLTextAreaElement).value === '');
      }
    } finally {
      nowSpy.mockRestore();
    }

    await waitFor(() => launchTurn.mock.calls.length === 2);
    await waitFor(() => runtime.querySelectorAll('[data-flower-queued-turn-id]').length === 2);
    const queuedText = Array.from(runtime.querySelectorAll('[data-flower-queued-turn-id]')).map((node) => node.textContent ?? '').join('\n');
    expect((queuedText.match(/repeat queued follow-up/g) ?? []).length).toBe(2);
    expect(pendingQueueIDs).toEqual(['queue-1', 'queue-2']);
  });

  it('compacts a waiting-approval selected thread with the active run guard', async () => {
    const waitingApprovalThread = thread({
      thread_id: 'thread-waiting-approval-compact',
      title: 'Waiting approval compact',
      status: 'waiting_approval',
      active_run_id: 'run-waiting-approval-compact',
      model_io_status: null,
      messages: [
        {
          id: 'm-approval-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-approval-assistant',
          role: 'assistant',
          content: 'I need to run a command.',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'I need to run a command.' }],
        },
      ],
    });
    const compactThreadContext = vi.fn(async () => liveBootstrap(waitingApprovalThread, 3));
    const stopThread = vi.fn(async () => liveBootstrap({ ...waitingApprovalThread, status: 'canceled' }));
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, waitingApprovalThread.thread_id, 'turn-waiting-approval'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingApprovalThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingApprovalThread)),
      compactThreadContext,
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-waiting-approval-compact"] button')));
    (runtime.querySelector('[data-thread-id="thread-waiting-approval-compact"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-waiting-approval-compact'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => compactThreadContext.mock.calls.length === 1);

    expect(compactThreadContext).toHaveBeenCalledWith({
      thread_id: 'thread-waiting-approval-compact',
      active_run_id: 'run-waiting-approval-compact',
    });
    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).not.toHaveBeenCalled();
  });

  it('disables composer commands when the selected thread status is read-only', async () => {
    const readOnlyThread = thread({
      thread_id: 'thread-read-only-status',
      title: 'Read-only status',
      status: 'read_only',
      messages: [
        {
          id: 'm-read-only',
          role: 'assistant',
          content: 'This thread is archived.',
          status: 'complete',
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'This thread is archived.' }],
        },
      ],
    });
    const compactThreadContext = vi.fn(async () => liveBootstrap(readOnlyThread));
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, readOnlyThread.thread_id, 'turn-read-only'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [readOnlyThread]),
      loadThread: vi.fn(async () => liveBootstrap(readOnlyThread)),
      compactThreadContext,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-read-only-status"] button')));
    (runtime.querySelector('[data-thread-id="thread-read-only-status"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-read-only-status'));
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-readonly-chip')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    expect(textarea.getAttribute('placeholder')).toContain('Read only');
    const submitButton = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    submitButton.click();
    await waitFor(() => true, 20);
    expect(compactThreadContext).not.toHaveBeenCalled();
    expect(launchTurn).not.toHaveBeenCalled();
  });

  it('uses Enter to send a draft on a running selected thread without stopping it', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-enter-send',
      title: 'Running Enter send',
      status: 'running',
    });
    const stopThread = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }));
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, runningThread.thread_id, 'turn-running-send'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-enter-send"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-enter-send"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-enter-send'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'send with enter while running';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => launchTurn.mock.calls.length > 0);

    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-running-enter-send',
      prompt: 'send with enter while running',
    }));
  });

  it('keeps old agent activity before the queued user message when Enter sends on a running thread', async () => {
    const oldActivity = activityTimeline({
      thread_id: 'thread-running-enter-send-activity-order',
      run_id: 'run-first',
      turn_id: 'm-first-assistant',
      status: 'running',
      items: [activityItem({
        item_id: 'tool-first-terminal',
        tool_id: 'tool-first-terminal',
        tool_name: 'terminal.exec',
        status: 'running',
        renderer: 'terminal',
        label: 'printf ENTER_A_BEGIN; sleep 30; printf ENTER_A_DONE',
        payload: { command: 'printf ENTER_A_BEGIN; sleep 30; printf ENTER_A_DONE' },
      })],
    });
    const runningThread = thread({
      thread_id: 'thread-running-enter-send-activity-order',
      title: 'Running Enter activity order',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      messages: [
        {
          id: 'm-first-user',
          role: 'user',
          content: 'first request',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-first-assistant',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [oldActivity],
        },
      ],
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(runningThread.messages ?? []),
        {
          id: 'm-second-user',
          role: 'user',
          content: 'second request',
          status: 'complete',
          created_at_ms: 30,
        },
        {
          id: 'm-second-assistant',
          role: 'assistant',
          content: 'ENTER_B_DONE',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 40,
          blocks: [{ type: 'markdown', content: 'ENTER_B_DONE' }],
        },
      ],
    });
    let loadedAfterLaunch = false;
    let admittedTurnID = '';
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(loadedAfterLaunch
        ? withCanonicalUserTurnID(launchedThread, 'm-second-user', admittedTurnID)
        : runningThread)),
      stopThread: vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }, 2)),
      launchTurn: vi.fn(async (input) => {
        loadedAfterLaunch = true;
        admittedTurnID = input.turn_id ?? 'turn-second-request';
        return launchReceipt(launchedThread.thread_id, admittedTurnID);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-enter-send-activity-order"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-enter-send-activity-order"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-enter-send-activity-order'));
    await waitFor(() => runtime.querySelector('[data-flower-message-id="m-first-assistant"]')?.textContent?.includes('printf ENTER_A_BEGIN') ?? false);

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'second request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

	await waitFor(() => runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent?.includes('ENTER_B_DONE') ?? false);
	const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
	expect(ids).toHaveLength(4);
	expect(ids[0]).toBe('m-first-user');
	expect(ids[1]).toBe('m-first-assistant');
	expect(ids[2]).toBe('m-second-user');
	expect(ids[3]).toBe('m-second-assistant');
	const secondUserText = runtime.querySelector(`[data-flower-message-id="${ids[2]}"]`)?.textContent ?? '';
    const secondAssistantText = runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent ?? '';
    expect(secondUserText).toContain('second request');
    expect(secondAssistantText).toContain('ENTER_B_DONE');
    expect(secondAssistantText).not.toContain('ENTER_A_DONE');
    expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });

  it('ignores stale live poll snapshots that return after Enter sends on a running thread', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-enter-send-stale-poll',
      title: 'Running stale poll',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      messages: [
        {
          id: 'm-first-user',
          role: 'user',
          content: 'first request',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-first-assistant',
          role: 'assistant',
          content: 'partial',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'partial' }],
        },
      ],
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(runningThread.messages ?? []),
        {
          id: 'm-second-user',
          role: 'user',
          content: 'second request',
          status: 'complete',
          created_at_ms: 30,
        },
        {
          id: 'm-second-assistant',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 40,
          blocks: [{ type: 'markdown', content: '' }],
        },
      ],
    });
    const stalePoll = deferred<FlowerLiveEventsResponse>();
    let loadedAfterLaunch = false;
    let admittedTurnID = '';
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(loadedAfterLaunch
        ? withCanonicalUserTurnID(launchedThread, 'm-second-user', admittedTurnID)
        : runningThread, loadedAfterLaunch ? 3 : 1)),
      listThreadLiveEvents: vi.fn(() => stalePoll.promise),
      stopThread: vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }, 2)),
      launchTurn: vi.fn(async (input) => {
        loadedAfterLaunch = true;
        admittedTurnID = input.turn_id ?? 'turn-second-request';
        return launchReceipt(launchedThread.thread_id, admittedTurnID);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-enter-send-stale-poll"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-enter-send-stale-poll"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-enter-send-stale-poll'));
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'second request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));
    stalePoll.resolve({
      events: [{
        schema_version: 1,
        seq: 2,
        endpoint_id: 'test-runtime',
        thread_id: 'thread-running-enter-send-stale-poll',
        run_id: 'run-first',
        at_unix_ms: 50,
        kind: 'timeline.replaced',
        payload: { messages: runningThread.messages, stream_generation: 1, snapshot_through_seq: 2 },
      }],
      stream_generation: 1,
      next_cursor: 2,
      retained_from_seq: 1,
      has_more: false,
    });
    await waitFor(() => {
      const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
      return ids.includes('m-second-assistant');
    });

	const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
	expect(ids).toHaveLength(4);
	expect(ids[0]).toBe('m-first-user');
	expect(ids[1]).toBe('m-first-assistant');
	expect(ids[2]).toBe('m-second-user');
	expect(ids[3]).toBe('m-second-assistant');
	expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });

  it('keeps a repeated queued prompt distinct from canonical history by exact TurnID', async () => {
    const existingThread = thread({
      thread_id: 'thread-repeat-pending',
      title: 'Repeat pending',
      status: 'idle',
      messages: [
        {
          id: 'm-old-continue',
          role: 'user',
          content: 'continue',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    let acceptedQueueID = '';
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [existingThread]),
      loadThread: vi.fn(async () => liveBootstrap(acceptedQueueID ? thread({
        ...existingThread,
        queued_turn_count: 1,
        queued_turns: [{ queue_id: acceptedQueueID, prompt: 'continue', created_at_ms: 20 }],
      }) : existingThread)),
      launchTurn: vi.fn(async (input: FlowerTurnLaunchInput) => {
        acceptedQueueID = 'queue-repeat';
        return launchReceiptFor(input, existingThread.thread_id, acceptedQueueID, 'queued');
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-repeat-pending"] button')));
    (runtime.querySelector('[data-thread-id="thread-repeat-pending"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-repeat-pending'));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'continue';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector(`[data-flower-queued-turn-id="${acceptedQueueID}"]`)));

    const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
    expect(ids).toEqual(['m-old-continue']);
    expect(runtime.querySelector(`[data-flower-queued-turn-id="${acceptedQueueID}"]`)?.textContent).toContain('continue');
  });

  it('renders the canonical user row before assistant streaming', async () => {
    const selected = thread({
      thread_id: 'thread-pending-before-assistant',
      title: 'Pending before assistant',
      status: 'idle',
      messages: [],
    });
    let pollCount = 0;
    let acceptedTurnID = '';
    let admitted = false;
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [selected]),
      loadThread: vi.fn(async () => liveBootstrap(admitted ? thread({
        ...selected,
        status: 'running',
        messages: [{
          id: 'entry-user-before-assistant',
          turn_id: acceptedTurnID,
          role: 'user',
          content: 'start work',
          status: 'complete',
          created_at_ms: 1000,
        }],
        model_io_status: modelIOStatus({ run_id: 'run-pending-before-assistant' }),
      }) : selected)),
      launchTurn: vi.fn(async (input) => {
        acceptedTurnID = input.turn_id ?? 'turn-pending-before-assistant';
        admitted = true;
        return launchReceipt(selected.thread_id, acceptedTurnID);
      }),
      listThreadLiveEvents: vi.fn(async () => {
        pollCount += 1;
        if (pollCount === 1) {
          return {
            stream_generation: 1,
            next_cursor: 1,
            retained_from_seq: 1,
            has_more: false,
            events: [],
          } satisfies FlowerLiveEventsResponse;
        }
        return {
          stream_generation: 1,
          next_cursor: 4,
          retained_from_seq: 1,
          has_more: false,
          events: pollCount === 2
            ? [
                {
                  schema_version: 1,
                  seq: 2,
                  endpoint_id: 'test-runtime',
                  thread_id: 'thread-pending-before-assistant',
                  run_id: 'run-pending-before-assistant',
                  turn_id: acceptedTurnID,
                  at_unix_ms: 2000,
                  kind: 'message.started',
                  payload: {
                    message_id: 'm-assistant-first',
                    role: 'assistant',
                    status: 'streaming',
                    created_at_ms: 2000,
                  },
                },
                {
                  schema_version: 1,
                  seq: 3,
                  endpoint_id: 'test-runtime',
                  thread_id: 'thread-pending-before-assistant',
                  run_id: 'run-pending-before-assistant',
                  turn_id: acceptedTurnID,
                  at_unix_ms: 2001,
                  kind: 'message.block_started',
                  payload: {
                    message_id: 'm-assistant-first',
                    block_index: 0,
                    block_type: 'markdown',
                  },
                },
                {
                  schema_version: 1,
                  seq: 4,
                  endpoint_id: 'test-runtime',
                  thread_id: 'thread-pending-before-assistant',
                  run_id: 'run-pending-before-assistant',
                  turn_id: acceptedTurnID,
                  at_unix_ms: 2002,
                  kind: 'message.block_delta',
                  payload: {
                    message_id: 'm-assistant-first',
                    block_index: 0,
                    delta: 'working',
                  },
                },
              ]
            : [],
        } satisfies FlowerLiveEventsResponse;
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-pending-before-assistant"] button')));
    (runtime.querySelector('[data-thread-id="thread-pending-before-assistant"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-pending-before-assistant'));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'start work';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="m-assistant-first"]')));

    const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
    const userIndex = ids.indexOf('entry-user-before-assistant');
    const assistantIndex = ids.indexOf('m-assistant-first');
    expect(userIndex).toBeGreaterThanOrEqual(0);
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(userIndex).toBeLessThan(assistantIndex);
  });

  it('ignores stale bootstrap reloads that return after sending on a running thread', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-send-stale-bootstrap',
      title: 'Running stale bootstrap',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      messages: [
        {
          id: 'm-first-user',
          turn_id: 'turn-first-request',
          role: 'user',
          content: 'first request',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-first-assistant',
          turn_id: 'turn-first-request',
          role: 'assistant',
          content: 'partial old answer',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'partial old answer' }],
        },
      ],
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(runningThread.messages ?? []),
        {
          id: 'm-second-user',
          turn_id: 'turn-second-request',
          role: 'user',
          content: 'second request',
          status: 'complete',
          created_at_ms: 30,
        },
        {
          id: 'm-second-assistant',
          turn_id: 'turn-second-request',
          role: 'assistant',
          content: 'new answer',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 40,
          blocks: [{ type: 'markdown', content: 'new answer' }],
        },
      ],
    });
    const staleLoad = deferred<FlowerLiveBootstrap>();
    let loadCalls = 0;
    let admittedTurnID = '';
    let canonicalThread = launchedThread;
    let canonicalSummaryReady = false;
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [{
        ...runningThread,
        updated_at_ms: canonicalSummaryReady ? 3 : runningThread.updated_at_ms,
      }]),
      loadThread: vi.fn(async () => {
        loadCalls += 1;
        if (loadCalls === 1) {
          return liveBootstrap(runningThread, 1);
        }
        if (loadCalls === 2) {
          return staleLoad.promise;
        }
        return liveBootstrap(canonicalThread, 3);
      }),
      stopThread: vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }, 2)),
      launchTurn: vi.fn(async (input) => {
        admittedTurnID = input.turn_id ?? 'turn-second-request';
        return launchReceipt(launchedThread.thread_id, admittedTurnID);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-send-stale-bootstrap"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-send-stale-bootstrap"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-send-stale-bootstrap'));
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'second request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => loadCalls === 2 && admittedTurnID !== '');
    canonicalThread = {
      ...withCanonicalUserTurnID(launchedThread, 'm-second-user', admittedTurnID),
      messages: launchedThread.messages.map((message) => (
        message.id === 'm-second-user' || message.id === 'm-second-assistant'
          ? { ...message, turn_id: admittedTurnID }
          : message
      )),
    };
    canonicalSummaryReady = true;
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => loadCalls >= 3);
    await waitFor(() => runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent?.includes('new answer') ?? false);
    staleLoad.resolve(liveBootstrap(runningThread, 2));
    await waitFor(() => {
      const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
      return ids.length === 4;
    });

	const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
	expect(ids).toHaveLength(4);
	expect(ids[0]).toBe('m-first-user');
	expect(ids[1]).toBe('m-first-assistant');
	expect(ids[2]).toBe('m-second-user');
	expect(ids[3]).toBe('m-second-assistant');
	expect(runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent).toContain('new answer');
	expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });

  it('renders the context meter before submit and opens its tooltip on focus', async () => {
    const idleThread = thread({
      thread_id: 'thread-context-meter',
      title: 'Context meter',
      status: 'idle',
      context_usage: {
        run_id: '',
        phase: 'provider_usage',
        input_tokens: 42500,
        context_window_tokens: 100000,
        threshold_tokens: 80000,
        used_ratio: 0.425,
        threshold_ratio: 0.8,
        pressure_status: 'stable',
        updated_at_ms: 42,
      },
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [idleThread]),
      loadThread: vi.fn(async () => liveBootstrap(idleThread, 1)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-context-meter"] button')));
    (runtime.querySelector('[data-thread-id="thread-context-meter"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-context-meter'));
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-submit')));

    const actions = runtime.querySelector('.flower-composer-actions') as HTMLElement;
    const indicator = actions.querySelector('.flower-composer-context-indicator') as HTMLElement | null;
    const progress = actions.querySelector('.flower-composer-context-progress') as HTMLElement | null;
    const submit = actions.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
    const tooltip = actions.querySelector('.flower-composer-context-tooltip') as HTMLElement | null;
    expect(indicator).toBeTruthy();
    expect(progress?.getAttribute('role')).toBe('progressbar');
    expect(progress?.getAttribute('aria-valuenow')).toBe('43');
    expect(submit).toBeTruthy();
    expect(indicator!.compareDocumentPosition(submit!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tooltip?.getAttribute('aria-hidden')).toBe('true');

    progress!.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    await waitFor(() => tooltip?.getAttribute('data-open') === 'true');
    expect(progress?.getAttribute('aria-describedby')).toBe(tooltip?.id);
    progress!.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    await waitFor(() => tooltip?.getAttribute('aria-hidden') === 'true');
  });

  it('keeps the composer draft when running send fails', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-stop-fails',
      title: 'Running send fails',
      status: 'running',
    });
    const stopThread = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }));
    const launchTurn = vi.fn(async () => {
      throw new Error('Send failed.');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-stop-fails"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-stop-fails"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-stop-fails'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'do not lose this draft';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => flowerSurfaceNotifications().some((notice) => notice.message.includes('Send failed.')));

    expect(flowerSurfaceNotifications()).toContainEqual(expect.objectContaining({
      tone: 'error',
      title: 'Flower could not send.',
      message: 'Send failed.',
    }));
    expect(runtime.querySelector('.flower-composer-error')).toBeNull();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('do not lose this draft');
    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).toHaveBeenCalledTimes(1);
  });

  it('keeps the composer draft when running send fails without stopping first', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-send-fails',
      title: 'Running send fails',
      status: 'running',
    });
    const stopThread = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }));
    const launchTurn = vi.fn(async () => {
      throw new Error('Send failed.');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-send-fails"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-send-fails"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-send-fails'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'keep this draft after send fails';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => flowerSurfaceNotifications().some((notice) => notice.message.includes('Send failed.')));

    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).toHaveBeenCalledTimes(1);
    expect(flowerSurfaceNotifications()).toContainEqual(expect.objectContaining({
      tone: 'error',
      title: 'Flower could not send.',
      message: 'Send failed.',
    }));
    expect(runtime.querySelector('.flower-composer-error')).toBeNull();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('keep this draft after send fails');
  });

  it('presents provider stream interruptions without blaming Flower orchestration', async () => {
    const interruptedThread = thread({
      thread_id: 'thread-provider-stream-interrupted',
      title: 'Provider stream interruption',
      status: 'failed',
      error: {
        code: 'provider_stream_interrupted',
        message: 'unexpected EOF',
      },
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [interruptedThread]),
      loadThread: vi.fn(async () => liveBootstrap(interruptedThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-provider-stream-interrupted"] button')));
    (runtime.querySelector('[data-thread-id="thread-provider-stream-interrupted"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-error-card').length > 0);

    const cardText = runtime.querySelector('.flower-error-card')?.textContent ?? '';
    expect(cardText).toContain('The selected AI provider ended the response stream unexpectedly.');
    expect(cardText).not.toContain('orchestration engine');
    expect(runtime.querySelector('.flower-error-actions button')?.textContent).toContain('Open settings');
  });

  it('continues a failed thread and shows closed subagents as terminal', async () => {
    const failedThread = thread({
      thread_id: 'thread-failed-continue',
      title: 'Failed continue',
      status: 'failed',
      messages: [
        {
          id: 'm-failed-parent',
          role: 'assistant',
          content: '',
          status: 'error',
          created_at_ms: 20,
          blocks: [
            activityTimeline({
              thread_id: 'thread-failed-continue',
              run_id: 'run-failed-parent',
              turn_id: 'm-failed-parent',
              status: 'error',
              severity: 'error',
              items: [activityItem({
                item_id: 'tool-subagents-stale-running',
                tool_id: 'tool-subagents-stale-running',
                tool_name: 'subagents',
                renderer: 'structured',
                label: 'subagents',
                status: 'running',
                payload: {
                  action: 'spawn',
                  items: [{
                    thread_id: 'thread-child-closed',
                    task_name: 'Review failed parent',
                    status: 'running',
                  }],
                },
              })],
            }),
          ],
        },
      ],
      subagents: [subagentSummary({
        parent_thread_id: 'thread-failed-continue',
        thread_id: 'thread-child-closed',
        task_name: 'Review failed parent',
        status: 'closed',
        can_close: false,
        can_interrupt: false,
        updated_at_ms: 240,
      })],
    });
    const continuedThread = {
      ...failedThread,
      status: 'running' as const,
      messages: [
        ...failedThread.messages,
        {
          id: 'm-failed-continue-user',
          role: 'user' as const,
          content: 'continue from failed parent',
          status: 'sending' as const,
          created_at_ms: 260,
        },
      ],
    };
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, continuedThread.thread_id, 'turn-continued'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [failedThread]),
      loadThread: vi.fn(async () => liveBootstrap(failedThread)),
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-failed-continue"] button')));
    (runtime.querySelector('[data-thread-id="thread-failed-continue"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-failed-continue'));

    const subagentsButton = runtime.querySelector('.flower-chat-header-actions button[title^="Open subagents"]') as HTMLButtonElement;
    subagentsButton.click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-subagent-dropdown-row')));
    expect(runtime.querySelector('.flower-subagent-dropdown-row')?.getAttribute('data-flower-subagent-status')).toBe('canceled');

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    textarea.value = 'continue from failed parent';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-failed-continue',
      prompt: 'continue from failed parent',
    }));
    expect(runtime.querySelector('.flower-composer-error')).toBeNull();
  });

  it('keeps waiting_user threads on Continue instead of stop or send', async () => {
    const waitingThread = thread({
      thread_id: 'thread-waiting-user-continue',
      title: 'Waiting user continue',
      status: 'waiting_user',
      input_request: inputRequest({
        questions: [{
          id: 'details',
          header: 'Details',
          question: 'What should Flower do next?',
          response_mode: 'write',
        }],
      }),
    });
    const stopThread = vi.fn(async () => liveBootstrap(waitingThread));
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, waitingThread.thread_id, 'turn-waiting'));
    const submitInput = vi.fn(async () => inputAdmissionReceipt(waitingThread.thread_id, waitingThread.input_request!.prompt_id));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread)),
      stopThread,
      launchTurn,
      submitInput,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-waiting-user-continue"] button')));
    (runtime.querySelector('[data-thread-id="thread-waiting-user-continue"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-waiting-user-continue'));
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-request-prompt]')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'answer the waiting prompt';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-continue') as HTMLButtonElement | null;
      return Boolean(button && button.textContent?.includes('Continue') && !button.disabled);
    });
    expect(runtime.querySelector('.flower-composer-submit')).toBeNull();
    (runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).click();
    await waitFor(() => submitInput.mock.calls.length > 0);

    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).not.toHaveBeenCalled();
    expect(submitInput).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-waiting-user-continue',
      answers: {
        details: { text: 'answer the waiting prompt' },
      },
    }));
  });

  it('loads the canonical thread after sending so completed assistant replies appear', async () => {
    const sentThread = thread({
      thread_id: 'thread-new',
      title: 'Flower verification',
      status: 'running',
      messages: [
        {
          id: 'm-user',
          role: 'user',
          content: 'verify Flower',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const completeThread = thread({
      thread_id: 'thread-new',
      title: 'Flower verification',
      status: 'success',
      messages: [
        {
          id: 'm-user',
          role: 'user',
          content: 'verify Flower',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-assistant',
          role: 'assistant',
          content: 'Flower verification is complete.',
          status: 'complete',
          created_at_ms: 20,
        },
      ],
    });
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceiptFor(input, sentThread.thread_id, 'turn-sent'));
    const loadThread = vi.fn(async () => liveBootstrap(completeThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'verify Flower';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    });
    const send = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;
    send.click();
    await waitFor(() => launchTurn.mock.calls.length > 0);
    await waitFor(() => loadThread.mock.calls.length > 0);
    await waitFor(() => runtime.textContent?.includes('Flower verification is complete.') ?? false);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: undefined,
      prompt: 'verify Flower',
    }));
    expect(loadThread).toHaveBeenCalledWith('thread-new');
    expect(runtime.textContent).toContain('Flower verification is complete.');
  });

  it('retains the composer draft without synthesizing a row while admission is pending', async () => {
    const sendDeferred = deferred<FlowerTurnLaunchReceipt>();
    let launchTurnID = 'turn-user-canonical';
    let launchedInput: FlowerTurnLaunchInput | null = null;
    const launchTurn = vi.fn((input: FlowerTurnLaunchInput) => {
      launchedInput = input;
      return sendDeferred.promise;
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread: vi.fn(async (threadID: string) => {
        if (threadID === 'thread-canonical-send') {
          return liveBootstrap(thread({
            thread_id: 'thread-canonical-send',
            title: 'Canonical send',
            status: 'running',
            model_io_status: modelIOStatus({ run_id: 'run-1' }),
            messages: [{
              id: 'entry-user-canonical',
              turn_id: launchTurnID,
              role: 'user',
              content: 'inspect the running turn',
              status: 'complete',
              created_at_ms: 10,
            }, {
              id: 'm-assistant-canonical',
              turn_id: launchTurnID,
              role: 'assistant',
              content: '',
              status: 'streaming',
              active_cursor: true,
              created_at_ms: 20,
            }],
          }));
        }
        throw new Error(`unexpected loadThread: ${threadID}`);
      }),
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'inspect the running turn';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length > 0);

    expect(runtime.querySelector('[data-flower-message-id]')).toBeNull();
    expect(runtime.querySelector('[data-flower-message-id="entry-user-canonical"]')).toBeNull();
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('inspect the running turn');
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    expect(runtime.querySelector('.flower-composer')?.getAttribute('aria-busy')).toBe('true');

    if (!launchedInput) throw new Error('missing launch input');
    sendDeferred.resolve(launchReceiptFor(launchedInput, 'thread-canonical-send', launchTurnID));
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="entry-user-canonical"]')));
    expect(runtime.textContent).toContain('inspect the running turn');
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeTruthy();
  });

  it('removes a queued product row when the server timeline replacement clears the queue', async () => {
    const initialThread = thread({
      thread_id: 'thread-live-canonical-send',
      title: 'Live canonical send',
      status: 'idle',
      messages: [],
    });
    const replacement = deferred<FlowerLiveEventsResponse>();
    let loadedAfterLaunch = false;
    let acceptedQueueID = '';
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [initialThread]),
      loadThread: vi.fn(async () => liveBootstrap(loadedAfterLaunch ? {
        ...initialThread,
        status: 'running',
        model_io_status: modelIOStatus({ run_id: 'run-live-canonical-send' }),
        queued_turn_count: 1,
        queued_turns: [{
          queue_id: acceptedQueueID,
          prompt: 'replace this queued row',
          created_at_ms: 10,
        }],
      } : initialThread, 1)),
      listThreadLiveEvents: vi.fn(() => replacement.promise),
      launchTurn: vi.fn(async (input: FlowerTurnLaunchInput) => {
        loadedAfterLaunch = true;
        acceptedQueueID = 'queue-live-canonical-send';
        return launchReceiptFor(input, initialThread.thread_id, acceptedQueueID, 'queued');
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-live-canonical-send"] button')));
    (runtime.querySelector('[data-thread-id="thread-live-canonical-send"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, initialThread.thread_id));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'replace this queued row';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => acceptedQueueID !== '' && Boolean(runtime.querySelector(`[data-flower-queued-turn-id="${acceptedQueueID}"]`)));

    replacement.resolve({
      events: [{
        schema_version: 1,
        seq: 2,
        endpoint_id: 'test-runtime',
        thread_id: initialThread.thread_id,
        run_id: 'run-live-canonical-send',
        at_unix_ms: 20,
        kind: 'timeline.replaced',
        payload: {
          stream_generation: 1,
          snapshot_through_seq: 2,
          messages: [{
            id: 'entry-user-live-canonical',
            turn_id: 'turn-live-canonical-send',
            role: 'user',
            content: 'replace this queued row',
            status: 'complete',
            created_at_ms: 10,
          }, {
            id: 'assistant-live-canonical',
            turn_id: 'turn-live-canonical-send',
            role: 'assistant',
            content: '',
            status: 'streaming',
            active_cursor: true,
            created_at_ms: 20,
          }],
          thread_patch: { run_status: 'running', queued_turn_count: 0 },
        },
      }],
      stream_generation: 1,
      next_cursor: 2,
      retained_from_seq: 1,
      has_more: false,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="entry-user-live-canonical"]')));
    expect(runtime.querySelector(`[data-flower-queued-turn-id="${acceptedQueueID}"]`)).toBeNull();
    expect(runtime.querySelectorAll('[data-flower-message-role="user"]')).toHaveLength(1);
  });

  it('does not synthesize a message when canonical refresh fails after a reliable receipt', async () => {
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => (
      launchReceiptFor(input, 'thread-refresh-failed-after-send', 'turn-refresh-failed')
    ));
    const loadThread = vi.fn(async () => {
      throw new Error('Canonical refresh failed.');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'send exactly once';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => runtime.querySelector('.flower-error-message')?.textContent === 'Canonical refresh failed.');
    expect(launchTurn).toHaveBeenCalledTimes(1);
    expect(loadThread.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(loadThread).toHaveBeenCalledWith('thread-refresh-failed-after-send');
    expect(runtime.querySelector('[data-flower-message-id]')).toBeNull();
    expect(runtime.querySelector('[data-flower-queued-turn-id]')).toBeNull();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
    expect(flowerSurfaceNotifications()).not.toContainEqual(expect.objectContaining({
      title: 'Flower could not send.',
    }));
  });

  it('retains the exact draft and request identity after an uncertain admission', async () => {
    const reloadDeferred = deferred<FlowerLiveBootstrap>();
    let clientRequestID = '';
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => {
      clientRequestID = input.client_request_id;
      throw flowerTurnAdmissionUncertainFailure(
        new Error('Admission response was lost.'),
        clientRequestID,
        { thread_id: 'thread-admission-uncertain' },
      );
    });
    const loadThread = vi.fn(() => reloadDeferred.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'reconcile this exact turn';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => launchTurn.mock.calls.length === 1 && loadThread.mock.calls.length >= 1);
    expect(clientRequestID).toMatch(/^client_/);
    expect(runtime.querySelector('[data-flower-message-id]')).toBeNull();
    expect(runtime.querySelector('[data-flower-queued-turn-id]')).toBeNull();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('reconcile this exact turn');
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    expect(flowerSurfaceNotifications()).not.toContainEqual(expect.objectContaining({
      title: 'Flower could not send.',
    }));

    const canonicalThread = thread({
      thread_id: 'thread-admission-uncertain',
      title: 'Admission uncertain',
      status: 'running',
      messages: [{
        id: 'entry-user-after-uncertain-receipt',
        turn_id: 'turn-admission-uncertain',
        role: 'user',
        content: 'reconcile this exact turn',
        status: 'complete',
        created_at_ms: 10,
      }],
    });
    reloadDeferred.resolve(liveBootstrap(canonicalThread, 1));

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="entry-user-after-uncertain-receipt"]')));
    expect(launchTurn).toHaveBeenCalledTimes(1);
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('reconcile this exact turn');
    expect(runtime.querySelectorAll('[data-flower-message-role="user"]')).toHaveLength(1);

    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 2);
    expect(launchTurn.mock.calls[1]?.[0].client_request_id).toBe(clientRequestID);
  });

  it('shows the accepted run preparing status after the post-receipt refresh', async () => {
    const acceptedThread = thread({
      thread_id: 'thread-accepted-preparing',
      title: 'Accepted preparing',
      status: 'running',
      model_io_status: modelIOStatus({
        phase: 'preparing',
        run_id: 'run-accepted-preparing',
      }),
      messages: [{
        id: 'm-accepted-user',
        turn_id: 'turn-accepted',
        role: 'user',
        content: 'start the model request',
        status: 'complete',
        created_at_ms: 10,
      }, {
        id: 'm-accepted-assistant',
        turn_id: 'turn-accepted',
        role: 'assistant',
        content: '',
        status: 'streaming',
        active_cursor: true,
        created_at_ms: 20,
      }],
    });
    const reloadDeferred = deferred<FlowerLiveBootstrap>();
    let acceptedTurnID = 'turn-accepted';
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => {
      return launchReceiptFor(input, acceptedThread.thread_id, acceptedTurnID);
    });
    const loadThread = vi.fn(() => reloadDeferred.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'start the model request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => launchTurn.mock.calls.length === 1 && loadThread.mock.calls.length >= 1);
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    expect(runtime.querySelector('[data-flower-message-id]')).toBeNull();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
    expect(runtime.querySelector('.flower-composer')?.getAttribute('aria-busy')).toBe('true');
    reloadDeferred.resolve(liveBootstrap({
      ...acceptedThread,
      messages: acceptedThread.messages.map((message) => ({ ...message, turn_id: acceptedTurnID })),
    }, 1));
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: undefined,
      prompt: 'start the model request',
    }));
    expect(loadThread).toHaveBeenCalledWith('thread-accepted-preparing');
    expect(runtime.querySelector('.flower-model-status-text')?.textContent).toBe('Preparing model request...');
    expect(runtime.querySelector('.flower-model-status-text')?.getAttribute('data-text')).toBe('Preparing model request');
    expect(runtime.querySelector('.flower-model-status-indicator')?.getAttribute('data-model-io-phase')).toBe('preparing');
    expect(runtime.querySelector('[data-flower-message-id] .flower-model-status-indicator')).toBeNull();
    expect(runtime.querySelector('.flower-chat-transcript .flower-model-status-indicator')).toBeNull();
  });

  it('does not synthesize timeline rows while the handler is still resolving', async () => {
    const handlerDeferred = deferred<FlowerRouterDecision>();
    const sendDeferred = deferred<FlowerTurnLaunchReceipt>();
    let routeTurnID = '';
    const launchTurn = vi.fn((input) => {
      routeTurnID = input.turn_id ?? 'turn-route-settled';
      return sendDeferred.promise;
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread: vi.fn(async (threadID: string) => {
        if (threadID === 'thread-route-settled') {
          return liveBootstrap(thread({
            thread_id: 'thread-route-settled',
            title: 'Route settled',
            status: 'running',
            messages: [{
              id: 'm-route-settled-user',
              turn_id: routeTurnID,
              role: 'user',
              content: 'show before route settles',
              status: 'complete',
              created_at_ms: 10,
            }],
          }));
        }
        throw new Error(`unexpected loadThread: ${threadID}`);
      }),
      resolveHandler: vi.fn(() => handlerDeferred.promise),
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'show before route settles';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.querySelector('[data-flower-message-id]')).toBeNull();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('show before route settles');
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    expect(runtime.querySelector('.flower-composer')?.getAttribute('aria-busy')).toBe('true');
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    expect(launchTurn).not.toHaveBeenCalled();

    handlerDeferred.resolve(decision());
    await waitFor(() => launchTurn.mock.calls.length > 0);
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'show before route settles',
    }));
    sendDeferred.resolve(launchReceipt('thread-route-settled', routeTurnID));
    await waitFor(() => runtime.textContent?.includes('show before route settles') ?? false);
  });

  it('renders running queued send messages in canonical timeline order', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-send-order',
      title: 'Running send order',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      messages: [{
        id: 'm-first-user',
        turn_id: 'turn-first-request',
        role: 'user',
        content: 'first request',
        status: 'complete',
        created_at_ms: 10,
      }, {
        id: 'm-first-assistant',
        turn_id: 'turn-first-request',
        role: 'assistant',
        content: 'partial old answer',
        status: 'streaming',
        active_cursor: true,
        created_at_ms: 20,
      }],
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(runningThread.messages ?? []),
        {
          id: 'm-second-user',
          turn_id: 'turn-second-request',
          role: 'user',
          content: 'second request',
          status: 'complete',
          created_at_ms: 30,
        },
        {
          id: 'm-second-assistant',
          turn_id: 'turn-second-request',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 40,
        },
      ],
    });
    let loadedAfterLaunch = false;
    let admittedTurnID = '';
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => {
        if (!loadedAfterLaunch) return liveBootstrap(runningThread);
        const canonical = withCanonicalUserTurnID(launchedThread, 'm-second-user', admittedTurnID);
        return liveBootstrap({
          ...canonical,
          queued_turn_count: 1,
          queued_turns: [{
            queue_id: 'queue-second-request',
            prompt: 'second request',
            created_at_ms: 30,
          }],
          messages: canonical.messages.map((message) => (
            message.id === 'm-second-assistant' ? { ...message, turn_id: admittedTurnID } : message
          )),
        });
      }),
      stopThread: vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' })),
      launchTurn: vi.fn(async (input: FlowerTurnLaunchInput) => {
        loadedAfterLaunch = true;
        admittedTurnID = 'turn-second-request';
        return launchReceiptFor(input, launchedThread.thread_id, 'queue-second-request', 'queued');
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-send-order"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-send-order"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-send-order'));
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'second request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));
    const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe('m-first-user');
    expect(ids[1]).toBe('m-first-assistant');
    expect(ids[2]).toBe('m-second-user');
    expect(ids[3]).toBe('m-second-assistant');
    expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });
});
