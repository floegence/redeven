import '../index.css';
import './flower-feature.css';
import { ThemeProvider } from '@floegence/floe-webapp-core';
import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import { parseAskFlowerContextActionEnvelope, type ContextActionEnvelope } from '../../../../flower_ui/src/contextActionWire';
import type { FlowerAttachmentCapability, FlowerSurfaceAdapter } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { FlowerContextSnapshotPreview } from './widgets/FlowerContextPreviewWindow';
import { createEnvLocalFlowerSurfaceAdapter } from './flower/envLocalFlowerSurfaceAdapter';
import { adapter, deferred, inputRequest, launchReceipt, liveBootstrap, renderSurfaceWithAdapter, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

function referenceAdapter() {
  const source = adapter(true);
  return { ...source, loadThread: vi.fn(async (id: string) => {
    const snapshot = (await source.listThreads()).find(item => item.thread_id === id);
    if (!snapshot) throw new Error('Not found');
    return liveBootstrap(snapshot);
  }) };
}

async function reference(surface: HTMLElement, threadID: string, mode: 'more' | 'right' | 'keyboard' = 'more') {
  await waitFor(() => !surface.querySelector('[data-flower-pending-thread-id]') && surface.querySelector('[data-flower-selected-thread-loading]')?.getAttribute('data-flower-selected-thread-loading') === 'false');
  const row = surface.querySelector<HTMLElement>(`[data-thread-id="${threadID}"]`)!;
  if (mode === 'more') await userEvent.click(row.querySelector<HTMLButtonElement>('.flower-thread-card-menu-button')!);
  else if (mode === 'right') row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 120 }));
  else { row.querySelector<HTMLButtonElement>('.flower-thread-card-select-button')!.focus(); await userEvent.keyboard('{Shift>}{F10}{/Shift}'); }
  await waitFor(() => Boolean(document.querySelector('[role="menu"]')));
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(item => item.textContent?.includes('Reference'))!;
  return button;
}

describe('Flower thread references', () => {
  it('sends an Env App local reference through the real HTTP adapter and consumes it only after acceptance', async () => {
    const runtimeAdapter = createEnvLocalFlowerSurfaceAdapter({ envPublicID: 'env_local', envLabel: 'Local', rpc: { ai: {} } as never });
    const requests: { client_request_id: string; input: { context_action: ContextActionEnvelope } }[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.method !== 'POST') return new Response('{}', { status: 404 });
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      if (body.input.context_action.context[0].thread.runtime_id !== 'env:local-environment') {
        return new Response(JSON.stringify({ ok: false, error: 'read permission denied' }), { status: 403 });
      }
      return new Response(JSON.stringify({ client_request_id: body.client_request_id, thread_id: 'thread-1' }));
    });
    try {
      await page.viewport(1280, 900);
      const source = { ...referenceAdapter(), runtime: runtimeAdapter.runtime, launchTurn: runtimeAdapter.launchTurn };
      const surface = renderSurfaceWithAdapter(source);
      await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"]')));
      await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] .flower-thread-card-select-button')!);
      await waitFor(() => Boolean(surface.querySelector('textarea:not(:disabled)')) && surface.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === 'thread-1' && surface.querySelector('[data-flower-selected-thread-loading]')?.getAttribute('data-flower-selected-thread-loading') === 'false');
      await userEvent.click(await reference(surface, 'thread-2', 'right'));
      const editor = surface.querySelector<HTMLTextAreaElement>('textarea')!;
      await userEvent.fill(editor, 'What did this conversation investigate?');
      await userEvent.keyboard('{Enter}');
      await expect.poll(() => ({ sent: requests.length,
        error: surface.querySelector('[data-flower-transport-delivery="failed"]')?.getAttribute('title') ?? '' })).toEqual({ sent: 1, error: '' });
      expect(requests[0]!.input.context_action.context[0]).toMatchObject({ kind: 'thread_reference',
        thread: { runtime_id: 'env:local-environment', thread_id: 'thread-2' } });
      await expect.poll(() => surface.querySelector('[data-reference-kind="thread"]')).toBeNull();
      expect(editor.value).toBe('');
    } finally { fetch.mockRestore(); }
  });

  it('adds to the current draft through all menu entries, deduplicates and allows self-reference', async () => {
    await page.viewport(1280, 900);
    const source = referenceAdapter(), surface = renderSurfaceWithAdapter(source);
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"]')));
    await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] .flower-thread-card-select-button')!);
    await waitFor(() => Boolean(surface.querySelector('textarea:not(:disabled)')) && surface.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === 'thread-1' && surface.querySelector('[data-flower-selected-thread-loading]')?.getAttribute('data-flower-selected-thread-loading') === 'false');
    const editor = surface.querySelector<HTMLTextAreaElement>('textarea')!;
    await userEvent.fill(editor, 'Retained draft 中文');
    for (const mode of ['more', 'right', 'keyboard'] as const) await userEvent.click(await reference(surface, 'thread-2', mode));
    expect(surface.querySelectorAll('[data-reference-kind="thread"]')).toHaveLength(1);
    expect(surface.querySelector('[data-thread-id="thread-1"]')?.getAttribute('data-flower-thread-active')).toBe('true');
    expect(editor.value).toBe('Retained draft 中文');
    expect(document.activeElement).toBe(editor);
    await userEvent.click(await reference(surface, 'thread-1'));
    expect(surface.querySelectorAll('[data-reference-kind="thread"]')).toHaveLength(2);
    const removals = surface.querySelectorAll<HTMLButtonElement>('[data-reference-kind="thread"] .flower-composer-reference-chip-remove');
    await userEvent.click(removals[0]!);
    await expect.poll(() => document.activeElement).toBe(removals[1]);
    await userEvent.click(removals[1]!);
    await expect.poll(() => document.activeElement).toBe(editor);
    expect(source.launchTurn).not.toHaveBeenCalled();
  });

  it('sends a reference-only new draft with exactly the frozen basic snapshot', async () => {
    await page.viewport(1280, 900);
    const source = referenceAdapter(), surface = renderSurfaceWithAdapter(source);
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-2"]')));
    await userEvent.click(await reference(surface, 'thread-2'));
    const editor = surface.querySelector<HTMLTextAreaElement>('textarea')!;
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => vi.mocked(source.launchTurn).mock.calls.length).toBe(1);
    const input = vi.mocked(source.launchTurn).mock.calls[0]![0];
    expect(input.prompt).toBe('');
    const item = parseAskFlowerContextActionEnvelope(input.context_action)?.context[0];
    expect(item).toEqual({ kind: 'thread_reference', thread: {
      runtime_id: source.runtime.runtime_id, thread_id: 'thread-2', title: 'Review branch', status: 'idle',
      working_dir: '/workspace/redeven', created_at_ms: 1, updated_at_ms: 3, captured_at_ms: expect.any(Number),
    } });
    await expect.poll(() => surface.querySelector('[data-reference-kind="thread"]')).toBeNull();
    expect(editor.value).toBe('');
  });

  it('previews at narrow width, restores focus and preserves the current draft when opening fails', async () => {
    await page.viewport(1280, 850);
    const source = referenceAdapter();
    const load = vi.fn(source.loadThread);
    const surface = renderSurfaceWithAdapterProps({ ...source, loadThread: load }, {
      layout: true, renderContextSnapshotPreview: props => <ThemeProvider><FlowerContextSnapshotPreview {...props} /></ThemeProvider>,
    });
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-2"]')));
    await userEvent.click(await reference(surface, 'thread-2'));
    const editor = surface.querySelector<HTMLTextAreaElement>('textarea')!;
    await userEvent.fill(editor, 'Keep my draft');
    await page.viewport(360, 850);
    const opener = surface.querySelector<HTMLButtonElement>('.flower-composer-reference-chip-preview')!;
    await userEvent.click(opener);
    await waitFor(() => Boolean(document.querySelector('.flower-context-preview-window')));
    const bounds = document.querySelector('.flower-context-preview-window')!.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(360);
    load.mockRejectedValueOnce(new Error('Not found'));
    await userEvent.click(page.getByRole('button', { name: 'Open conversation', exact: true }));
    await expect.poll(() => document.body.textContent).toContain('This conversation is unavailable or you no longer have read access.');
    expect(editor.value).toBe('Keep my draft');
    expect(surface.querySelectorAll('[data-flower-thread-active="true"]')).toHaveLength(0);
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('.flower-context-preview-window')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(surface.querySelector('[data-reference-kind="thread"]')).not.toBeNull();
  });

  it('keeps text, files and frozen references after failure, then consumes the unchanged retry', async () => {
    await page.viewport(1280, 900);
    const source = referenceAdapter(); vi.mocked(source.launchTurn).mockRejectedValueOnce(flowerTurnAdmissionError('not_sent', new Error('Transport unavailable')));
    const capability: FlowerAttachmentCapability = { model_id: 'openai/gpt-5.2', revision: 'thread-ref-capability', enabled: true, supports_long_text: true, max_attachments: 4, max_file_size_bytes: 1000000, max_total_size_bytes: 2000000, routes: { 'text/plain': 'tool_read' } };
    const uploadAttachment = vi.fn(async (input: Parameters<NonNullable<FlowerSurfaceAdapter['uploadAttachment']>>[0]) => ({ attachment_id: 'upl_thread_ref', name: input.file.name, mime_type: input.file.type, size_bytes: input.file.size, digest_sha256: 'e'.repeat(64), locator: 'attachment://v1/upl_thread_ref/notes.txt', source: input.source, capability_revision: capability.revision }));
    const surface = renderSurfaceWithAdapter({ ...source, loadAttachmentCapability: vi.fn(async () => capability), uploadAttachment });
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-2"]')));
    await userEvent.click(await reference(surface, 'thread-2'));
    const editor = surface.querySelector<HTMLTextAreaElement>('textarea')!;
    const picker = surface.querySelector<HTMLInputElement>('input[type="file"]')!;
    const transfer = new DataTransfer(); transfer.items.add(new File(['Keep file contents'], 'notes.txt', { type: 'text/plain' }));
    Object.defineProperty(picker, 'files', { configurable: true, value: transfer.files }); picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => Boolean(surface.querySelector('[data-attachment-status="staged_ready"]')));
    await userEvent.fill(editor, 'Keep on failure'); await userEvent.keyboard('{Enter}');
    await waitFor(() => vi.mocked(source.launchTurn).mock.calls.length === 1);
    await expect.poll(() => editor.value).toBe('Keep on failure');
    expect(surface.querySelector('[data-reference-kind="thread"]')).not.toBeNull();
    await waitFor(() => Boolean(surface.querySelector('[data-attachment-status="staged_ready"]')));
    await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-flower-transport-delivery="failed"] [aria-label="Retry send"]')!);
    await waitFor(() => vi.mocked(source.launchTurn).mock.calls.length === 2);
    expect(vi.mocked(source.launchTurn).mock.calls[1]![0]).toEqual(vi.mocked(source.launchTurn).mock.calls[0]![0]);
    await expect.poll(() => editor.value).toBe('');
    await expect.poll(() => surface.querySelector('[data-reference-kind="thread"]')).toBeNull();
    expect(surface.querySelector('[data-attachment-status="staged_ready"]')).toBeNull();
  });

  it('retains a disabled explanation during questions while navigation stays available', async () => {
    await page.viewport(1280, 900);
    const waiting = thread({ status: 'waiting_user', input_request: inputRequest() });
    const source = referenceAdapter();
    vi.mocked(source.listThreads).mockResolvedValue([waiting, thread({ thread_id: 'thread-2', title: 'Review branch', updated_at_ms: 3 })]);
    const surface = renderSurfaceWithAdapter(source);
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"]')));
    await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] .flower-thread-card-select-button')!);
    await waitFor(() => Boolean(surface.querySelector('[data-flower-input-question]') || surface.textContent?.includes('Continue')));
    const item = await reference(surface, 'thread-2');
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.title).toBe('Finish answering the question before adding references.');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-2"] .flower-thread-card-select-button')!);
    await waitFor(() => surface.querySelector('[data-thread-id="thread-2"]')?.getAttribute('data-flower-thread-active') === 'true');
  });

  it.each([false, true])('does not navigate after a pending preview closes (Env host=%s)', async envHost => {
    await page.viewport(1280, 900);
    const source = referenceAdapter(), pending = deferred<Awaited<ReturnType<typeof source.loadThread>>>();
    const surface = envHost ? renderSurfaceWithAdapterProps(source, { layout: true, renderContextSnapshotPreview: props => <ThemeProvider><FlowerContextSnapshotPreview {...props} /></ThemeProvider> }) : renderSurfaceWithAdapter(source);
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-2"]')));
    await userEvent.click(await reference(surface, 'thread-2'));
    await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-composer-reference-chip-preview')!);
    vi.mocked(source.loadThread).mockReturnValueOnce(pending.promise);
    await userEvent.click(page.getByRole('button', { name: 'Open conversation', exact: true }));
    await waitFor(() => source.loadThread.mock.calls.some(([id]) => id === 'thread-2'));
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('.flower-chat-context-preview-window, .flower-context-preview-window')).toBeNull();
    pending.resolve(liveBootstrap(thread({ thread_id: 'thread-2', title: 'Review branch', updated_at_ms: 3 })));
    await expect.poll(() => surface.querySelectorAll('[data-flower-thread-active="true"]').length).toBe(0);
    expect(surface.querySelector('[data-reference-kind="thread"]')).not.toBeNull();
  });

  it('checks readability before navigating and restores the original draft when returning', async () => {
    await page.viewport(1280, 900);
    const source = referenceAdapter(), surface = renderSurfaceWithAdapter(source);
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"]')));
    await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] .flower-thread-card-select-button')!);
    await waitFor(() => Boolean(surface.querySelector('textarea:not(:disabled)')) && surface.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === 'thread-1' && surface.querySelector('[data-flower-selected-thread-loading]')?.getAttribute('data-flower-selected-thread-loading') === 'false');
    await userEvent.fill(surface.querySelector<HTMLTextAreaElement>('textarea')!, 'Draft in original conversation');
    await userEvent.click(await reference(surface, 'thread-2'));
    await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-composer-reference-chip-preview')!);
    await userEvent.click(page.getByRole('button', { name: 'Open conversation', exact: true }));
    await waitFor(() => surface.querySelector('[data-thread-id="thread-2"]')?.getAttribute('data-flower-thread-active') === 'true');
    expect(source.loadThread).toHaveBeenCalledWith('thread-2', expect.any(AbortSignal));
    await waitFor(() => surface.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === 'thread-2');
    expect(surface.querySelector('textarea')!.value).toBe('');
    await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] .flower-thread-card-select-button')!);
    await expect.poll(() => surface.querySelector('textarea')!.value).toBe('Draft in original conversation');
    expect(surface.querySelector('[data-reference-kind="thread"]')).not.toBeNull();
  });

  it('keeps a historical snapshot readable and closable after its source is deleted', async () => {
    await page.viewport(1280, 900);
    const source = referenceAdapter();
    const snapshot = { runtime_id: source.runtime.runtime_id, thread_id: 'deleted-thread', title: 'Historical title', status: 'idle', working_dir: '/workspace', created_at_ms: 1, updated_at_ms: 2, captured_at_ms: 3 };
    const target = thread({ messages: [{ id: 'historic-user', turn_id: 'turn-1', role: 'user', content: 'Inspect this', status: 'complete', created_at_ms: 1,
      references: [{ reference_id: 'thread-ref', kind: 'thread', referenced_thread_id: snapshot.thread_id, label: snapshot.title, text: JSON.stringify(snapshot) }] }] });
    vi.mocked(source.listThreads).mockResolvedValue([target]);
    const surface = renderSurfaceWithAdapter(source);
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"]')));
    await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] .flower-thread-card-select-button')!);
    await waitFor(() => Boolean(surface.querySelector('[data-flower-chat-context-chip="true"]')));
    const chip = surface.querySelector<HTMLButtonElement>('[data-flower-chat-context-chip="true"]')!;
    await userEvent.click(chip);
    await userEvent.click(page.getByRole('button', { name: 'Open conversation', exact: true }));
    await expect.poll(() => document.body.textContent).toContain('This conversation is unavailable or you no longer have read access.');
    expect(document.body.textContent).toContain('Historical title');
    expect(surface.querySelector('[data-thread-id="thread-1"]')?.getAttribute('data-flower-thread-active')).toBe('true');
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.activeElement).toBe(chip);
  });

  it('consumes queued references immediately and preserves later references at confirmation', async () => {
    await page.viewport(1280, 900);
    const source = referenceAdapter(), pending = deferred<Awaited<ReturnType<typeof source.launchTurn>>>();
    const running = thread({ status: 'running' });
    vi.mocked(source.listThreads).mockResolvedValue([running, thread({ thread_id: 'thread-2', title: 'Review branch', updated_at_ms: 3 })]);
    vi.mocked(source.launchTurn).mockReturnValueOnce(pending.promise);
    const surface = renderSurfaceWithAdapter(source);
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"]')));
    await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] .flower-thread-card-select-button')!);
    await waitFor(() => Boolean(surface.querySelector('textarea:not(:disabled)')) && surface.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === 'thread-1' && surface.querySelector('[data-flower-selected-thread-loading]')?.getAttribute('data-flower-selected-thread-loading') === 'false');
    await userEvent.click(await reference(surface, 'thread-2'));
    const editor = surface.querySelector<HTMLTextAreaElement>('textarea')!;
    await userEvent.fill(editor, 'Queued reference'); await userEvent.keyboard('{Enter}');
    await waitFor(() => vi.mocked(source.launchTurn).mock.calls.length === 1);
    expect(surface.querySelectorAll('[data-reference-kind="thread"]')).toHaveLength(0);
    await userEvent.fill(editor, 'New draft stays');
    await userEvent.click(await reference(surface, 'thread-1'));
    const input = vi.mocked(source.launchTurn).mock.calls[0]![0];
    const receipt = launchReceipt('thread-1', 'queue-reference', 'queued', input.client_request_id);
    pending.resolve({ ...receipt, current: { ...receipt.current, view_version: 2, run_progress: { phase: 'streaming' }, turn_id: 'turn-1', run_id: running.active_run_id, queue: [{ id: 'queue-reference', request_key: input.client_request_id, input: { text: input.prompt } }] } });
    await expect.poll(() => surface.querySelectorAll('[data-reference-kind="thread"]').length).toBe(1);
    expect(surface.querySelector('[data-reference-kind="thread"]')!.textContent).toContain('Deploy plan');
    expect(editor.value).toBe('New draft stays');
  });

  it.each(['approval', 'readonly'] as const)('explains why reference editing is disabled in %s state', async kind => {
    await page.viewport(1280, 900);
    const source = referenceAdapter();
    const selected = kind === 'readonly' ? thread({ read_only_reason: 'View only' }) : thread({ status: 'waiting_approval', approval_actions: [{
      action_id: 'approval-entry', origin: 'main_tool', run_id: 'run-entry', tool_id: 'tool-entry', tool_name: 'terminal.exec', state: 'requested', status: 'pending', requested_at_ms: 1, can_approve: true, surface_role: 'primary_action', summary: { label: 'Review command', command: 'pwd' },
    }] });
    vi.mocked(source.listThreads).mockResolvedValue([selected, thread({ thread_id: 'thread-2', title: 'Review branch', updated_at_ms: 3 })]);
    const surface = renderSurfaceWithAdapter(source);
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"]')));
    await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] .flower-thread-card-select-button')!);
    await waitFor(() => kind === 'readonly' ? Boolean(surface.querySelector('textarea:disabled')) : Boolean(surface.querySelector('.flower-composer-approval-decision')));
    const item = await reference(surface, 'thread-2');
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.title).toBe(kind === 'readonly' ? 'This composer is read-only.' : 'Resolve the approval before adding references.');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-2"] .flower-thread-card-select-button')!);
    await waitFor(() => surface.querySelector('[data-thread-id="thread-2"]')?.getAttribute('data-flower-thread-active') === 'true');
  });

  it('allows reference edits and navigation while ordinary request preparation is pending', async () => {
    await page.viewport(1280, 900);
    const source = referenceAdapter(), generation = deferred<string>();
    const surface = renderSurfaceWithAdapter({ ...source, resolveStorageGeneration: () => generation.promise });
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-2"]')));
    await userEvent.click(await reference(surface, 'thread-2'));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => surface.querySelector('[data-flower-primary-action="send"]')?.getAttribute('aria-busy') === 'true');
    const item = await reference(surface, 'thread-1');
    expect(item.getAttribute('aria-disabled')).not.toBe('true');
    expect(surface.querySelector<HTMLButtonElement>('.flower-composer-reference-chip-remove')!.disabled).toBe(false);
    await userEvent.click(item);
    await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-composer-reference-chip-remove')!);
    expect(surface.querySelector('[data-reference-kind="thread"]')!.textContent).toContain('Deploy plan');
    await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] .flower-thread-card-select-button')!);
    await waitFor(() => surface.querySelector('[data-thread-id="thread-1"]')?.getAttribute('data-flower-thread-active') === 'true');
    generation.resolve('a'.repeat(32));
    await waitFor(() => vi.mocked(source.launchTurn).mock.calls.length === 1);
    expect(surface.querySelector('[data-thread-id="thread-1"]')?.getAttribute('data-flower-thread-active')).toBe('true');
  });
});

it('releases a reference preflight on close and cannot navigate from its late result', async () => {
  await page.viewport(1280, 900);
  const source = referenceAdapter();
  const snapshot = { runtime_id: source.runtime.runtime_id, thread_id: 'thread-2', title: 'Captured source', status: 'idle', working_dir: '/workspace', created_at_ms: 1, updated_at_ms: 2, captured_at_ms: 3 };
  const target = thread({ messages: [{ id: 'reference-owner', turn_id: 'turn-1', role: 'user', content: 'Inspect reference', status: 'complete', created_at_ms: 1,
    references: [{ reference_id: 'thread-ref', kind: 'thread', referenced_thread_id: snapshot.thread_id, label: snapshot.title, text: JSON.stringify(snapshot) }] }] });
  vi.mocked(source.listThreads).mockResolvedValue([target, thread({ thread_id: 'thread-2' })]);
  const late = deferred<ReturnType<typeof liveBootstrap>>(); let signal!: AbortSignal;
  const loadThread = vi.fn((id: string, readSignal: AbortSignal) => {
    if (id === 'thread-2') { signal = readSignal; return late.promise; }
    return Promise.resolve(liveBootstrap(target));
  });
  const surface = renderSurfaceWithAdapter({ ...source, loadThread });
  await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"]')));
  await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] .flower-thread-card-select-button')!);
  await waitFor(() => Boolean(surface.querySelector('[data-flower-chat-context-chip="true"]')));
  await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-flower-chat-context-chip="true"]')!);
  await userEvent.click(page.getByRole('button', { name: 'Open conversation', exact: true }));
  await waitFor(() => Boolean(signal));
  await userEvent.keyboard('{Escape}');
  expect(signal.aborted).toBe(true);
  late.resolve(liveBootstrap(thread({ thread_id: 'thread-2', title: 'Late source' })));
  await Promise.resolve(); await Promise.resolve();
  expect(surface.querySelector('main')?.getAttribute('data-flower-selected-thread-id')).toBe('thread-1');
  expect(document.querySelector('.flower-chat-context-preview-window')).toBeNull();
});
