import '../index.css';
import './flower-feature.css';
import { beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src';
import type { FlowerAttachmentCapability, FlowerLiveStreamEnvelope, FlowerRuntimeCurrentView, FlowerSurfaceAdapter, FlowerTurnLaunchReceipt } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import { createTransportOutbox } from '../../../../flower_ui/src/transportOutbox';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, deferred, liveBootstrap, renderSurfaceWithDraftCoordinator, thread, waitFor } from './FlowerSurface.navigation.testHarness';

beforeEach(async () => {
  await page.viewport(1280, 900);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('redeven-flower-transport');
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
});

async function setup(options: { generation?: Promise<string> | (() => Promise<string>); newThread?: boolean; idle?: boolean; overrides?: Partial<FlowerSurfaceAdapter> } = {}) {
  const initial = thread({ thread_id: 'delivery-thread', status: options.idle ? 'idle' : 'running', active_run_id: options.idle ? undefined : 'original-run' });
  const other = thread({ thread_id: 'other-thread' });
  let authoritative = liveBootstrap(initial, 1);
  const queued: FlowerLiveStreamEnvelope[] = [{ schema_version: 2, kind: 'ready', summaries: [initial, other] }];
  let wake = () => {};
  const requests: ReturnType<typeof deferred<FlowerTurnLaunchReceipt>>[] = [];
  const launch = vi.fn((_input: Parameters<FlowerSurfaceAdapter['launchTurn']>[0]) => {
    const result = deferred<FlowerTurnLaunchReceipt>(); requests.push(result); return result.promise;
  });
  const drafts = createFlowerComposerDraftCoordinator();
  const runtime = renderSurfaceWithDraftCoordinator({ ...adapter(true), ...options.overrides, launchTurn: launch,
    resolveStorageGeneration: () => typeof options.generation === 'function' ? options.generation() : options.generation ?? Promise.resolve('a'.repeat(32)),
    listThreads: vi.fn(async () => [initial, other]),
    loadThread: vi.fn(async id => id === initial.thread_id ? authoritative : liveBootstrap(other, 1)),
    connectLiveStream: async function* ({ signal }) {
      while (!signal.aborted) {
        const value = queued.shift(); if (value) { yield value; continue; }
        await new Promise<void>(resolve => { wake = resolve; signal.addEventListener('abort', () => resolve(), { once: true }); });
      }
    },
  }, drafts);
  await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${initial.thread_id}"] button`)));
  if (!options.newThread) {
    (runtime.querySelector(`[data-thread-id="${initial.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector(`[data-thread-id="${initial.thread_id}"]`)?.getAttribute('data-flower-thread-active') === 'true');
  }
  const editor = () => runtime.querySelector('.flower-composer textarea') as HTMLTextAreaElement;
  await waitFor(() => Boolean(editor()) && !editor().disabled
    && runtime.querySelector('.flower-thread-navigation-status')?.hasAttribute('hidden') === true);
  const type = (text: string) => { editor().value = text; editor().dispatchEvent(new Event('input', { bubbles: true })); };
  const submit = () => (runtime.querySelector('[data-flower-primary-action="send"]') as HTMLButtonElement).click();
  const emit = (current: FlowerRuntimeCurrentView) => {
    authoritative = { thread: applyFlowerRuntimeCurrentView(authoritative.thread, current), current };
    queued.push({ schema_version: 2, kind: 'thread.batch', thread_id: current.thread_id, current }); wake();
  };
  const receipt = (index: number, current?: FlowerRuntimeCurrentView) => requests[index].resolve({ client_request_id: launch.mock.calls[index][0].client_request_id, thread_id: initial.thread_id, ...(current ? { current } : {}) });
  const rows = () => [...runtime.querySelectorAll<HTMLElement>('[data-flower-transport-outbox-id]')];
  return { runtime, drafts, launch, requests, editor, type, submit, emit, receipt, rows, initial, other };
}

function queuedCurrent(threadID: string, requestID: string, prompt: string, version = 2): FlowerRuntimeCurrentView {
  return { thread_id: threadID, view_version: version, activity: 'active', turn_id: 'turn-original', run_id: 'original-run',
    run_progress: { phase: 'waiting_response' }, items: [], interactions: [], queue: [{ id: `queue:${requestID}`, request_key: requestID, input: { text: prompt } }] };
}

it('retains the preparing draft and exposes the preparation guard', async () => {
  const generation = deferred<string>();
  const s = await setup({ idle: true, generation: generation.promise });
  s.type('Preparing input'); s.submit(); s.submit();
  await waitFor(() => s.runtime.querySelector('[data-flower-primary-action="send"]')?.getAttribute('aria-busy') === 'true');
  expect(s.editor().value).toBe('Preparing input');
  expect(s.runtime.querySelector('[data-flower-primary-action="send"]')?.getAttribute('aria-label')).toContain('Sending');
  expect(s.launch).not.toHaveBeenCalled();
  generation.resolve('b'.repeat(32));
  await waitFor(() => s.launch.mock.calls.length === 1);
  expect(s.editor().value).toBe('Preparing input');
  expect(s.rows()).toHaveLength(0);
  s.receipt(0);
  await waitFor(() => s.editor().value === '');
});

it('preserves text edited away and back to the submitted value during preparation', async () => {
  const generation = deferred<string>();
  const s = await setup({ idle: true, generation: generation.promise });
  s.type('Original A'); s.submit();
  await waitFor(() => s.runtime.querySelector('[data-flower-primary-action="send"]')?.getAttribute('aria-busy') === 'true');
  s.type('Edited B'); s.type('Original A');
  generation.resolve('d'.repeat(32));
  await waitFor(() => s.launch.mock.calls.length === 1);
  expect(s.launch.mock.calls[0][0].prompt).toBe('Original A');
  expect(s.editor().value).toBe('Original A');
  s.receipt(0);
  await waitFor(() => s.runtime.querySelector('[data-flower-primary-action="send"]')?.getAttribute('aria-busy') !== 'true');
  expect(s.rows()).toHaveLength(0);
  expect(s.editor().value).toBe('Original A');
});

it.each(['receipt', 'current'] as const)('binds follow-up preparation after the first new-chat %s arrives', async confirmation => {
  const secondGeneration = deferred<string>();
  let generationRequests = 0;
  const s = await setup({ newThread: true, generation: () => ++generationRequests === 1 ? Promise.resolve('a'.repeat(32)) : secondGeneration.promise });
  s.type('Create A'); s.submit(); await waitFor(() => s.launch.mock.calls.length === 1);
  s.type('Follow-up B'); s.submit();
  expect(generationRequests).toBe(1);
  expect(s.rows()).toHaveLength(0);
  if (confirmation === 'receipt') s.receipt(0);
  else s.emit(queuedCurrent(s.initial.thread_id, s.launch.mock.calls[0][0].client_request_id, 'Create A'));
  await waitFor(() => s.runtime.querySelector(`[data-thread-id="${s.initial.thread_id}"]`)?.getAttribute('data-flower-thread-active') === 'true');
  await waitFor(() => s.runtime.querySelector('.flower-thread-navigation-status')?.hasAttribute('hidden') === true);
  expect(s.editor().value).toBe('Follow-up B');
  s.submit();
  await waitFor(() => generationRequests === 2);
  expect(s.editor().value).toBe('');
  expect(s.rows().at(-1)?.textContent).toContain('Waiting to queue');
  secondGeneration.resolve('a'.repeat(32));
  await waitFor(() => s.launch.mock.calls.length === 2);
  expect(s.launch.mock.calls[1][0].thread_id).toBe(s.initial.thread_id);
  expect(s.launch.mock.calls[1][0].decision).toBeNull();
  expect(s.launch.mock.calls[1][0].prompt).toBe('Follow-up B');
  s.type('Continue C'); s.submit(); await waitFor(() => s.rows().length >= 2);
  s.receipt(1);
  await waitFor(() => s.launch.mock.calls.length === 3);
  expect(s.launch.mock.calls[2][0].thread_id).toBe(s.initial.thread_id);
});

it('shows successive sends immediately and dispatches in order after the first receipt', async () => {
  const s = await setup();
  s.type('First message'); const started = performance.now(); s.submit();
  await waitFor(() => s.rows().length === 1);
  expect(performance.now() - started).toBeLessThan(100);
  await waitFor(() => s.launch.mock.calls.length === 1);
  s.type('Second message'); s.submit();
  await waitFor(() => s.rows().length === 2);
  expect(s.launch).toHaveBeenCalledTimes(1);
  expect(s.editor().value).toBe('');
  const retained = s.rows()[0];
  s.type('New unsent draft'); s.receipt(0);
  await waitFor(() => s.launch.mock.calls.length === 2);
  expect(s.editor().value).toBe('New unsent draft');
  const firstID = s.launch.mock.calls[0][0].client_request_id;
  s.emit(queuedCurrent(s.initial.thread_id, firstID, 'First message'));
  await waitFor(() => !retained.hasAttribute('data-flower-transport-outbox-id'));
  expect(retained.isConnected).toBe(true);
  expect(s.runtime.querySelector(`[data-flower-queued-turn-dock-id="queue:${firstID}"]`)).toBe(retained);
});

it('releases the next send on current confirmation and ignores a late HTTP failure', async () => {
  const s = await setup(); s.type('First'); s.submit();
  await waitFor(() => s.launch.mock.calls.length === 1);
  s.type('Second'); s.submit(); await waitFor(() => s.rows().length === 2);
  const firstID = s.launch.mock.calls[0][0].client_request_id;
  s.emit(queuedCurrent(s.initial.thread_id, firstID, 'First'));
  await waitFor(() => s.launch.mock.calls.length === 2);
  s.requests[0].reject(flowerTurnAdmissionError('unknown', new Error('Lost response')));
  await Promise.resolve();
  expect(s.runtime.querySelector('[data-flower-transport-delivery="unknown"]')).toBeNull();
  expect(s.launch).toHaveBeenCalledTimes(2);
});

it('retains a definite failure and retries its original identity without clearing newer input', async () => {
  const s = await setup(); s.type('Keep this request'); s.submit();
  await waitFor(() => s.launch.mock.calls.length === 1);
  s.type('New draft'); s.requests[0].reject(flowerTurnAdmissionError('rejected', new Error('Rejected')));
  await waitFor(() => s.runtime.querySelector('[data-flower-transport-delivery="failed"]') !== null);
  expect(s.editor().value).toBe('New draft');
  const failed = s.rows()[0];
  expect(failed.querySelector<HTMLButtonElement>('[aria-label="Restore to empty editor"]')).toBeDisabled();
  failed.querySelector<HTMLButtonElement>('[aria-label="Retry send"]')!.click();
  await waitFor(() => s.launch.mock.calls.length === 2);
  expect(s.launch.mock.calls[1][0]).toEqual(s.launch.mock.calls[0][0]);
  expect(s.editor().value).toBe('New draft');
});

it('pauses only the unknown thread, permits later unsent removal, and retries the same request', async () => {
  const s = await setup(); s.type('Unknown first'); s.submit();
  await waitFor(() => s.launch.mock.calls.length === 1);
  s.type('Later unsent'); s.submit(); await waitFor(() => s.rows().length === 2);
  s.requests[0].reject(flowerTurnAdmissionError('unknown', new Error('Response unavailable')));
  await waitFor(() => s.runtime.querySelector('[data-flower-transport-delivery="unknown"]') !== null);
  expect(s.launch).toHaveBeenCalledTimes(1);
  const unknown = s.rows()[0], later = s.rows()[1];
  expect(unknown.querySelector('[aria-label="Delete unsent message"]')).toBeNull();
  later.querySelector<HTMLButtonElement>('[aria-label="Delete unsent message"]')!.click();
  await waitFor(() => s.rows().length === 1);
  unknown.querySelector<HTMLButtonElement>('[aria-label="Retry send"]')!.click();
  await waitFor(() => s.launch.mock.calls.length === 2);
  expect(s.launch.mock.calls[1][0]).toEqual(s.launch.mock.calls[0][0]);
});

it('restores a failed request only into an empty draft', async () => {
  const s = await setup(); s.type('Restore this'); s.submit();
  await waitFor(() => s.launch.mock.calls.length === 1);
  s.requests[0].reject(flowerTurnAdmissionError('not_sent', new Error('Offline')));
  await waitFor(() => s.runtime.querySelector('[data-flower-transport-delivery="failed"]') !== null);
  s.rows()[0].querySelector<HTMLButtonElement>('[aria-label="Restore to empty editor"]')!.click();
  await waitFor(() => s.rows().length === 0);
  expect(s.editor().value).toBe('Restore this');
});

it('binds successive new-chat input to the accepted conversation', async () => {
  const s = await setup({ newThread: true }); s.type('Create conversation'); s.submit();
  await waitFor(() => s.launch.mock.calls.length === 1);
  s.type('Continue conversation'); s.submit();
  expect(s.rows()).toHaveLength(0);
  expect(s.launch.mock.calls[0][0].thread_id).toBeUndefined();
  s.receipt(0);
  await waitFor(() => s.runtime.querySelector(`[data-thread-id="${s.initial.thread_id}"]`)?.getAttribute('data-flower-thread-active') === 'true');
  s.submit();
  await waitFor(() => s.launch.mock.calls.length === 2);
  expect(s.launch.mock.calls[1][0].thread_id).toBe(s.initial.thread_id);
  s.type('Draft after creation'); s.receipt(1);
  await waitFor(() => s.rows().every(row => row.dataset.flowerTransportDelivery === 'accepted'));
  expect(s.editor().value).toBe('Draft after creation');
});


it('keeps queue feedback below 100 ms at P95 while the server response is delayed', async () => {
  const s = await setup();
  const feedbackMs: number[] = [];
  for (let index = 0; index < 25; index += 1) {
    s.type(`Ordered pending input ${index}`);
    const started = performance.now(); s.submit();
    await waitFor(() => s.rows().length === index + 1);
    feedbackMs.push(performance.now() - started);
  }
  const sorted = [...feedbackMs].sort((left, right) => left - right);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  expect(p95).toBeLessThanOrEqual(100);
  expect(s.launch).toHaveBeenCalledTimes(1);
  console.info('Flower pending queue feedback P95 (ms):', p95);
});


it('keeps references selected during preparation and restores the frozen references on failure', async () => {
  const generation = deferred<string>();
  const s = await setup({ idle: true, generation: generation.promise });
  const submitted = { local_id: 'submitted-image', kind: 'file' as const, path: '/workspace/chart.png', label: 'chart.png' };
  const newer = { ...submitted, local_id: 'new-selection' };
  s.drafts.open(s.initial.thread_id).mutate(value => ({ ...value, references: [submitted] }));
  s.type('Inspect the chart'); s.submit();
  await waitFor(() => s.runtime.querySelector('[data-flower-primary-action="send"]')?.getAttribute('aria-busy') === 'true');
  s.drafts.open(s.initial.thread_id).mutate(value => ({ ...value, references: [newer] }));
  generation.resolve('c'.repeat(32));
  await waitFor(() => s.launch.mock.calls.length === 1);
  expect(s.drafts.read(s.initial.thread_id).value.references).toEqual([newer]);
  expect(s.launch.mock.calls[0][0].context_action).toMatchObject({ context: [{ kind: 'file_path', path: '/workspace/chart.png', is_directory: false }] });
  s.requests[0].reject(flowerTurnAdmissionError('rejected', new Error('Try again')));
  await waitFor(() => s.rows()[0].dataset.flowerTransportDelivery === 'failed');
  s.drafts.open(s.initial.thread_id).mutate(value => ({ ...value, references: [] }));
  s.type('');
  await waitFor(() => !s.rows()[0].querySelector<HTMLButtonElement>('[aria-label="Restore to empty editor"]')?.disabled);
  s.rows()[0].querySelector<HTMLButtonElement>('[aria-label="Restore to empty editor"]')!.click();
  await waitFor(() => s.rows().length === 0);
  expect(s.drafts.read(s.initial.thread_id).value.references).toEqual([submitted]);
  expect(s.editor().value).toBe('Inspect the chart');
});

it('keeps another thread usable while the first thread awaits confirmation', async () => {
  const s = await setup(); s.type('Unknown request'); s.submit();
  await waitFor(() => s.launch.mock.calls.length === 1);
  s.requests[0].reject(flowerTurnAdmissionError('unknown', new Error('Connection lost')));
  await waitFor(() => s.rows()[0].dataset.flowerTransportDelivery === 'unknown');
  (s.runtime.querySelector(`[data-thread-id="${s.other.thread_id}"] button`) as HTMLButtonElement).click();
  await waitFor(() => s.runtime.querySelector(`[data-thread-id="${s.other.thread_id}"]`)?.getAttribute('data-flower-thread-active') === 'true');
  await waitFor(() => s.runtime.querySelector('.flower-thread-navigation-status')?.hasAttribute('hidden') === true);
  s.type('Independent message'); s.submit();
  await waitFor(() => s.launch.mock.calls.length === 2);
  expect(s.launch.mock.calls[1][0].thread_id).toBe(s.other.thread_id);
  expect(s.rows()).toHaveLength(0);
  expect(s.editor().value).toBe('Independent message');
});

it('waits for an in-flight later send before retrying an older definite failure', async () => {
  const s = await setup(); s.type('First failed'); s.submit();
  await waitFor(() => s.launch.mock.calls.length === 1);
  s.requests[0].reject(flowerTurnAdmissionError('not_sent', new Error('Offline')));
  await waitFor(() => s.rows()[0].dataset.flowerTransportDelivery === 'failed');
  s.type('Second sending'); s.submit();
  await waitFor(() => s.launch.mock.calls.length === 2);
  s.rows()[0].querySelector<HTMLButtonElement>('[aria-label="Retry send"]')!.click();
  await Promise.resolve();
  expect(s.launch).toHaveBeenCalledTimes(2);
  s.receipt(1);
  await waitFor(() => s.launch.mock.calls.length === 3);
  expect(s.launch.mock.calls[2][0]).toEqual(s.launch.mock.calls[0][0]);
});

it('restores failed attachment contents into a fresh editable draft', async () => {
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'delivery-capability', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
    routes: { 'text/plain': 'tool_read' },
  };
  const uploadAttachment = vi.fn(async (input: Parameters<NonNullable<FlowerSurfaceAdapter['uploadAttachment']>>[0]) => ({
    attachment_id: 'upl_delivery_attachment', name: input.file.name, mime_type: input.file.type, size_bytes: input.file.size,
    digest_sha256: 'e'.repeat(64), locator: 'attachment://v1/upl_delivery_attachment/notes.txt', source: input.source, capability_revision: capability.revision,
  }));
  const s = await setup({ overrides: { loadAttachmentCapability: vi.fn(async () => capability), uploadAttachment } });
  const picker = s.runtime.querySelector('input[type="file"]') as HTMLInputElement;
  const transfer = new DataTransfer(); transfer.items.add(new File(['Preserved attachment contents'], 'notes.txt', { type: 'text/plain' }));
  Object.defineProperty(picker, 'files', { configurable: true, value: transfer.files });
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => s.runtime.querySelector('[data-attachment-status="staged_ready"]') !== null);
  s.type('Restore text and file'); s.submit();
  await waitFor(() => s.launch.mock.calls.length === 1);
  expect(s.launch.mock.calls[0][0].attachment_ids).toEqual(['upl_delivery_attachment']);
  s.requests[0].reject(flowerTurnAdmissionError('rejected', new Error('Not admitted')));
  await waitFor(() => s.rows()[0].dataset.flowerTransportDelivery === 'failed');
  s.rows()[0].querySelector<HTMLButtonElement>('[aria-label="Restore to empty editor"]')!.click();
  await waitFor(() => s.rows().length === 0);
  await waitFor(() => s.runtime.querySelector('[data-attachment-status="staged_ready"]') !== null);
  expect(s.editor().value).toBe('Restore text and file');
  expect(s.drafts.read(s.initial.thread_id).value.attachments[0].name).toBe('notes.txt');
  expect(s.drafts.attachmentController(s.initial.thread_id, () => { throw new Error('Expected restored controller'); }).localFiles()).toHaveLength(1);
});

it('does not dispatch when persistence fails and permits the same request to retry', async () => {
  const s = await setup();
  const originalTransaction = IDBDatabase.prototype.transaction;
  let failOnce = true;
  const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, storeNames, mode, options) {
    if (mode === 'readwrite' && failOnce) { failOnce = false; throw new DOMException('Disk full', 'QuotaExceededError'); }
    return originalTransaction.call(this, storeNames, mode, options);
  });
  try {
    s.type('Retain on disk error'); s.submit();
    await waitFor(() => s.rows()[0]?.dataset.flowerTransportDelivery === 'failed');
    expect(s.launch).not.toHaveBeenCalled();
    expect(s.rows()[0].textContent).toContain('Send failed');
    expect(s.runtime.querySelector('[data-flower-transport-delivery="unknown"]')).toBeNull();
    const requestID = s.rows()[0].dataset.flowerTransportOutboxId;
    s.rows()[0].querySelector<HTMLButtonElement>('[aria-label="Retry send"]')!.click();
    await waitFor(() => s.launch.mock.calls.length === 1);
    expect(s.launch.mock.calls[0][0].client_request_id).toBe(requestID);
  } finally { transaction.mockRestore(); }
});

it('recovers text and references from lost attachment capability without automatically sending', async () => {
  const reference = { local_id: 'recover-reference', kind: 'file' as const, path: '/workspace/original.png', label: 'original.png' };
  const original = createTransportOutbox().put({
    requestId: 'lost-attachment', threadId: 'delivery-thread',
    input: { client_request_id: 'lost-attachment', thread_id: 'delivery-thread', prompt: 'Preserve text and reference', attachment_ids: ['upl_original'] },
    draftReferences: [reference], attachmentLabels: ['upload.png'], createdAtMs: Date.now(),
  }).put({
    requestId: 'second-local-copy', threadId: 'delivery-thread',
    input: { client_request_id: 'second-local-copy', thread_id: 'delivery-thread', prompt: 'Local recovery copy', attachment_ids: ['upl_second'] },
    attachmentLabels: ['second.png'], createdAtMs: Date.now(),
  });
  await original.flushPersistence(); original.dispose();
  const s = await setup();
  await waitFor(() => s.rows().length === 2);
  const recovered = s.rows()[0];
  expect(recovered.getAttribute('aria-description')).toContain('Attachments are unavailable after restart');
  expect(recovered.getBoundingClientRect().height).toBe(38);
  expect(recovered.textContent).toContain('Confirmation needed');
  expect(recovered.textContent).not.toContain('Send failed');
  expect(recovered.querySelector('[aria-label="Retry send"]')).toBeNull();
  expect(recovered.querySelector('[aria-label="Refresh confirmation"]')).toBeTruthy();
  expect(recovered.querySelector('[aria-label="Delete unsent message"]')).toBeNull();
  expect(recovered.querySelector('[aria-label="Remove local recovery copy"]')?.getAttribute('title')).toContain('does not cancel');
  recovered.querySelector<HTMLButtonElement>('[aria-label="Restore to empty editor"]')!.click();
  await waitFor(() => s.editor().value === 'Preserve text and reference');
  expect(s.rows()).toHaveLength(2);
  expect(s.editor().value).toBe('Preserve text and reference');
  expect(s.drafts.read(s.initial.thread_id).value.references).toEqual([reference]);
  expect(s.drafts.read(s.initial.thread_id).value.attachments).toEqual([]);
  expect(s.launch).not.toHaveBeenCalled();
  s.rows()[0].querySelector<HTMLButtonElement>('[aria-label="Remove local recovery copy"]')!.click();
  await waitFor(() => s.rows().length === 1);
  s.rows()[0].querySelector<HTMLButtonElement>('[aria-label="Remove local recovery copy"]')!.click();
  await waitFor(() => s.rows().length === 0);
  expect(s.launch).not.toHaveBeenCalled();
});

it('keeps later sends paused after recovering an unknown request until its local copy is explicitly removed', async () => {
  const original = createTransportOutbox().put({
    requestId: 'unknown-image-request', threadId: 'delivery-thread',
    input: { client_request_id: 'unknown-image-request', thread_id: 'delivery-thread', prompt: 'Unknown image input', attachment_ids: ['upl_unknown'] },
    attachmentLabels: ['original.png'], createdAtMs: Date.now(),
  });
  await original.flushPersistence(); original.dispose();
  const s = await setup(); await waitFor(() => s.rows().length === 1);
  s.type('Later pending input'); s.submit(); await waitFor(() => s.rows().length === 2);
  expect(s.launch).not.toHaveBeenCalled();
  s.rows()[0].querySelector<HTMLButtonElement>('[aria-label="Restore to empty editor"]')!.click();
  await waitFor(() => s.editor().value === 'Unknown image input');
  expect(s.rows()).toHaveLength(2);
  expect(s.launch).not.toHaveBeenCalled();
  const remove = s.rows()[0].querySelector<HTMLButtonElement>('[aria-label="Remove local recovery copy"]')!;
  expect(remove.title).toContain('resume later messages');
  expect(remove.title).toContain('does not cancel');
  remove.click();
  await waitFor(() => s.launch.mock.calls.length === 1);
  expect(s.launch.mock.calls[0][0].prompt).toBe('Later pending input');
  expect(s.editor().value).toBe('Unknown image input');
});

it('shows unknown compaction with same-ID recovery while later ordinary input waits', async () => {
  const compactResults: ReturnType<typeof deferred<FlowerRuntimeCurrentView>>[] = [];
  const compact = vi.fn((_threadID: string, _input: { storage_generation: string; client_request_id: string }) => {
    const result = deferred<FlowerRuntimeCurrentView>(); compactResults.push(result); return result.promise;
  });
  const s = await setup({ idle: true, overrides: { compactThreadContext: compact } });
  s.type('/compact'); (s.runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
  await waitFor(() => compact.mock.calls.length === 1);
  compactResults[0].reject(flowerTurnAdmissionError('unknown', new Error('No compaction response')));
  await waitFor(() => s.rows()[0]?.dataset.flowerTransportDelivery === 'unknown');
  expect(s.rows()[0].textContent).toContain('Compact and continue Goal');
  expect(s.rows()[0].querySelector('[aria-label="Refresh confirmation"]')).toBeTruthy();
  s.type('Next ordinary input'); s.submit();
  await waitFor(() => s.rows().length === 2);
  expect(s.launch).not.toHaveBeenCalled();
  s.rows()[0].querySelector<HTMLButtonElement>('[aria-label="Retry send"]')!.click();
  await waitFor(() => compact.mock.calls.length === 2);
  expect(compact.mock.calls[1]).toEqual(compact.mock.calls[0]);
  compactResults[1].resolve({ thread_id: s.initial.thread_id, view_version: 2, activity: 'idle', items: [] });
  await waitFor(() => s.launch.mock.calls.length === 1);
  expect(s.launch.mock.calls[0][0].prompt).toBe('Next ordinary input');
  expect(s.rows()).toHaveLength(1);
  expect(s.rows()[0].textContent).not.toContain('Compact and continue Goal');
});


it('releases ordinary loading on a receipt without current and retries unchanged failures with the same identity', async () => {
  const s = await setup({ idle: true });
  s.type('Ordinary request'); s.submit();
  await waitFor(() => s.launch.mock.calls.length === 1);
  s.requests[0].reject(flowerTurnAdmissionError('rejected', new Error('Rejected')));
  await waitFor(() => s.rows()[0]?.dataset.flowerTransportDelivery === 'failed');
  expect(s.editor().value).toBe('Ordinary request');
  s.submit();
  await waitFor(() => s.launch.mock.calls.length === 2);
  expect(s.launch.mock.calls[1][0]).toEqual(s.launch.mock.calls[0][0]);
  s.receipt(1);
  await waitFor(() => s.editor().value === '');
  expect(s.runtime.querySelector('[data-flower-primary-action="send"]')?.getAttribute('aria-busy')).not.toBe('true');
  expect(s.rows()).toHaveLength(0);
});

it('assigns edited rejected input a fresh identity and retains edited references after confirmation', async () => {
  const s = await setup({ idle: true });
  const reference = { local_id: 'same-reference', kind: 'file' as const, path: '/workspace/first.txt', label: 'first.txt' };
  s.drafts.open(s.initial.thread_id).mutate(value => ({ ...value, references: [reference] }));
  s.type('Original'); s.submit();
  await waitFor(() => s.launch.mock.calls.length === 1);
  s.requests[0].reject(flowerTurnAdmissionError('rejected', new Error('Rejected')));
  await waitFor(() => s.rows()[0]?.dataset.flowerTransportDelivery === 'failed');
  s.type('Edited'); s.submit();
  await waitFor(() => s.launch.mock.calls.length === 2);
  expect(s.launch.mock.calls[1][0].client_request_id).not.toBe(s.launch.mock.calls[0][0].client_request_id);
  const updated = { ...reference, path: '/workspace/second.txt', label: 'second.txt' };
  s.drafts.open(s.initial.thread_id).mutate(value => ({ ...value, references: [updated] }));
  s.receipt(1);
  await waitFor(() => s.editor().value === '');
  expect(s.drafts.read(s.initial.thread_id).value.references).toEqual([updated]);
});

it('captures input after an ordinary unknown result and freezes its generation while delivery is paused', async () => {
  let generation = 'a'.repeat(32);
  const s = await setup({ idle: true, generation: async () => generation });
  s.type('Unknown ordinary'); s.submit();
  await waitFor(() => s.launch.mock.calls.length === 1);
  s.requests[0].reject(flowerTurnAdmissionError('unknown', new Error('Connection lost')));
  await waitFor(() => s.rows()[0]?.dataset.flowerTransportDelivery === 'unknown');
  s.submit();
  expect(s.launch).toHaveBeenCalledTimes(1);
  s.type('Queued behind unknown'); s.submit();
  await waitFor(() => s.rows().length === 2);
  expect(s.rows()[1].textContent).toContain('Waiting to queue');
  expect(s.editor().value).toBe('');
  generation = 'b'.repeat(32);
  s.rows()[0].querySelector<HTMLButtonElement>('[aria-label="Retry send"]')!.click();
  await waitFor(() => s.launch.mock.calls.length === 2);
  expect(s.launch.mock.calls[1][0]).toEqual(s.launch.mock.calls[0][0]);
  s.receipt(1);
  await waitFor(() => s.launch.mock.calls.length === 3);
  expect(s.launch.mock.calls[2][0].storage_generation).toBe('a'.repeat(32));
});

it('shows captured preparation after restart as explicit recovery without replay', async () => {
  const original = createTransportOutbox().put({
    presentation: 'queue', preparation: 'pending', delivery: 'pending',
    requestId: 'captured-preparation', threadId: 'delivery-thread',
    input: { client_request_id: 'captured-preparation', thread_id: 'delivery-thread', prompt: 'Recover preparation' },
    draftText: 'Recover preparation', attachmentLabels: [], createdAtMs: Date.now(),
  });
  await original.flushPersistence(); original.dispose();
  const s = await setup();
  await waitFor(() => s.rows().length === 1);
  expect(s.rows()[0].getAttribute('aria-description')).toContain('This message was not sent before restart');
  expect(s.rows()[0].getBoundingClientRect().height).toBe(38);
  expect(s.rows()[0].querySelector('[aria-label="Retry send"]')).toBeNull();
  expect(s.launch).not.toHaveBeenCalled();
  s.type('New draft');
  expect(s.rows()[0].querySelector<HTMLButtonElement>('[aria-label="Restore to empty editor"]')).toBeDisabled();
  s.type('');
  s.rows()[0].querySelector<HTMLButtonElement>('[aria-label="Restore to empty editor"]')!.click();
  await waitFor(() => s.rows().length === 0);
  expect(s.editor().value).toBe('Recover preparation');
  expect(s.launch).not.toHaveBeenCalled();
});

it.each([false, true])('settles a remounted ordinary draft without removing newer edits (%s)', async edited => {
  const original = createTransportOutbox().put({
    presentation: 'composer', delivery: 'pending', requestId: 'remounted-input', threadId: 'delivery-thread',
    input: { client_request_id: 'remounted-input', thread_id: 'delivery-thread', prompt: 'Original draft' },
    draftText: 'Original draft', draftTextRevision: 1, attachmentLabels: [], createdAtMs: Date.now(),
  });
  await original.flushPersistence(); original.dispose();
  const s = await setup({ idle: true });
  await waitFor(() => s.rows()[0]?.dataset.flowerTransportDelivery === 'unknown');
  s.drafts.open(s.initial.thread_id).mutate(value => ({ ...value, text: 'Original draft', client_request_id: 'remounted-input' }));
  if (edited) { s.type('Newer'); s.type('Original draft'); }
  s.emit(queuedCurrent(s.initial.thread_id, 'remounted-input', 'Original draft'));
  await waitFor(() => s.rows().length === 0);
  expect(s.editor().value).toBe(edited ? 'Original draft' : '');
  expect(s.drafts.read(s.initial.thread_id).value.client_request_id).toBeUndefined();
  expect(s.launch).not.toHaveBeenCalled();
});

it('captures both queue rows while IndexedDB persistence is paused', async () => {
  const s = await setup();
  const storage = deferred<void>();
  const originalTransaction = IDBDatabase.prototype.transaction;
  const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, storeNames, mode, options) {
    const result = originalTransaction.call(this, storeNames, mode, options);
    if (mode === 'readwrite') {
      let complete: ((event: Event) => void) | null = null;
      Object.defineProperty(result, 'oncomplete', {
        get: () => complete,
        set: value => { complete = value; },
      });
      result.addEventListener('complete', event => { void storage.promise.then(() => complete?.(event)); });
    }
    return result;
  });
  try {
    s.type('Stored A'); s.submit();
    await waitFor(() => s.rows().length === 1);
    s.type('Stored B'); s.submit();
    await waitFor(() => s.rows().length === 2);
    expect(s.rows().map(row => row.querySelector('.flower-queued-turn-label')?.textContent)).toEqual(['Stored A', 'Stored B']);
    expect(s.editor().value).toBe('');
    expect(s.launch).not.toHaveBeenCalled();
    storage.resolve();
    await waitFor(() => s.launch.mock.calls.length === 1);
    s.receipt(0);
    await waitFor(() => s.launch.mock.calls.length === 2);
    expect(s.launch.mock.calls.map(([input]) => input.prompt)).toEqual(['Stored A', 'Stored B']);
  } finally { storage.resolve(); transaction.mockRestore(); }
});

it('lets canonical current display a queued submission that instead starts after the previous run ends', async () => {
  const s = await setup();
  s.type('Next turn'); s.submit();
  await waitFor(() => s.launch.mock.calls.length === 1);
  const requestID = s.launch.mock.calls[0][0].client_request_id;
  s.emit({ thread_id: s.initial.thread_id, view_version: 2, activity: 'idle', items: [], queue: [], interactions: [] });
  s.receipt(0, { thread_id: s.initial.thread_id, view_version: 3, activity: 'active', turn_id: 'next-turn', run_id: 'next-run',
    run_progress: { phase: 'waiting_response' }, queue: [], interactions: [],
    items: [{ id: `user:${requestID}`, kind: 'user', turn_id: 'next-turn', run_id: 'next-run', ordinal: 1, text: 'Next turn' }] });
  await waitFor(() => s.rows().length === 0);
  expect(s.runtime.querySelectorAll('[data-flower-queued-turn-dock-id]')).toHaveLength(0);
  expect(s.runtime.querySelectorAll(`[data-flower-message-id="user:${requestID}"]`)).toHaveLength(1);
});

it.each([false, true])('preserves long-text cancellation before outbox capture and admits the later explicit submission (idle=%s)', async idle => {
  const capability: FlowerAttachmentCapability = {
    model_id: 'openai/gpt-5.2', revision: 'long-text-delivery', enabled: true, supports_long_text: true,
    max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
    routes: { 'text/plain': 'tool_read' },
  };
  const uploadAttachment = vi.fn(async (input: Parameters<NonNullable<FlowerSurfaceAdapter['uploadAttachment']>>[0]) => {
    if (uploadAttachment.mock.calls.length === 1) await new Promise<void>((_resolve, reject) => {
      input.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    });
    return { attachment_id: 'upl_long_text', name: input.file.name, mime_type: input.file.type, size_bytes: input.file.size,
      digest_sha256: 'e'.repeat(64), locator: 'attachment://v1/upl_long_text/message.txt', source: input.source,
      capability_revision: capability.revision };
  });
  const s = await setup({ idle, overrides: { loadAttachmentCapability: vi.fn(async () => capability), uploadAttachment } });
  const longText = 'L'.repeat(50_001);
  s.type(longText);
  await waitFor(() => !s.runtime.querySelector<HTMLButtonElement>('[data-flower-primary-action="send"]')!.disabled);
  s.submit();
  await waitFor(() => uploadAttachment.mock.calls.length === 1);
  expect(s.rows()).toHaveLength(0);
  expect(s.launch).not.toHaveBeenCalled();
  s.runtime.querySelector<HTMLButtonElement>('[data-flower-primary-action="cancel_long_text"]')!.click();
  await waitFor(() => s.runtime.querySelector('[data-flower-primary-action="send"]') !== null);
  expect(s.editor().value).toBe(longText);
  expect(s.launch).not.toHaveBeenCalled();
  s.submit();
  await waitFor(() => s.launch.mock.calls.length === 1);
  expect(s.launch.mock.calls[0][0]).toMatchObject({ prompt: '', attachment_ids: ['upl_long_text'] });
  expect(s.editor().value).toBe(idle ? longText : '');
  s.receipt(0);
  await waitFor(() => s.editor().value === '');
  expect(s.drafts.read(s.initial.thread_id).value.attachments).toEqual([]);
});
