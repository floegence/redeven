import '../index.css';
import './flower-feature.css';
import { page } from 'vitest/browser';
import { expect, it, vi } from 'vitest';
import type { FlowerRuntimeCurrentView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { withModelDirectoryFixture } from '../../../../flower_ui/testing/modelDirectoryFixture';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import { adapter, deferred, flowerSurfaceNotifications, liveBootstrap, thread, renderSurfaceWithAdapterProps, renderSurfaceWithDraftCoordinator, waitFor } from './FlowerSurface.navigation.testHarness';

const focus = { request_id: 'compact-focus', thread_id: 'thread-1' };
const accepted = (): FlowerRuntimeCurrentView => ({ thread_id: 'thread-1', view_version: 2, activity: 'active', turn_kind: 'context_compaction', turn_id: 'compact-turn', run_id: 'compact-run', items: [], run_progress: { phase: 'preparing' } });
async function enterCommand(surface: HTMLElement) {
  const input = surface.querySelector<HTMLTextAreaElement>('textarea')!;
  input.value = '/compact';
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '/compact' }));
  await new Promise(resolve => setTimeout(resolve, 100));
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  return input;
}

it('routes canvas compaction independently and preserves edited draft and canvas reference', async () => {
  await page.viewport(1000, 850);
  const pending = deferred<FlowerRuntimeCurrentView>();
  const compact = vi.fn((_id: string, _input: { storage_generation: string; client_request_id: string }) => pending.promise);
  const base = adapter(true);
  const canvasContext = { schema_version: 1, action_id: 'ask_flower', provider: 'flower', source: { surface: 'tessiven' }, presentation: { label: 'Orders canvas' }, target: { target_id: 'runtime', locality: 'current' }, context: [] } as never;
  const surface = renderSurfaceWithAdapterProps({ ...base, compactThreadContext: compact }, {
    embeddedConversation: { scope: 'compaction-canvas', threadID: 'thread-1', contextAction: canvasContext,
      composerContext: <span data-testid="canvas-reference">Orders API</span>,
      render: parts => <div class="flower-chat-main">{parts.conversation}{parts.composer}</div> },
    engaged: true, transcriptVisible: true,
  });
  surface.style.cssText = 'height:800px;width:980px';
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  const input = await enterCommand(surface);
  await waitFor(() => compact.mock.calls.length === 1);
  expect(base.launchTurn).not.toHaveBeenCalled();
  expect(compact.mock.calls[0]![0]).toBe('thread-1');
  expect(Object.keys(compact.mock.calls[0]![1]).sort()).toEqual(['client_request_id', 'storage_generation']);
  input.value = 'Keep this draft';
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'Keep this draft' }));
  pending.resolve(accepted());
  await waitFor(() => input.value === 'Keep this draft');
  expect(surface.querySelector('[data-testid="canvas-reference"]')?.textContent).toBe('Orders API');
  expect(input.disabled).toBe(false);
  await page.screenshot({ element: surface, path: '__screenshots__/redeven-compaction-canvas.png' });
});

it('keeps navigation available and clears only the accepted command', async () => {
  const pending = deferred<FlowerRuntimeCurrentView>();
  const compact = vi.fn(() => pending.promise);
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), loadThread: vi.fn(async (id: string) => liveBootstrap(thread({ thread_id: id, title: id === 'thread-2' ? 'Review branch' : 'Deploy plan', updated_at_ms: id === 'thread-2' ? 3 : 2 }))), compactThreadContext: compact }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  const input = await enterCommand(surface);
  await waitFor(() => compact.mock.calls.length === 1);
  expect(input.disabled).toBe(false);
  const next = surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-2"] button')!;
  expect(next.disabled).toBe(false);
  next.click();
  pending.resolve(accepted());
  await waitFor(() => surface.querySelector('textarea')?.value === '');
  surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
  await waitFor(() => surface.querySelector('textarea')?.value === '');
  expect(compact).toHaveBeenCalledTimes(1);
});

it('reports empty context without creating a thread', async () => {
  const base = adapter(true);
  const compact = vi.fn(async () => accepted());
  const surface = renderSurfaceWithAdapterProps({ ...base, listThreads: vi.fn(async () => []), compactThreadContext: compact }, {});
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  await enterCommand(surface);
  await waitFor(() => flowerSurfaceNotifications().length > 0);
  expect(compact).not.toHaveBeenCalled();
  expect(base.launchTurn).not.toHaveBeenCalled();
});

it('preserves rejected commands and never sends an ordinary turn', async () => {
  const base = adapter(true);
  const compact = vi.fn(async () => { throw flowerTurnAdmissionError('rejected', Object.assign(new Error('Busy'), { code: 'context_compaction_busy' })); });
  const surface = renderSurfaceWithAdapterProps({ ...base, compactThreadContext: compact }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  const input = await enterCommand(surface);
  await waitFor(() => flowerSurfaceNotifications().length > 0);
  expect(input.value).toBe('/compact');
  expect(base.launchTurn).not.toHaveBeenCalled();
  expect(compact).toHaveBeenCalledTimes(1);
});

it('reuses the same request key after an uncertain command admission', async () => {
  const keys: string[] = [];
  const compact = vi.fn(async (_id: string, input: { client_request_id: string; storage_generation: string }) => {
    keys.push(input.client_request_id);
    if (keys.length === 1) throw flowerTurnAdmissionError('unknown', new Error('Response disconnected'));
    return accepted();
  });
  const base = adapter(true);
  const surface = renderSurfaceWithAdapterProps({ ...base, compactThreadContext: compact }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  await enterCommand(surface);
  await waitFor(() => keys.length === 1 && flowerSurfaceNotifications().length > 0);
  await enterCommand(surface);
  await waitFor(() => keys.length === 2);
  expect(keys[1]).toBe(keys[0]);
  expect(base.launchTurn).not.toHaveBeenCalled();
});

it('preserves file references and staged attachments while clearing accepted command text', async () => {
  const drafts = createFlowerComposerDraftCoordinator();
  const session = drafts.open('thread-1');
  const capability = { model_id: 'openai/gpt-5.2', revision: 'compaction-capability', enabled: true, supports_long_text: true, max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000, routes: { 'text/plain': 'tool_read' as const } };
  const attachments = [{ local_id: 'file-1', source: 'file' as const, name: 'notes.txt', mime_type: 'text/plain', size_bytes: 12, upload_request_id: 'upload-1', attempt_state: 'staged_ready', staged: { attachment_id: 'attachment-1', name: 'notes.txt', mime_type: 'text/plain', size_bytes: 12, digest_sha256: 'a'.repeat(64), locator: 'attachment://v1/attachment-1/notes.txt', source: 'file' as const, capability_revision: capability.revision } }];
  const references = [{ local_id: 'ref-1', kind: 'file' as const, label: 'config.ts', path: '/workspace/redeven/config.ts' }];
  session.mutate(value => ({ ...value, text: '/compact', attachments, references }));
  const base = adapter(true);
  const compact = vi.fn(async () => accepted());
  const uploadAttachment = vi.fn(async () => attachments[0].staged);
  const surface = renderSurfaceWithDraftCoordinator({ ...base, loadSettings: async () => withModelDirectoryFixture(await base.loadSettings()), loadAttachmentCapability: async () => capability, uploadAttachment, compactThreadContext: compact }, drafts);
  await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"] button')), 10000);
  surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
  await waitFor(() => surface.querySelector('textarea')?.value === '/compact', 10000);
  await waitFor(() => surface.querySelector('[data-attachment-status="staged_ready"]') !== null);
  await enterCommand(surface);
  await waitFor(() => compact.mock.calls.length === 1 && session.snapshot().value.text === '');
  expect(session.snapshot().value.attachments).toEqual(attachments);
  expect(session.snapshot().value.references).toEqual(references);
  expect(base.launchTurn).not.toHaveBeenCalled();
  expect(uploadAttachment).not.toHaveBeenCalled();
});
