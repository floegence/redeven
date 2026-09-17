import '../index.css';
import './flower-feature.css';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { activityItem, activityTimeline, adapter, deferred, liveBootstrap, renderSurfaceWithAdapterProps, runtimeCurrentView, thread, waitFor } from './FlowerSurface.navigation.testHarness';

async function setup(kind: 'site' | 'captcha' | 'unknown' = 'site') {
  const threadID = 'assistance-fixture';
  const item = activityItem({ item_id: 'step', tool_id: 'navigate', tool_name: 'browser.navigate', renderer: 'structured', status: 'success',
    target_refs: [{ kind: 'computer_control', label: 'Task browser', resource_ref: 'browser-main' },
      ...(kind === 'site' ? [{ kind: 'computer_origin', label: 'https://www.google.com', resource_ref: 'https://www.google.com' }] : [])],
    chips: kind === 'site' ? [] : [{ kind: 'computer_assistance', label: 'Required step', value: kind === 'captcha' ? 'captcha' : 'inspection' }],
    payload: { operation: 'navigate', status: 'success' },
  });
  const snapshot = thread({ thread_id: threadID, status: 'waiting_user', active_run_id: 'run-control', messages: [{
    id: 'message', turn_id: 'turn-control', run_id: 'run-control', role: 'assistant', content: '', status: 'complete', created_at_ms: 10,
    blocks: [activityTimeline({ thread_id: threadID, turn_id: 'turn-control', run_id: 'run-control', status: 'success', items: [item] })],
  }] });
  const base = runtimeCurrentView(snapshot, 1);
  const current = { ...base, items: base.items?.map(entry => {
    if (!entry.activity) return entry;
    const { label, description, renderer, payload, chips, target_refs, ...facts } = entry.activity;
    return { ...entry, activity: { ...facts, presentation: { label, description, renderer, payload, chips, target_refs } } };
  }), interactions: [{ id: 'tool-input:step', kind: 'input' as const, turn_id: 'turn-control', run_id: 'run-control', tool_call_id: 'navigate',
    input: { summary: 'Specific external step', questions: [{ id: 'computer_control', prompt: 'Inspect the selected page.', kind: 'select', options: ['Return control to Flower'] }] },
  }] };
  const gate = deferred<void>();
  const other = thread({ thread_id: 'other-conversation' });
  const saveAccess = vi.fn(() => gate.promise);
  const loadAccess = vi.fn(async () => ({ origins: ['https://existing.test'], apps: ['dev.Notes'], allow_foreground: false }));
  const submitInput = vi.fn(async () => ({ thread_id: threadID, consumed_prompt_id: 'tool-input:step', current: { ...current, view_version: 2, activity: 'idle' as const, last_outcome: 'completed' as const, interactions: [] } }));
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), submitInput,
    computerManagement: { loadAccess, saveAccess, listTargets: vi.fn(async () => []), loadTarget: vi.fn(async () => ({ target_id: 'browser-main' })), selectTarget: vi.fn(), listBrowserTabs: vi.fn(async () => []) },
    listThreads: vi.fn(async () => [snapshot, other]), loadThread: vi.fn(async id => id === threadID ? { thread: applyFlowerRuntimeCurrentView(snapshot, current), current } : liveBootstrap(other)),
    connectLiveStream: async function* ({ signal }) {
      yield { schema_version: 1 as const, kind: 'ready' as const, observer_id: 'assistance-observer', summaries: [snapshot, other] };
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  }, { focusThreadRequest: { request_id: 'select-assistance', thread_id: threadID }, layout: true });
  await waitFor(() => !!surface.querySelector('.flower-computer-control-heading'));
  return { surface, gate, saveAccess, loadAccess, submitInput };
}

it('explains the exact site grant and grants it once before continuing without manual browser control', async () => {
  const s = await setup();
  const card = s.surface.querySelector('.flower-computer-control-heading')!.closest('section')!;
  expect(card.textContent).toContain('https://www.google.com');
  expect(card.textContent).toContain('Allow website access');
  const activity = s.surface.querySelector('.flower-activity-inline-title')!;
  expect(activity.textContent).toBe('Allow website access');
  expect(s.surface.querySelector('.flower-activity-waiting-clock')).not.toBeNull();
  expect(card.querySelector('[data-computer-control-action="take"]')).toBeNull();
  const allow = card.querySelector<HTMLButtonElement>('[data-computer-control-action="grant"]')!;
  expect(allow.textContent).toBe('Allow and continue');
  for (const button of card.querySelectorAll('button')) {
    expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(card.getBoundingClientRect().right + 1);
    expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
    expect(getComputedStyle(button).cursor).toBe('pointer');
  }
  if (import.meta.env.VITE_COMPUTER_ASSISTANCE_SCREENSHOT === '1') await page.screenshot({ element: card, path: '__screenshots__/flower-assistance-site-card.png' });
  allow.click(); allow.click();
  await waitFor(() => s.saveAccess.mock.calls.length === 1);
  expect(s.saveAccess).toHaveBeenCalledWith('assistance-fixture', { origins: ['https://existing.test', 'https://www.google.com'], apps: ['dev.Notes'], allow_foreground: false });
  expect(s.submitInput).not.toHaveBeenCalled();
  s.gate.resolve();
  await waitFor(() => s.submitInput.mock.calls.length === 1);
  await waitFor(() => !s.surface.querySelector('.flower-computer-control-heading'));
  expect(document.querySelector('.flower-computer-stage')).toBeNull();
});

it('does not continue a different conversation after an in-flight grant finishes', async () => {
  const s = await setup();
  s.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="grant"]')!.click();
  await waitFor(() => s.saveAccess.mock.calls.length === 1);
  s.surface.querySelector<HTMLButtonElement>('[data-thread-id="other-conversation"] .flower-thread-card-select-button')!.click();
  await waitFor(() => s.surface.querySelector('[data-thread-id="other-conversation"]')?.getAttribute('data-flower-thread-active') === 'true');
  s.gate.resolve();
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(s.submitInput).not.toHaveBeenCalled();
  expect(s.saveAccess).toHaveBeenCalledTimes(1);
});

it('does not save access after the user leaves while access is loading', async () => {
  const s = await setup();
  const loaded = deferred<{ origins: string[]; apps: string[]; allow_foreground: boolean }>();
  s.loadAccess.mockImplementation(() => loaded.promise);
  s.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="grant"]')!.click();
  await waitFor(() => s.loadAccess.mock.calls.length === 1);
  s.surface.querySelector<HTMLButtonElement>('[data-thread-id="other-conversation"] .flower-thread-card-select-button')!.click();
  await waitFor(() => s.surface.querySelector('[data-thread-id="other-conversation"]')?.getAttribute('data-flower-thread-active') === 'true');
  loaded.resolve({ origins: [], apps: [], allow_foreground: false });
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(s.saveAccess).not.toHaveBeenCalled();
  expect(s.submitInput).not.toHaveBeenCalled();
});

it('keeps the request actionable when saving access fails and does not continue', async () => {
  const s = await setup();
  s.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="grant"]')!.click();
  await waitFor(() => s.saveAccess.mock.calls.length === 1);
  s.gate.reject(new Error('write failed'));
  await waitFor(() => !!s.surface.querySelector('.flower-computer-control-notice'));
  expect(s.submitInput).not.toHaveBeenCalled();
  expect(s.surface.querySelector('.flower-computer-control-notice')?.textContent).toContain('Access');
  expect(s.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="grant"]')!.disabled).toBe(false);
});

it('names the CAPTCHA task and tells the user where to perform it', async () => {
  const s = await setup('captcha');
  expect(s.surface.querySelector('.flower-computer-control-heading')?.textContent).toContain('Complete the CAPTCHA');
  expect(s.surface.querySelector('[data-computer-control-action="take"]')?.textContent).toBe('Open page');
  expect(s.surface.querySelector('[data-computer-control-action="return"]')?.textContent).toBe('Done, continue');
  expect(s.saveAccess).not.toHaveBeenCalled();
});

it('does not invent a sign-in requirement when page inspection fails', async () => {
  const s = await setup('unknown');
  expect(s.surface.querySelector('.flower-computer-control-heading')?.textContent).toContain('could not safely inspect');
  expect(s.surface.querySelector('.flower-computer-control-heading')?.textContent).not.toContain('Complete sign-in');
});

it('shows the newly observed CAPTCHA after access was saved instead of asking for access again', async () => {
  const s = await setup();
  s.submitInput.mockRejectedValueOnce(Object.assign(new Error('page needs attention'), {
    code: 'computer_control_not_ready', data: { computer_assistance: { kind: 'captcha' } },
  }));
  s.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="grant"]')!.click();
  await waitFor(() => s.saveAccess.mock.calls.length === 1);
  s.gate.resolve();
  await waitFor(() => s.surface.querySelector('.flower-computer-control-title')?.textContent === 'Complete the CAPTCHA');
  expect(s.surface.querySelector('[data-computer-control-action="grant"]')).toBeNull();
  expect(s.surface.querySelector('[data-computer-control-action="take"]')?.textContent).toBe('Open page');
  expect(s.surface.querySelector('.flower-activity-inline-title')?.textContent).toBe('Complete the CAPTCHA');
});

it('shows a newly observed site scope and grants only that scope on the next explicit click', async () => {
  const s = await setup();
  s.submitInput.mockRejectedValueOnce(Object.assign(new Error('page needs attention'), {
    code: 'computer_control_not_ready', data: { computer_assistance: { kind: 'access', origin: 'https://identity.test' } },
  }));
  s.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="grant"]')!.click();
  await waitFor(() => s.saveAccess.mock.calls.length === 1);
  s.gate.resolve();
  await waitFor(() => s.surface.querySelector('.flower-computer-control-resource')?.textContent === 'https://identity.test');
  expect(s.saveAccess).toHaveBeenCalledTimes(1);
  s.loadAccess.mockResolvedValue({ origins: ['https://existing.test', 'https://www.google.com'], apps: ['dev.Notes'], allow_foreground: false });
  s.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="grant"]')!.click();
  await waitFor(() => s.saveAccess.mock.calls.length === 2);
  expect(s.saveAccess).toHaveBeenLastCalledWith('assistance-fixture', { origins: ['https://existing.test', 'https://www.google.com', 'https://identity.test'], apps: ['dev.Notes'], allow_foreground: false });
});
