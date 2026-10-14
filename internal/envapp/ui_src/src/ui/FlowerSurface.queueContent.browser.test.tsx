import '../index.css';
import './flower-feature.css';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { page } from 'vitest/browser';
import type { FlowerAttachmentCapability, FlowerSurfaceAdapter, FlowerThreadView, FlowerTurnLaunchReceipt } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, thread, liveBootstrap, renderSurfaceWithAdapter, waitFor } from './FlowerSurface.media.test-support';
import { withModelDirectoryFixture } from '../../../../flower_ui/testing/modelDirectoryFixture';

beforeEach(async () => {
 await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('redeven-flower-transport'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
});
function imageBlob() {
 const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
 const context = canvas.getContext('2d')!; context.fillStyle = '#39a'; context.fillRect(0, 0, 64, 64);
 return new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
}
const pathContext = { agentHomePathAbs: '/workspace', homePathAbs: '/workspace', defaultRootId: 'workspace', roots: [{ id: 'workspace', label: 'Workspace', pathAbs: '/workspace', kind: 'workspace', permissions: { read: true, write: true } }] } as const;

const initial = thread({ thread_id: 'queue-content', model_id: 'openai/gpt-5.2', status: 'running', active_run_id: 'active-run', working_dir: '/workspace', read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } }, queued_turns: [{ queue_id: 'queue:first', prompt: 'Original queued input', created_at_ms: 1 }] });
function view(version = 2): FlowerThreadView {
 const result = liveBootstrap(initial, version);
 const current: FlowerThreadView['current'] = { ...result.current!, activity: 'active', turn_id: 'active-turn', run_id: 'active-run', run_progress: { phase: 'waiting_response' }, queue: [{ id: 'queue:first', request_key: 'first', input_fingerprint: 'a'.repeat(64), input: { text: 'Original queued input', references: [{ reference_id: 'file', kind: 'file', label: 'main.ts' }, { reference_id: 'directory', kind: 'directory', label: 'src' }, { reference_id: 'text', kind: 'text', label: 'Captured context', text: 'Captured body' }], attachments: [{ attachment_id: 'image-1', name: 'diagram.png', mime_type: 'image/png', size_bytes: 4, url: '/uploads/diagram.png' }] } }] };
 return { thread: applyFlowerRuntimeCurrentView(result.thread, current), current };
}
const capability: FlowerAttachmentCapability = { model_id: 'openai/gpt-5.2', revision: 'queue-capability', enabled: true, supports_long_text: true, max_attachments: 10, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000, routes: { 'image/png': 'native_full_content', 'text/plain': 'tool_read' } };
async function mount(extra: Partial<FlowerSurfaceAdapter> = {}) {
 await page.viewport(900, 800);
 const surface = renderSurfaceWithAdapter({ ...adapter(true), loadSettings: async () => withModelDirectoryFixture(await adapter(true).loadSettings()), listThreads: vi.fn(async () => [initial]), loadThread: vi.fn(async () => view()), loadAttachmentCapability: vi.fn(async () => capability), createAttachmentStagingScope: vi.fn(async () => ({ staging_scope_id: 'scope', target_id: 'local', capability: 'capability', expires_at_unix_ms: Date.now() + 60_000 })), uploadAttachment: vi.fn(async input => ({ attachment_id: `new-${input.file.name}`, name: input.file.name, mime_type: input.file.type, size_bytes: input.file.size, digest_sha256: 'b'.repeat(64), locator: 'staged', source: 'file' as const, capability_revision: capability.revision })), ...extra });
 await waitFor(() => !!surface.querySelector('[data-thread-id="queue-content"] button'));
 (surface.querySelector('[data-thread-id="queue-content"] button') as HTMLButtonElement).click();
 await waitFor(() => !!surface.querySelector('[data-flower-queued-attachment="image-1"]'));
 return surface;
}
function setText(surface: HTMLElement, value: string) {
 const textarea = surface.querySelector('.flower-composer textarea') as HTMLTextAreaElement;
 textarea.focus(); textarea.value = value; textarea.setSelectionRange(value.length,value.length); textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
 return textarea;
}

describe('Flower queued content', () => {
 it('shows image thumbnails and opens queued attachment and reference previews', async () => {
  const openReference = vi.fn(async () => undefined);
  const surface = await mount({ openCanonicalReference: openReference, loadMessageAttachment: vi.fn(imageBlob) });
  const row = surface.querySelector('[data-flower-queued-turn-dock-id="queue:first"]')!;
  const thumbnail = row.querySelector<HTMLButtonElement>('[data-flower-queued-attachment="image-1"]')!;
  await waitFor(() => !!row.querySelector<HTMLImageElement>('[data-flower-queued-attachment="image-1"] img')?.complete);
  thumbnail.click();
  await waitFor(() => !!document.querySelector('.flower-attachment-preview-window img'));
  expect(document.querySelector<HTMLImageElement>('.flower-attachment-preview-window img')!.naturalWidth).toBe(64);
  document.querySelector<HTMLButtonElement>('.flower-attachment-preview-window [aria-label="Close"]')!.click();
  await waitFor(() => !document.querySelector('.flower-attachment-preview-window'));
  const file = [...row.querySelectorAll<HTMLButtonElement>('button')].find(button => button.title === 'main.ts');
  expect(file).toBeDefined(); file!.click();
  await waitFor(() => openReference.mock.calls.length === 1);
  expect(openReference).toHaveBeenCalledWith({ thread_id: 'queue-content', queue_id: 'queue:first', reference_id: 'file' });
  (row.querySelector('[aria-label="Linked context"]') as HTMLButtonElement).click();
  await waitFor(() => !!document.querySelector('[role="menuitem"]'));
  const text = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent?.includes('Captured context'))!;
  text.click();
  await waitFor(() => document.body.textContent!.includes('Captured body'));
  await waitFor(() => getComputedStyle(document.querySelector('.flower-chat-context-preview-window')!).opacity === '1');
  await page.screenshot({ element: surface, path: '__screenshots__/flower-queue-content-desktop.png' });
 });
 it('edits in the shared composer while protecting the ordinary draft', async () => {
  let resolve!: (value: FlowerThreadView) => void;
  const edit = vi.fn<NonNullable<FlowerSurfaceAdapter['editQueuedTurn']>>(() => new Promise<FlowerThreadView>(done => { resolve = done; }));
  const surface = await mount({ editQueuedTurn: edit });
  setText(surface, 'Next ordinary draft');
  (surface.querySelector('[data-flower-queued-turn-edit="queue:first"]') as HTMLButtonElement).click();
  await waitFor(() => (surface.querySelector('.flower-composer textarea') as HTMLTextAreaElement).value === 'Original queued input');
  setText(surface, 'Revised queued input');
  const remove = surface.querySelector<HTMLButtonElement>('[data-reference-kind="queued_reference"] .flower-composer-reference-chip-remove')!;
  remove.click();
  const picker = surface.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(picker, 'files', { configurable: true, value: [new File(['content'], 'notes.txt', { type: 'text/plain' })] });
  picker.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => surface.querySelectorAll('[data-attachment-status="staged_ready"]').length >= 2);
  const save = surface.querySelector<HTMLButtonElement>('[data-flower-primary-action="send"]')!;
  save.click(); save.click();
  await waitFor(() => edit.mock.calls.length === 1);
  const request = edit.mock.calls[0]![2];
  expect(request.prompt).toBe('Revised queued input');
  expect(request.retained_reference_ids).toEqual(['directory', 'text']);
  expect(request.retained_attachment_ids).toEqual(['image-1']);
  expect(request.attachment_ids).toEqual(['new-notes.txt']);
  expect(save.getAttribute('aria-busy')).toBe('true');
  const updated = view(3); const current = { ...updated.current, queue: [{ ...updated.current.queue![0]!, input_fingerprint: 'c'.repeat(64), input: { text: 'Revised queued input' } }] }; resolve({ thread: applyFlowerRuntimeCurrentView(updated.thread, current), current });
  await waitFor(() => (surface.querySelector('.flower-composer textarea') as HTMLTextAreaElement).value === 'Next ordinary draft');
 });
 it('captures attachments and file/directory references immediately during an active run', async () => {
  let accept!: (value: FlowerTurnLaunchReceipt) => void;
  const launch = vi.fn<FlowerSurfaceAdapter['launchTurn']>(() => new Promise(done => { accept = done; }));
  const surface = await mount({ launchTurn: launch, loadMessageAttachment: vi.fn(imageBlob), loadStagedAttachmentPreview: vi.fn(imageBlob),
   getWorkingDirectoryPathContext: vi.fn(async () => pathContext), listWorkingDirectoryEntries: vi.fn(async () => [{ name: 'src', path: '/workspace/src', isDirectory: true, modifiedAt: 1 }, { name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 1 }]) });
  for (const token of ['@main', '@src']) {
   const textarea = setText(surface, token); textarea.focus(); textarea.setSelectionRange(token.length, token.length); textarea.dispatchEvent(new Event('select', { bubbles: true }));
   const selector = '[role="listbox"] [role="option"]';
   await waitFor(() => !!document.querySelector(selector)); (document.querySelector(selector) as HTMLButtonElement).click();
  }
  setText(surface, 'Next queued input');
  const picker = surface.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(picker, 'files', { configurable: true, value: [new File([await imageBlob()], 'new.png', { type: 'image/png' })] }); picker.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => !!surface.querySelector('[data-attachment-status="staged_ready"]'));
  (surface.querySelector('[data-flower-primary-action="send"]') as HTMLButtonElement).click();
  await waitFor(() => launch.mock.calls.length === 1);
  const request = launch.mock.calls[0]![0];
  expect(request.attachment_ids).toEqual(['new-new.png']);
  const row = surface.querySelector<HTMLElement>(`[data-flower-transport-outbox-id="${request.client_request_id}"]`)!;
  expect(row.querySelector('[title="main.ts"]')).not.toBeNull(); expect(row.querySelector('[title="src"]')).not.toBeNull();
  expect(row.querySelector('[data-flower-queued-attachment="new-new.png"]')).not.toBeNull();
  expect(row.querySelector('.animate-spin')).toBeNull();
  await page.viewport(320, 800);
  expect(row.getBoundingClientRect().height).toBe(38);
  expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
  expect((surface.querySelector('.flower-composer textarea') as HTMLTextAreaElement).value).toBe('');
  setText(surface, 'Independent next draft');
  row.querySelector<HTMLButtonElement>('[title="src"]')!.click();
  await waitFor(() => document.querySelector('.flower-chat-context-preview-window')?.textContent?.includes('main.ts') === true);
  document.querySelector<HTMLButtonElement>('.flower-chat-context-preview-window [aria-label="Close"]')!.click();
  await waitFor(() => !document.querySelector('.flower-chat-context-preview-window'));
  accept({ client_request_id: request.client_request_id, thread_id: 'queue-content', current: { ...view(3).current, queue: [...view(3).current.queue!, { id: 'queue-new', request_key: request.client_request_id, input: { text: request.prompt } }] } });
 });
 it('removes an admitted image and adds references while editing on a narrow screen', async () => {
  const edit = vi.fn<NonNullable<FlowerSurfaceAdapter['editQueuedTurn']>>(async () => view(3));
  const surface = await mount({ editQueuedTurn: edit, loadMessageAttachment: vi.fn(imageBlob), getWorkingDirectoryPathContext: vi.fn(async () => pathContext), listWorkingDirectoryEntries: vi.fn(async () => [{ name: 'new-dir', path: '/workspace/new-dir', isDirectory: true, modifiedAt: 1 }]) });
  await page.viewport(390, 800);
  (surface.querySelector('[data-flower-queued-turn-edit="queue:first"]') as HTMLButtonElement).click();
  await waitFor(() => !!surface.querySelector('[data-flower-queue-editor]'));
  (surface.querySelector('.flower-attachment-remove') as HTMLButtonElement).click();
  await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  const textarea = setText(surface, '@new-dir'); textarea.focus(); textarea.setSelectionRange(8,8); textarea.dispatchEvent(new Event('select',{bubbles:true}));
  await waitFor(() => !!surface.querySelector('[data-kind="directory"] [role="option"]'));
  (surface.querySelector('[data-kind="directory"] [role="option"]') as HTMLButtonElement).click();
  setText(surface, 'Edited without image');
  await page.screenshot({ element: surface, path: '__screenshots__/flower-queue-content-narrow.png' });
  const button = surface.querySelector<HTMLButtonElement>('[data-flower-primary-action="send"]')!;
  expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(32);
  const row = surface.querySelector<HTMLElement>('[data-flower-queued-turn-dock-id="queue:first"]')!;
  expect(row.getBoundingClientRect().height).toBe(38);
  expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
  button.click(); await waitFor(() => edit.mock.calls.length === 1);
  expect(edit.mock.calls[0]![2].retained_attachment_ids).toEqual([]);
  expect(edit.mock.calls[0]![2].context_action).toMatchObject({ context: [{ kind: 'file_path', path: '/workspace/new-dir', is_directory: true }] });
 });
 it('keeps an uncertain save identity when returning to the ordinary draft and reopening', async () => {
  const edit = vi.fn<NonNullable<FlowerSurfaceAdapter['editQueuedTurn']>>().mockRejectedValueOnce(Object.assign(new Error('Response lost'), { admission_kind: 'unknown' })).mockResolvedValue(view(3));
  const surface = await mount({ editQueuedTurn: edit });
  setText(surface, 'Ordinary draft');
  (surface.querySelector('[data-flower-queued-turn-edit="queue:first"]') as HTMLButtonElement).click();
  await waitFor(() => !!surface.querySelector('[data-flower-queue-editor]')); setText(surface, 'Frozen edit');
  (surface.querySelector('[data-flower-primary-action="send"]') as HTMLButtonElement).click();
  await waitFor(() => !!surface.querySelector('[data-flower-queue-editor] p'));
  (surface.querySelector('[data-flower-queue-editor] button') as HTMLButtonElement).click();
  await waitFor(() => (surface.querySelector('textarea') as HTMLTextAreaElement).value === 'Ordinary draft');
  (surface.querySelector('[data-flower-queued-turn-edit="queue:first"]') as HTMLButtonElement).click();
  await waitFor(() => (surface.querySelector('textarea') as HTMLTextAreaElement).value === 'Frozen edit');
  expect((surface.querySelector('textarea') as HTMLTextAreaElement).readOnly).toBe(true);
  (surface.querySelector('[data-flower-primary-action="send"]') as HTMLButtonElement).click();
  await waitFor(() => edit.mock.calls.length === 2);
  expect(edit.mock.calls[1]![2]).toEqual(edit.mock.calls[0]![2]);
  await waitFor(() => (surface.querySelector('textarea') as HTMLTextAreaElement).value === 'Ordinary draft');
 });

 it('settles a delayed edit in its original scope after switching conversations', async () => {
  let resolve!: (value: FlowerThreadView) => void;
  const edit = vi.fn<NonNullable<FlowerSurfaceAdapter['editQueuedTurn']>>(() => new Promise(done => { resolve = done; }));
  const other = thread({ thread_id: 'other', title: 'Other conversation' });
  const surface = await mount({ editQueuedTurn: edit, listThreads: async () => [initial, other], loadThread: async id => id === initial.thread_id ? view() : liveBootstrap(other, 2) });
  setText(surface, 'Original ordinary draft');
  (surface.querySelector('[data-flower-queued-turn-edit="queue:first"]') as HTMLButtonElement).click();
  await waitFor(() => !!surface.querySelector('[data-flower-queue-editor]'));
  setText(surface, 'Saved queue edit');
  (surface.querySelector('[data-flower-primary-action="send"]') as HTMLButtonElement).click();
  await waitFor(() => edit.mock.calls.length === 1);
  (surface.querySelector('[data-thread-id="other"] .flower-thread-card-select-button') as HTMLButtonElement).click();
  await waitFor(() => !surface.querySelector('[data-flower-queue-editor]'));
  const textarea = setText(surface, 'Other draft');
  resolve(view(3));
  await waitFor(() => !surface.querySelector('[aria-busy="true"].flower-composer-submit'));
  expect(textarea.value).toBe('Other draft');
  expect(document.activeElement).toBe(textarea);
  (surface.querySelector('[data-thread-id="queue-content"] .flower-thread-card-select-button') as HTMLButtonElement).click();
  await waitFor(() => (surface.querySelector('textarea') as HTMLTextAreaElement).value === 'Original ordinary draft');
 });

 it('previews a canonical directory in a floating window through the Desktop resolver', async () => {
  const resolve = vi.fn<NonNullable<FlowerSurfaceAdapter['resolveCanonicalReference']>>(async () => ({ kind: 'directory', label: 'src', path: '/workspace/src' }));
  const surface = await mount({ resolveCanonicalReference: resolve, listWorkingDirectoryEntries: vi.fn(async () => [
   { name: 'nested', path: '/workspace/src/nested', isDirectory: true, modifiedAt: 1 },
   { name: 'main.ts', path: '/workspace/src/main.ts', isDirectory: false, modifiedAt: 1 },
  ]) });
  const directory = surface.querySelector<HTMLButtonElement>('[data-flower-queued-reference="reference:directory"]')
   ?? [...surface.querySelectorAll<HTMLButtonElement>('.flower-queue-preview')].find(button => button.title === 'src');
  expect(directory).toBeDefined(); directory!.click();
  await waitFor(() => document.querySelector('.flower-chat-context-preview-window')?.textContent?.includes('nested/') === true);
  expect(document.querySelector('.flower-chat-context-preview-window')!.textContent).toContain('main.ts');
  expect(resolve).toHaveBeenCalledWith({ thread_id: 'queue-content', queue_id: 'queue:first', reference_id: 'directory' });
 });

 it('saves slash-prefixed text as an edit and never stops when the edit is empty', async () => {
  const edit = vi.fn<NonNullable<FlowerSurfaceAdapter['editQueuedTurn']>>(async () => view(3));
  const stop = vi.fn<FlowerSurfaceAdapter['stopThread']>();
  const compact = vi.fn<NonNullable<FlowerSurfaceAdapter['compactThreadContext']>>();
  const surface = await mount({ editQueuedTurn: edit, stopThread: stop, compactThreadContext: compact });
  surface.querySelector<HTMLButtonElement>('[data-flower-queued-turn-edit="queue:first"]')!.click();
  await waitFor(() => !!surface.querySelector('[data-flower-queue-editor]'));
  for (const button of [...surface.querySelectorAll<HTMLButtonElement>('.flower-composer-reference-chip-remove, .flower-attachment-remove')]) button.click();
  setText(surface, '');
  await waitFor(() => surface.querySelector<HTMLButtonElement>('[data-flower-primary-action="send"]')!.disabled);
  surface.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(stop).not.toHaveBeenCalled(); expect(edit).not.toHaveBeenCalled();
  const textarea = setText(surface, '/compact literal queued input');
  expect(surface.querySelector('.flower-composer-command-menu')).toBeNull();
  textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await waitFor(() => edit.mock.calls.length === 1);
  expect(edit.mock.calls[0]![2].prompt).toBe('/compact literal queued input');
  expect(compact).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
 });

 it('resumes the same uncertain edit after the canonical queue item has left the queue', async () => {
  let removed = false;
  const other = thread({ thread_id: 'other', title: 'Other conversation' });
  const withoutQueue = () => {
   const result = view(3); const current = { ...result.current, queue: [] };
   return { thread: applyFlowerRuntimeCurrentView({ ...result.thread, updated_at_ms: 3 }, current), current };
  };
  const edit = vi.fn<NonNullable<FlowerSurfaceAdapter['editQueuedTurn']>>().mockRejectedValueOnce(new Error('Response lost')).mockImplementation(async () => withoutQueue());
  const surface = await mount({ editQueuedTurn: edit, listThreads: async () => [removed ? withoutQueue().thread : initial, other],
   loadThread: async id => id === other.thread_id ? liveBootstrap(other, 2) : removed ? withoutQueue() : view() });
  setText(surface, 'Ordinary draft');
  surface.querySelector<HTMLButtonElement>('[data-flower-queued-turn-edit="queue:first"]')!.click();
  await waitFor(() => !!surface.querySelector('[data-flower-queue-editor]'));
  setText(surface, 'Frozen uncertain edit');
  surface.querySelector<HTMLButtonElement>('[data-flower-primary-action="send"]')!.click();
  await waitFor(() => !!surface.querySelector('[data-flower-queue-editor] p'));
  surface.querySelector<HTMLButtonElement>('[data-flower-queue-editor] button')!.click();
  removed = true;
  surface.querySelector<HTMLButtonElement>('[data-thread-id="other"] .flower-thread-card-select-button')!.click();
  await waitFor(() => !!surface.querySelector('[data-flower-selected-thread-id="other"]'));
  surface.querySelector<HTMLButtonElement>('[aria-label="Refresh conversations"]')!.click();
  surface.querySelector<HTMLButtonElement>('[data-thread-id="queue-content"] .flower-thread-card-select-button')!.click();
  await waitFor(() => !!surface.querySelector('[data-flower-queue-editor-resume="queue:first"]'));
  expect(surface.querySelector('[data-flower-queued-turn-dock-id="queue:first"]')).toBeNull();
  surface.querySelector<HTMLButtonElement>('[data-flower-queue-editor-resume="queue:first"]')!.click();
  await waitFor(() => surface.querySelector<HTMLTextAreaElement>('textarea')!.value === 'Frozen uncertain edit');
  expect(surface.querySelector<HTMLTextAreaElement>('textarea')!.readOnly).toBe(true);
  surface.querySelector<HTMLButtonElement>('[data-flower-primary-action="send"]')!.click();
  await waitFor(() => edit.mock.calls.length === 2);
  expect(edit.mock.calls[1]![2]).toEqual(edit.mock.calls[0]![2]);
  await waitFor(() => surface.querySelector<HTMLTextAreaElement>('textarea')!.value === 'Ordinary draft');
  expect(surface.querySelector('[data-flower-queue-editor-resume]')).toBeNull();
 });

});
