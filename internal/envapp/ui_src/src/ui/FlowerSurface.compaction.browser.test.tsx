import '../index.css';
import './flower-feature.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { page, userEvent } from 'vitest/browser';
import { expect, it, vi } from 'vitest';
import type { FlowerRuntimeCurrentView, FlowerThreadSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
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
  const compact = vi.fn((_id: string, _input: { continue_goal?: boolean }) => pending.promise);
  const base = adapter(true);
  const surface = renderSurfaceWithAdapterProps({ ...base, compactThreadContext: compact }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  const input = await enterCommand(surface, command);
  await waitFor(() => compact.mock.calls.length === 1);
  expect(surface.querySelector('.flower-composer-command-menu')).not.toBeNull();
  expect(input.value).toBe(command);
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  expect(compact).toHaveBeenCalledTimes(1);
  expect(compact.mock.calls[0]?.[1]).toMatchObject({ continue_goal: true });
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
      render: parts => <div class="tessiven-flower-output" style={{ height: '100%' }}><div class="tessiven-flower-chat flower-surface flower-surface-companion">
        <div class="flower-chat-main" data-flower-action-layout={parts.actionLayout()}>
          <div class="tessiven-flower-conversation">{parts.conversation}</div>
          <div class="tessiven-flower-composer">{parts.composer}</div>
        </div>
      </div></div> },
    engaged: true, transcriptVisible: true,
  });
  surface.classList.add('tessiven-flower-canvas');
  surface.style.cssText = 'height:800px;width:980px;position:relative';
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  await waitFor(() => {
    const owner = surface.querySelector<HTMLElement>('[data-flower-selected-thread-id]');
    return owner?.dataset.flowerSelectedThreadId === 'thread-1' && owner.dataset.flowerSelectedThreadLoading === 'false' && !owner.dataset.flowerPendingThreadId;
  }, 10000);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const input = await enterCommand(surface, '/com');
  await waitFor(() => compact.mock.calls.length === 1);
  expect(base.launchTurn).not.toHaveBeenCalled();
  expect(compact.mock.calls[0]![0]).toBe('thread-1');
  expect(Object.keys(compact.mock.calls[0]![1]).sort()).toEqual(['client_request_id', 'continue_goal', 'storage_generation']);
  input.value = 'Keep this draft';
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'Keep this draft' }));
  pending.resolve(accepted());
  await waitFor(() => input.value === 'Keep this draft');
  expect(surface.querySelector('[data-testid="canvas-reference"]')?.textContent).toBe('Orders API');
  expect(input.disabled).toBe(false);
  expect(surface.querySelector('.flower-composer-command-menu')).toBeNull();
  expect(input.getBoundingClientRect().width).toBeGreaterThan(100);
  expect(input.getBoundingClientRect().height).toBeGreaterThan(20);
  await page.screenshot({ element: input, path: '__screenshots__/redeven-compaction-canvas.png' });
});

it.each(['/compact', '/com'])('keeps navigation available and clears only accepted command %j', async command => {
  const pending = deferred<FlowerRuntimeCurrentView>();
  const compact = vi.fn((_id: string, _input: { continue_goal?: boolean }) => pending.promise);
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
  const intents: unknown[] = [];
  const compact = vi.fn(async (_id: string, input: { client_request_id: string; storage_generation: string }) => {
    keys.push(input.client_request_id);
    intents.push((input as { continue_goal?: boolean }).continue_goal);
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
  expect(intents).toEqual([true, true]);
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

function failedCompaction(status: 'failed' | 'cancelled', divider = true) {
  const operation = { operation_id: 'compact-old', turn_id: 'compact-turn', run_id: 'compact-run', canonical_ordinal: 2,
    phase: 'complete' as const, status, error: 'provider request timeout (output_idle)', updated_at_ms: 2 };
  const snapshot = thread({ status: status === 'cancelled' ? 'idle' : 'failed',
    current_execution: { turn_id: 'compact-turn', run_id: 'compact-run', status: status === 'cancelled' ? 'idle' : 'failed', turn_kind: 'context_compaction' },
    context_compactions: divider ? [operation] : [],
    timeline_decorations: divider ? [{ decoration_id: 'compact-old', kind: 'context_compaction', ordinal: 2,
      anchor: { target_kind: 'message', message_id: 'm1', edge: 'after' }, compaction: operation }] : [],
    error: status === 'failed' ? { code: 'provider_request_timeout', message: 'Timed out' } : undefined,
  });
  return snapshot;
}
function compactionView(snapshot: FlowerThreadSnapshot) {
  const value = liveBootstrap(snapshot);
  return { ...value, context_compactions: snapshot.context_compactions, timeline_decorations: snapshot.timeline_decorations, current: { ...value.current, view_version: snapshot.status === 'success' ? 100 : 0, turn_kind: 'context_compaction' as const, turn_id: 'compact-turn', run_id: 'compact-run' } };
}
it.each(['failed', 'cancelled'] as const)('preflights %s compaction once and keeps retry beside its status', async status => {
  const snapshot = failedCompaction(status);
  const refresh = deferred<ReturnType<typeof compactionView>>();
  let loads = 0;
  let preflight = false;
  const compact = vi.fn(async () => accepted());
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [snapshot],
    loadThread: vi.fn(async () => preflight ? (loads++, refresh.promise) : compactionView(snapshot)),
    compactThreadContext: compact }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('.flower-compaction-divider')), 10000);
  const retry = surface.querySelector<HTMLButtonElement>('.flower-compaction-divider button')!;
  expect(retry.getAttribute('aria-label')).toBe('Retry compression');
  expect(retry.textContent).toBe('');
  expect(retry.closest('.flower-compaction-divider-center')).toBe(surface.querySelector('.flower-compaction-divider-pill')?.parentElement);
  preflight = true;
  retry.click(); retry.click();
  await waitFor(() => loads === 1);
  expect(retry.disabled).toBe(true);
  expect(retry.getAttribute('aria-label')).toBe('Retrying compression…');
  expect(compact).not.toHaveBeenCalled();
  expect(surface.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(false);
  refresh.resolve(compactionView(snapshot));
  await waitFor(() => compact.mock.calls.length === 1);
});

it.each(['permission', 'navigation', 'completed', 'read_failure'] as const)('releases compaction recovery after %s without submitting a stale request', async change => {
  const snapshot = failedCompaction('failed');
  const refreshed = deferred<ReturnType<typeof compactionView>>();
  let preflight = false;
  let canMutate = true;
  const compact = vi.fn(async () => accepted());
  const load = vi.fn(async (id: string) => id !== 'thread-1' ? liveBootstrap(thread({ thread_id: id }))
    : preflight ? refreshed.promise : compactionView(snapshot));
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), get canMutate() { return canMutate; },
    listThreads: async () => [snapshot, thread({ thread_id: 'thread-2', title: 'Review branch' })], loadThread: load,
    compactThreadContext: compact }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('.flower-compaction-divider-retry')), 10000);
  const retry = surface.querySelector<HTMLButtonElement>('.flower-compaction-divider-retry')!;
  preflight = true;
  retry.click();
  await waitFor(() => retry.disabled);
  if (change === 'permission') canMutate = false;
  if (change === 'navigation') {
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-2"] button')));
    surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-2"] button')!.click();
    await waitFor(() => surface.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === 'thread-2');
  }
  if (change === 'read_failure') refreshed.reject(new Error('Read unavailable'));
  else refreshed.resolve(compactionView(change === 'completed' ? { ...snapshot, status: 'success', error: undefined,
    current_execution: undefined, context_compactions: snapshot.context_compactions?.map(item => ({ ...item, status: 'compacted' })) } : snapshot));
  await waitFor(() => !surface.textContent?.includes('Retrying compression'));
  expect(compact).not.toHaveBeenCalled();
  expect(surface.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(false);
});

it('retains preparation-failure recovery without a divider and uses a fresh request for another terminal failure', async () => {
  const snapshot = failedCompaction('failed', false);
  const keys: string[] = [];
  const compact = vi.fn(async (_id: string, input: { client_request_id: string; storage_generation: string }) => {
    keys.push(input.client_request_id);
    throw flowerTurnAdmissionError('rejected', new Error('Preparation unavailable'));
  });
  const base = adapter(true);
  const surface = renderSurfaceWithAdapterProps({ ...base, listThreads: async () => [snapshot],
    loadThread: async () => compactionView(snapshot), compactThreadContext: compact }, { focusThreadRequest: focus });
  const retry = () => [...surface.querySelectorAll<HTMLButtonElement>('.flower-run-error button')]
    .find(button => button.textContent === 'Retry compression');
  await waitFor(() => Boolean(retry()), 10000);
  expect(surface.querySelector('.flower-compaction-divider')).toBeNull();
  retry()!.click();
  await waitFor(() => keys.length === 1 && Boolean(retry()) && !retry()!.disabled);
  retry()!.click();
  await waitFor(() => keys.length === 2);
  expect(keys[1]).not.toBe(keys[0]);
  expect(base.retryThread).not.toHaveBeenCalled();
});

it('keeps completed compaction diagnostics without exposing a stale retry', async () => {
  const failed = failedCompaction('failed');
  const snapshot = { ...failed, status: 'success' as const,
    current_execution: { ...failed.current_execution!, status: 'success' as const },
    context_compactions: failed.context_compactions?.map(item => ({ ...item, status: 'compacted' as const })),
    timeline_decorations: failed.timeline_decorations?.map(item => ({ ...item, compaction: { ...item.compaction, status: 'compacted' as const } })),
  };
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [snapshot],
    loadThread: async () => compactionView(snapshot) }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('.flower-compaction-divider')), 10000);
  expect(surface.querySelector('.flower-compaction-divider-retry')).toBeNull();
  expect([...surface.querySelectorAll<HTMLButtonElement>('.flower-run-error button')]
    .some(button => ['Retry reply', 'Retry compression'].includes(button.textContent ?? ''))).toBe(false);
});

it('keeps uncertain retry delivery in the existing outbox until its original identity is resolved', async () => {
  const snapshot = failedCompaction('cancelled');
  const keys: string[] = [];
  const compact = vi.fn(async (_id: string, input: { client_request_id: string; storage_generation: string }) => {
    keys.push(input.client_request_id);
    if (keys.length === 1) throw flowerTurnAdmissionError('unknown', new Error('Connection lost'));
    return accepted();
  });
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [snapshot],
    loadThread: async () => compactionView(snapshot), compactThreadContext: compact }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('.flower-compaction-divider-retry')), 10000);
  surface.querySelector<HTMLButtonElement>('.flower-compaction-divider-retry')!.click();
  await waitFor(() => Boolean(surface.querySelector('[data-flower-transport-delivery="unknown"]')));
  const retry = surface.querySelector<HTMLButtonElement>('.flower-compaction-divider-retry')!;
  expect(retry.disabled).toBe(true);
  expect(retry.getAttribute('aria-label')).toBe('Retry compression');
  surface.querySelector<HTMLButtonElement>('[data-flower-transport-delivery="unknown"] [aria-label="Retry send"]')!.click();
  await waitFor(() => keys.length === 2);
  expect(keys[1]).toBe(keys[0]);
});

it.each([{ theme: 'light', width: 1100 }, { theme: 'dark', width: 1100 }, { theme: 'light', width: 360 }, { theme: 'dark', width: 360 }])('keeps independent status and retry controls accessible in $theme at $width pixels', async ({ theme, width }) => {
  await page.viewport(width, 850);
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.classList.toggle('light', theme === 'light');
  try {
    const snapshot = failedCompaction('cancelled');
    const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [snapshot],
      loadThread: async () => compactionView(snapshot), compactThreadContext: async () => accepted() }, { focusThreadRequest: focus });
    surface.style.cssText = 'height:800px;width:100%;position:relative';
    await waitFor(() => Boolean(surface.querySelector('.flower-compaction-divider-retry')), 10000);
    const divider = surface.querySelector<HTMLElement>('.flower-compaction-divider')!;
    const status = divider.querySelector<HTMLElement>('.flower-compaction-divider-pill')!;
    const retry = divider.querySelector<HTMLButtonElement>('button')!;
    expect(status.contains(retry)).toBe(false);
    await userEvent.hover(retry);
    await waitFor(() => [...document.querySelectorAll('[role="tooltip"]')].some(tooltip => tooltip.textContent === 'Retry compression'));
    await userEvent.unhover(retry);
    await waitFor(() => !document.querySelector('[role="tooltip"]'));
    status.focus();
    await waitFor(() => Boolean(document.querySelector('[role="tooltip"]')));
    await userEvent.keyboard('{Escape}{Tab}');
    expect(document.activeElement).toBe(retry);
    expect(getComputedStyle(retry).outlineStyle).not.toBe('none');
    expect(divider.scrollWidth).toBeLessThanOrEqual(divider.clientWidth + 1);
    const a = status.getBoundingClientRect(); const b = retry.getBoundingClientRect();
    expect(Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2)).toBeLessThan(2);
    expect(b.left).toBeGreaterThanOrEqual(a.right);
    expect(b.left - a.right).toBeLessThan(8);
    expect(getComputedStyle(retry).cursor).toBe('pointer');
    await waitFor(() => [...document.querySelectorAll('[role="tooltip"]')].some(tooltip => tooltip.textContent === 'Retry compression'));
    retry.blur();
    await page.screenshot({ element: surface, path: '__screenshots__/compaction-retry-' + theme + '-' + width + '.png' });
  } finally { document.documentElement.classList.remove('dark', 'light'); }
});

it.each(['pointer', 'keyboard'])('offers pure compaction through the same command menu with %s', async method => {
  const compact = vi.fn(async (_id: string, _input: { continue_goal?: boolean }) => accepted());
  const base = adapter(true);
  const surface = renderSurfaceWithAdapterProps({ ...base, compactThreadContext: compact }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  const input = surface.querySelector<HTMLTextAreaElement>('textarea')!;
  input.value = '/compact';
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '/compact' }));
  input.focus();
  await waitFor(() => Boolean(surface.querySelector('[data-flower-compact-only]')));
  expect(surface.textContent).toContain('continue an unfinished Goal');
  if (method === 'pointer') await page.screenshot({ element: surface, path: '__screenshots__/redeven-compaction-command-menu.png' });
  if (method === 'pointer') surface.querySelector<HTMLButtonElement>('[data-flower-compact-only]')!.click();
  else await userEvent.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => compact.mock.calls.length === 1 && input.value === '');
  expect(compact.mock.calls[0]![1].continue_goal).toBe(false);
  expect(base.launchTurn).not.toHaveBeenCalled();
});

it('allows Escape to dismiss an exact compaction command without dispatch', async () => {
  const compact = vi.fn(async () => accepted());
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), compactThreadContext: compact }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  const input = surface.querySelector<HTMLTextAreaElement>('textarea')!;
  input.value = '/compact'; input.dispatchEvent(new InputEvent('input', { bubbles: true })); input.focus();
  await waitFor(() => Boolean(surface.querySelector('[data-flower-compact-only]')));
  await userEvent.keyboard('{Escape}');
  expect(input.value).toBe('');
  expect(surface.querySelector('.flower-composer-command-menu')).toBeNull();
  expect(compact).not.toHaveBeenCalled();
});


it('keeps admitted goal continuation working and exposes Stop without another send', async () => {
  const base = adapter(true);
  const stopThread = vi.fn(async () => undefined);
  const compact = vi.fn(async () => ({ ...accepted(), turn_kind: 'goal_continuation' as const }));
  const surface = renderSurfaceWithAdapterProps({ ...base, compactThreadContext: compact, stopThread }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  await enterCommand(surface);
  await waitFor(() => surface.querySelector('[data-flower-selected-thread-status="running"]') !== null);
  await waitFor(() => surface.querySelector('.flower-composer-submit')?.getAttribute('aria-label') === 'Stop');
  expect(compact).toHaveBeenCalledTimes(1);
  expect(base.launchTurn).not.toHaveBeenCalled();
  expect(base.retryThread).not.toHaveBeenCalled();
  surface.querySelector<HTMLButtonElement>('.flower-composer-submit')!.click();
  await waitFor(() => stopThread.mock.calls.length === 1);
  expect(stopThread).toHaveBeenCalledWith('thread-1');
});
