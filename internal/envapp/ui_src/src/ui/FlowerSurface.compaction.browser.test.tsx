import '../index.css';
import './flower-feature.css';
import { page, userEvent } from 'vitest/browser';
import { expect, it, vi } from 'vitest';
import type { FlowerRuntimeCurrentView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { withModelDirectoryFixture } from '../../../../flower_ui/testing/modelDirectoryFixture';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import { adapter, deferred, flowerSurfaceNotifications, liveBootstrap, thread, renderSurfaceWithAdapterProps, renderSurfaceWithDraftCoordinator, waitFor } from './FlowerSurface.navigation.testHarness';

const focus = { request_id: 'compact-focus', thread_id: 'thread-1' };
const accepted = (): FlowerRuntimeCurrentView => ({ thread_id: 'thread-1', view_version: 2, activity: 'active', turn_kind: 'context_compaction', turn_id: 'compact-turn', run_id: 'compact-run', items: [], run_progress: { phase: 'preparing' } });
async function enterCommand(surface: HTMLElement, command = '/compact') {
  const input = surface.querySelector<HTMLTextAreaElement>('textarea')!;
  input.value = command;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: command }));
  await new Promise(resolve => setTimeout(resolve, 100));
  input.focus();
  await userEvent.keyboard('{Enter}');
  return input;
}

it.each(['/', '/com', '/compac', '  /com  '])('clears accepted command prefix %j and closes its suggestions', async command => {
  const pending = deferred<FlowerRuntimeCurrentView>();
  const compact = vi.fn(() => pending.promise);
  const base = adapter(true);
  const surface = renderSurfaceWithAdapterProps({ ...base, compactThreadContext: compact }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  const input = await enterCommand(surface, command);
  await waitFor(() => compact.mock.calls.length === 1);
  expect(surface.querySelector('.flower-composer-command-menu')).not.toBeNull();
  expect(input.value).toBe(command);
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  expect(compact).toHaveBeenCalledTimes(1);
  expect(base.launchTurn).not.toHaveBeenCalled();
  pending.resolve(accepted());
  await waitFor(() => input.value === '');
  expect(surface.querySelector('.flower-composer-command-menu')).toBeNull();
  expect(input.getAttribute('aria-expanded')).not.toBe('true');
  expect(document.activeElement).toBe(input);
  expect(input.disabled).toBe(false);
});

it.each(['suggestion', 'primary'] as const)('uses the same accepted prefix through the %s button', async action => {
  const compact = vi.fn(async () => accepted());
  const base = adapter(true);
  const surface = renderSurfaceWithAdapterProps({ ...base, compactThreadContext: compact }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  const input = surface.querySelector<HTMLTextAreaElement>('textarea')!;
  input.value = '/com';
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '/com' }));
  input.focus();
  await waitFor(() => surface.querySelector('.flower-composer-command-menu') !== null);
  const button = surface.querySelector<HTMLButtonElement>(action === 'suggestion'
    ? '.flower-composer-command-item'
    : '.flower-composer-submit')!;
  expect(button.disabled).toBe(false);
  await userEvent.click(button);
  await waitFor(() => compact.mock.calls.length === 1 && input.value === '');
  expect(base.launchTurn).not.toHaveBeenCalled();
  expect(surface.querySelector('.flower-composer-command-menu')).toBeNull();
});

it('keeps partial commands editable during composition and Shift+Enter', async () => {
  const compact = vi.fn(async () => accepted());
  const base = adapter(true);
  const surface = renderSurfaceWithAdapterProps({ ...base, compactThreadContext: compact }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  const input = surface.querySelector<HTMLTextAreaElement>('textarea')!;
  input.value = '/com';
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '/com' }));
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', isComposing: true }));
  await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
  expect(input.value).toBe('/com\n');
  expect(compact).not.toHaveBeenCalled();
  expect(base.launchTurn).not.toHaveBeenCalled();
  await userEvent.keyboard('{Backspace}{Enter}');
  await waitFor(() => compact.mock.calls.length === 1 && input.value === '');
  expect(surface.querySelector('.flower-composer-command-menu')).toBeNull();
});

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
  const input = await enterCommand(surface, '/com');
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
  expect(surface.querySelector('.flower-composer-command-menu')).toBeNull();
  await page.screenshot({ element: surface, path: '__screenshots__/redeven-compaction-canvas.png' });
});

it.each(['/compact', '/com'])('keeps navigation available and clears only accepted command %j', async command => {
  const pending = deferred<FlowerRuntimeCurrentView>();
  const compact = vi.fn(() => pending.promise);
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), loadThread: vi.fn(async (id: string) => liveBootstrap(thread({ thread_id: id, title: id === 'thread-2' ? 'Review branch' : 'Deploy plan', updated_at_ms: id === 'thread-2' ? 3 : 2 }))), compactThreadContext: compact }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  const input = await enterCommand(surface, command);
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

it.each(['/compact', '/com'])('preserves rejected command %j and never sends an ordinary turn', async command => {
  const base = adapter(true);
  const compact = vi.fn(async () => { throw flowerTurnAdmissionError('rejected', Object.assign(new Error('Busy'), { code: 'context_compaction_busy' })); });
  const surface = renderSurfaceWithAdapterProps({ ...base, compactThreadContext: compact }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  const input = await enterCommand(surface, command);
  await waitFor(() => flowerSurfaceNotifications().length > 0);
  expect(input.value).toBe(command);
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
  const retry = surface.querySelector<HTMLButtonElement>('[data-flower-transport-delivery="unknown"] [aria-label="Retry send"]');
  expect(retry).toBeTruthy();
  retry!.click();
  await waitFor(() => keys.length === 2);
  expect(keys[1]).toBe(keys[0]);
  expect(base.launchTurn).not.toHaveBeenCalled();
});

it.each(['/compact', '/com'])('preserves file references and staged attachments while clearing accepted command %j', async command => {
  const drafts = createFlowerComposerDraftCoordinator();
  const session = drafts.open('thread-1');
  const capability = { model_id: 'openai/gpt-5.2', revision: 'compaction-capability', enabled: true, supports_long_text: true, max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000, routes: { 'text/plain': 'tool_read' as const } };
  const attachments = [{ local_id: 'file-1', source: 'file' as const, name: 'notes.txt', mime_type: 'text/plain', size_bytes: 12, upload_request_id: 'upload-1', attempt_state: 'staged_ready', staged: { attachment_id: 'attachment-1', name: 'notes.txt', mime_type: 'text/plain', size_bytes: 12, digest_sha256: 'a'.repeat(64), locator: 'attachment://v1/attachment-1/notes.txt', source: 'file' as const, capability_revision: capability.revision } }];
  const references = [{ local_id: 'ref-1', kind: 'file' as const, label: 'config.ts', path: '/workspace/redeven/config.ts' }];
  session.mutate(value => ({ ...value, text: command, attachments, references }));
  const base = adapter(true);
  const compact = vi.fn(async () => accepted());
  const uploadAttachment = vi.fn(async () => attachments[0].staged);
  const surface = renderSurfaceWithDraftCoordinator({ ...base, loadSettings: async () => withModelDirectoryFixture(await base.loadSettings()), loadAttachmentCapability: async () => capability, uploadAttachment, compactThreadContext: compact }, drafts);
  await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"] button')), 10000);
  surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
  await waitFor(() => surface.querySelector('textarea')?.value === command, 10000);
  await waitFor(() => surface.querySelector('[data-attachment-status="staged_ready"]') !== null);
  await enterCommand(surface, command);
  await waitFor(() => compact.mock.calls.length === 1 && session.snapshot().value.text === '');
  expect(session.snapshot().value.attachments).toEqual(attachments);
  expect(session.snapshot().value.references).toEqual(references);
  expect(base.launchTurn).not.toHaveBeenCalled();
  expect(uploadAttachment).not.toHaveBeenCalled();
});
