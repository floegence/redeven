// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { FlowerTurnLaunchInput } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, deferred, launchReceipt, liveBootstrap, renderSurfaceWithAdapter, renderSurfaceWithAdapterProps, subagentSummary, subagentDetail, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const failure = () => thread({ thread_id: 'thread-uncertain', status: 'failed', error: { code: 'floret_effect_outcome_unknown', message: 'private transport details' } });
const action = (surface: HTMLElement) => [...surface.querySelectorAll<HTMLButtonElement>('.flower-error-actions button')].find(button => button.textContent?.includes('Inspect and continue'));
async function open(overrides: Partial<ReturnType<typeof adapter>> = {}) {
  const failed = failure();
  const base = { ...adapter(true), listThreads: vi.fn(async () => [failed]), loadThread: vi.fn(async () => liveBootstrap(failed)), ...overrides };
  const surface = renderSurfaceWithAdapter(base);
  await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-uncertain"] button')));
  (surface.querySelector('[data-thread-id="thread-uncertain"] button') as HTMLButtonElement).click();
  await waitFor(() => Boolean(action(surface)));
  return { surface, base };
}

describe('Flower inspection after a terminal uncertain effect', () => {
  it('sends one visible normal request and preserves the unsent composer draft', async () => {
    const pending = deferred<ReturnType<typeof launchReceipt>>();
    const launchTurn = vi.fn((_input: FlowerTurnLaunchInput) => pending.promise);
    let latest = failure();
    const { surface, base } = await open({ launchTurn, loadThread: vi.fn(async () => liveBootstrap(latest, latest.updated_at_ms)) });
    const editor = surface.querySelector('.flower-composer textarea') as HTMLTextAreaElement;
    editor.value = 'Keep my unsent draft'; editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const button = action(surface)!; button.click(); button.click();
    await waitFor(() => launchTurn.mock.calls.length === 1);
    expect(launchTurn.mock.calls[0]![0]).toMatchObject({ thread_id: 'thread-uncertain', prompt: expect.stringContaining('First inspect current state'), decision: null });
    expect(launchTurn.mock.calls[0]![0].client_request_id).toBeTruthy();
    expect(editor.value).toBe('Keep my unsent draft');
    expect(base.retryThread).not.toHaveBeenCalled();
    expect(surface.textContent).not.toContain('private transport details');
    latest = thread({ ...latest, status: 'running', error: undefined, updated_at_ms: 4 });
    const receipt = launchReceipt('thread-uncertain', 'inspect-turn', 'start', launchTurn.mock.calls[0]![0].client_request_id);
    pending.resolve({ ...receipt, current: { ...receipt.current, view_version: 5 } });
    await waitFor(() => !action(surface) || action(surface)!.disabled);
    expect((surface.querySelector('.flower-composer textarea') as HTMLTextAreaElement).value).toBe('Keep my unsent draft');
  });

  it('disables submission for a read-only surface', async () => {
    const { surface, base } = await open({ canMutate: false });
    expect(action(surface)!.disabled).toBe(true);
    action(surface)!.click();
    expect(base.launchTurn).not.toHaveBeenCalled();
  });

  it('revalidates the current state before admitting a request', async () => {
    let current = failure();
    const loadThread = vi.fn(async () => liveBootstrap(current, current.updated_at_ms));
    const { surface, base } = await open({ loadThread });
    current = thread({ ...current, status: 'running', error: undefined, updated_at_ms: 3 });
    action(surface)!.click();
    await waitFor(() => loadThread.mock.calls.length >= 2 && (!action(surface) || action(surface)!.disabled));
    expect(base.launchTurn).not.toHaveBeenCalled();
    expect(base.retryThread).not.toHaveBeenCalled();
  });

  it('does not submit after leaving the thread during preflight', async () => {
    const gate = deferred<ReturnType<typeof liveBootstrap>>();
    let paused = false;
    const loadThread = vi.fn(async () => paused ? gate.promise : liveBootstrap(failure()));
    const { surface, base } = await open({ loadThread });
    paused = true;
    action(surface)!.click();
    await waitFor(() => loadThread.mock.calls.length >= 2);
    const newChat = surface.querySelector<HTMLButtonElement>('[data-flower-new-thread]')
      ?? [...surface.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === 'New chat');
    expect(newChat).toBeTruthy(); newChat!.click();
    gate.resolve(liveBootstrap(failure()));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(base.launchTurn).not.toHaveBeenCalled();
  });
  it('retains one request identity on connection failure and exposes resend', async () => {
    const launchTurn = vi.fn(async (_input: FlowerTurnLaunchInput) => { throw new TypeError('Failed to fetch'); });
    const { surface } = await open({ launchTurn });
    action(surface)!.click();
    await waitFor(() => launchTurn.mock.calls.length === 1 && Boolean(surface.querySelector('[aria-label="Retry send"]')));
    expect(action(surface)!.disabled).toBe(true);
    const original = launchTurn.mock.calls[0]![0].client_request_id;
    surface.querySelector<HTMLButtonElement>('[aria-label="Retry send"]')!.click();
    await waitFor(() => launchTurn.mock.calls.length === 2);
    expect(launchTurn.mock.calls[1]![0].client_request_id).toBe(original);
  });

  it('leaves the recovery action usable when current-state loading fails', async () => {
    let fail = false;
    const loadThread = vi.fn(async () => { if (fail) throw new Error('offline'); return liveBootstrap(failure()); });
    const { surface, base } = await open({ loadThread });
    fail = true; action(surface)!.click();
    await waitFor(() => loadThread.mock.calls.length >= 2 && Boolean(action(surface) && !action(surface)!.disabled));
    expect(base.launchTurn).not.toHaveBeenCalled();
    fail = false; action(surface)!.click();
    await waitFor(() => vi.mocked(base.launchTurn).mock.calls.length === 1);
  });

  it('routes a child recovery through its parent and exposes failed delivery controls', async () => {
    const child = subagentSummary({ status: 'failed', can_send_input: true });
    const parent = thread({ thread_id: child.parent_thread_id, subagents: [child] });
    const current = { thread_id: child.thread_id, view_version: 7, activity: 'idle' as const, turn_id: 'failed-child-turn', last_outcome: 'failed' as const,
      run_id: 'failed-child-run', error: 'unconfirmed', run_error_code: 'floret_effect_outcome_unknown', items: [] };
    const launchTurn = vi.fn<(input: FlowerTurnLaunchInput) => Promise<ReturnType<typeof launchReceipt>>>(async () => { throw new TypeError('Failed to fetch'); });
    const base = { ...adapter(true), listThreads: vi.fn(async () => [parent]), loadThread: vi.fn(async () => liveBootstrap(parent)),
      loadSubagentDetail: vi.fn(async () => subagentDetail({ summary: child, current })), launchTurn };
    let selectionCommitted = false;
    const surface = renderSurfaceWithAdapterProps(base, { onThreadSelectionEvent: event => { if (event.phase === 'committed') selectionCommitted = true; } });
    const parentSelector = '[data-thread-id="' + parent.thread_id + '"] button';
    await waitFor(() => Boolean(surface.querySelector(parentSelector)));
    surface.querySelector<HTMLButtonElement>(parentSelector)!.click();
    await waitFor(() => selectionCommitted && surface.querySelector('[data-flower-subagent-count]')?.getAttribute('data-flower-subagent-count') === '1');
    surface.querySelector<HTMLButtonElement>('button[aria-controls="flower-subagents-dropdown"]')!.click();
    await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-row="0"], [data-flower-subagent-disclosure]')));
    document.querySelector<HTMLButtonElement>('[data-flower-subagent-disclosure]')?.click();
    await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-row="0"]')));
    document.querySelector<HTMLButtonElement>('[data-flower-subagent-row="0"]')!.click();
    await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-detail="open"] .flower-error-actions button')));
    const detail = document.querySelector<HTMLElement>('[data-flower-subagent-detail="open"]')!;
    const inspect = action(detail); expect(inspect).toBeTruthy(); inspect!.click();
    await waitFor(() => launchTurn.mock.calls.length === 1);
    expect(launchTurn.mock.calls[0]![0].thread_id).toBe(child.thread_id);
    await waitFor(() => Boolean(document.querySelector('[data-flower-child-send-delivery="failed"] [aria-label="Retry send"]')));
    expect(document.querySelector('[data-flower-subagent-detail="open"]')?.textContent).toContain('First inspect current state');
    const original = launchTurn.mock.calls[0]![0].client_request_id;
    document.querySelector<HTMLButtonElement>('[data-flower-child-send-delivery="failed"] [aria-label="Retry send"]')!.click();
    await waitFor(() => launchTurn.mock.calls.length === 2);
    expect(launchTurn.mock.calls[1]![0].client_request_id).toBe(original);
    launchTurn.mockImplementationOnce(async input => {
      const receipt = launchReceipt(child.thread_id, 'inspection', 'start', input.client_request_id);
      return { ...receipt, current: { ...receipt.current, view_version: 8 } };
    });
    await waitFor(() => Boolean(document.querySelector('[data-flower-child-send-delivery="failed"] [aria-label="Retry send"]')));
    document.querySelector<HTMLButtonElement>('[data-flower-child-send-delivery="failed"] [aria-label="Retry send"]')!.click();
    await waitFor(() => launchTurn.mock.calls.length === 3 && !document.querySelector('[data-flower-child-send-delivery]'));
    expect(document.querySelector('[data-flower-subagent-detail="open"]')?.getAttribute('data-flower-subagent-status')).toBe('running');
    expect(base.retryThread).not.toHaveBeenCalled();
  });

});
