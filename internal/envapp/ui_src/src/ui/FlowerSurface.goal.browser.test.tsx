import '../index.css';
import './flower-feature.css';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import type { FlowerGoal, FlowerGoalInput, FlowerGoalResult, FlowerRuntimeCurrentView, FlowerLiveStreamEnvelope, FlowerThreadSnapshot, FlowerThreadView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { withModelDirectoryFixture } from '../../../../flower_ui/testing/modelDirectoryFixture';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { dictionaries, createTestI18nHelpers } from './i18n/locales/testDictionaries';
import type { EnvAppTranslationKey } from './i18n';
import { adapter, deferred, inputRequest, liveBootstrap, thread, renderSurfaceWithAdapterProps, renderSurfaceWithDraftCoordinator, waitFor } from './FlowerSurface.navigation.testHarness';

const focus = { request_id: 'goal-focus', thread_id: 'thread-1' };

it('confirms a fresh Goal on every open without creating a viewing draft', async () => {
  const base = adapter(true), coordinator = createFlowerComposerDraftCoordinator();
  let snapshot = thread({ goal: { version: 1, text: 'Earlier goal', status: 'active', actor: 'user' } });
  let version = 20;
  const loadThread = vi.fn(async () => ({ ...liveBootstrap(snapshot, version), current: { ...liveBootstrap(snapshot, version).current, goal: snapshot.goal } }));
  const surface = renderSurfaceWithDraftCoordinator({ ...base, listThreads: async () => [snapshot], loadThread }, coordinator, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-tag')), 10000);
  const reads = loadThread.mock.calls.length;
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-input')));
  expect(coordinator.read('thread-1').value.goal_edit).toBeUndefined();
  expect(loadThread.mock.calls.length).toBeGreaterThan(reads);
  await userEvent.keyboard('{Escape}');
  snapshot = { ...snapshot, goal: { version: 2, text: 'Current goal', status: 'active', actor: 'model' } }; version++;
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
  await waitFor(() => surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')?.value === 'Current goal');
  expect(coordinator.read('thread-1').value.goal_edit).toBeUndefined();
  expect(JSON.stringify(coordinator.exportForRestart())).not.toContain('goal_edit');
});
afterEach(() => document.documentElement.classList.remove('dark'));
function response(input: FlowerGoalInput, version = input.expected_version + 1, conflict = false): FlowerGoalResult {
  const goal: FlowerGoal = { version, text: input.operation !== 'delete' ? input.text : undefined, status: input.operation !== 'delete' ? 'active' : 'absent', actor: 'user' };
  const current: FlowerRuntimeCurrentView = { thread_id: input.thread_id || 'created-goal', view_version: version + 2, activity: 'idle', goal, items: [{ id: 'goal:' + version, ordinal: version, kind: 'goal', goal: { goal, operation: input.operation === 'delete' ? 'delete' : 'set', actor: 'user', at: '2026-10-18T00:00:00Z' } }] };
  return { client_request_id: input.client_request_id, thread_id: current.thread_id, current, goal, conflict };
}
function goalDetail(result: FlowerGoalResult): FlowerThreadView {
  return { thread: applyFlowerRuntimeCurrentView(thread({ thread_id: result.thread_id }), result.current), current: result.current };
}
function composer(surface: HTMLElement) { return surface.querySelector<HTMLTextAreaElement>('textarea:not(.flower-goal-input)')!; }
function edit(input: HTMLTextAreaElement, text: string) {
  input.value = text;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
}
async function command(surface: HTMLElement, text: string) {
  const input = composer(surface); edit(input, text); input.focus();
  await userEvent.keyboard('{Enter}');
  return input;
}
function action(surface: HTMLElement, label: string) {
  const button = [...surface.querySelectorAll<HTMLButtonElement>('.flower-goal-actions button')].find(item => (item.getAttribute('aria-label') ?? item.textContent) === label);
  if (!button) throw new Error('Goal action is unavailable: ' + label);
  return button;
}

function goalFixture(initialText = 'Current goal', initialVersion = 2) {
  const base = adapter(true), coordinator = createFlowerComposerDraftCoordinator();
  let snapshot = thread({ goal: { version: initialVersion, text: initialText, status: 'active', actor: 'user' } });
  let viewVersion = 20;
  let read: (() => Promise<FlowerThreadView>) | undefined;
  const values: FlowerLiveStreamEnvelope[] = [];
  let reconnectRequested = false;
  let wake: (() => void) | undefined;
  const view = () => ({ ...liveBootstrap(snapshot, viewVersion), current: { ...liveBootstrap(snapshot, viewVersion).current, goal: snapshot.goal } });
  const publish = (goal: FlowerThreadSnapshot['goal']) => {
    snapshot = { ...snapshot, goal }; viewVersion++;
    values.push({ schema_version: 2, kind: 'thread.batch', thread_id: snapshot.thread_id, current: view().current }); wake?.();
  };
  const loadThread = vi.fn(async () => read ? read() : view());
  const manageGoal = vi.fn(async (input: FlowerGoalInput): Promise<FlowerGoalResult> => {
    const result = response(input);
    snapshot = { ...snapshot, goal: result.goal }; viewVersion++;
    return { ...result, current: view().current };
  });
  const surface = renderSurfaceWithDraftCoordinator({ ...base, listThreads: async () => [snapshot], loadThread, manageGoal,
    connectLiveStream: async function* ({ signal }) {
      yield { schema_version: 2, kind: 'ready', summaries: [snapshot] };
      const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
      try {
        while (!signal.aborted) {
          if (reconnectRequested) { reconnectRequested = false; throw new Error('Fixture connection changed'); }
          const value = values.shift();
          if (value) yield value;
          else await new Promise<void>(resolve => { wake = resolve; });
        }
      } finally { signal.removeEventListener('abort', abort); }
    },
  }, coordinator, { focusThreadRequest: focus });
  const open = async () => {
    await waitFor(() => Boolean(surface.querySelector('.flower-goal-tag')), 10000);
    await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
  };
  const input = () => surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')!;
  return { surface, coordinator, loadThread, manageGoal, base, view, publish, open, input,
    reconnect: () => { reconnectRequested = true; wake?.(); }, setRead: (next: typeof read) => { read = next; } };
}

it('hides cached text until confirmation and keeps failure and retry local', async () => {
  const f = goalFixture(), pending = deferred<FlowerThreadView>();
  await waitFor(() => Boolean(f.surface.querySelector('.flower-goal-tag')), 10000);
  f.setRead(() => pending.promise);
  await f.open();
  expect(f.surface.querySelector('.flower-goal-loading')).not.toBeNull();
  expect(f.input()).toBeNull();
  expect(f.surface.querySelector<HTMLButtonElement>('[aria-label="Delete goal"]')!.disabled).toBe(true);
  expect(composer(f.surface).disabled).toBe(false);
  pending.reject(new Error('Offline'));
  await waitFor(() => Boolean(f.surface.querySelector('.flower-goal-popup [role="alert"]')));
  expect(f.input()).toBeNull();
  expect(f.surface.querySelector('.flower-thread-sync-error')).toBeNull();
  expect(composer(f.surface).disabled).toBe(false);
  f.setRead(undefined);
  await userEvent.click(action(f.surface, 'Try again'));
  await waitFor(() => f.input()?.value === 'Current goal');
  expect(f.coordinator.read('thread-1').value.goal_edit).toBeUndefined();
});

it('shows the latest Goal first and requires reviewing each replacement version', async () => {
  const f = goalFixture();
  await f.open(); await waitFor(() => Boolean(f.input()));
  edit(f.input(), 'My retained draft');
  const editBaseline = f.coordinator.read('thread-1').value.goal_edit;
  await userEvent.keyboard('{Escape}');
  f.publish({ version: 3, text: 'Updated remotely', status: 'active', actor: 'model' });
  await waitFor(() => f.surface.querySelector('.flower-goal-tag')?.getAttribute('title') === 'Updated remotely');
  await f.open(); await waitFor(() => f.input()?.value === 'Updated remotely');
  expect(f.input().readOnly).toBe(true);
  await userEvent.click(f.surface.querySelector<HTMLButtonElement>('[role="tab"][data-goal-view="draft"]')!);
  expect(f.input().value).toBe('My retained draft');
  expect(f.input().readOnly).toBe(true);
  expect(f.coordinator.read('thread-1').value.goal_edit).toBe(editBaseline);
  await userEvent.click(action(f.surface, 'View current goal'));
  await userEvent.click(action(f.surface, 'Continue editing'));
  expect(action(f.surface, 'Replace current goal').disabled).toBe(false);
  f.publish({ version: 4, text: 'Changed again', status: 'active', actor: 'model' });
  await waitFor(() => f.surface.querySelector('.flower-goal-tag')?.getAttribute('title') === 'Changed again');
  expect(f.input().value).toBe('My retained draft');
  expect(f.surface.querySelector('[aria-label="Replace current goal"]')).toBeNull();
  expect(f.manageGoal).not.toHaveBeenCalled();
  await userEvent.click(action(f.surface, 'View current goal'));
  expect(f.input().value).toBe('Changed again');
  await userEvent.click(action(f.surface, 'Continue editing'));
  await userEvent.click(action(f.surface, 'Replace current goal'));
  await waitFor(() => f.manageGoal.mock.calls.length === 1);
  expect(f.manageGoal.mock.calls[0]![0]).toMatchObject({ operation: 'set', text: 'My retained draft', expected_version: 4 });
  expect(f.base.launchTurn).not.toHaveBeenCalled();
});

it('retains one editor, selection, scroll and IME input through live changes and tab switches', async () => {
  const f = goalFixture(); await f.open(); await waitFor(() => Boolean(f.input()));
  f.publish({ version: 3, text: 'Live current text', status: 'active', actor: 'model' });
  await waitFor(() => f.input()?.value === 'Live current text');
  expect(f.coordinator.read('thread-1').value.goal_edit).toBeUndefined();
  edit(f.input(), 'My draft\n'.repeat(40));
  const input = f.input(); input.setSelectionRange(4, 11, 'backward'); input.scrollTop = 80;
  const scroll = input.scrollTop;
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  f.publish({ version: 4, text: 'New model goal', status: 'active', actor: 'model' });
  await waitFor(() => f.surface.querySelector('.flower-goal-tag')?.getAttribute('title') === 'New model goal');
  expect(f.input()).toBe(input); expect(input.selectionStart).toBe(4); expect(input.selectionEnd).toBe(11);
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', isComposing: true }));
  expect(f.surface.querySelector('.flower-goal-popup')).not.toBeNull();
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  await userEvent.click(action(f.surface, 'View current goal'));
  await userEvent.click(action(f.surface, 'Continue editing'));
  await waitFor(() => document.activeElement === input);
  expect(f.input()).toBe(input); expect(input.selectionStart).toBe(4); expect(input.selectionEnd).toBe(11);
  expect(input.selectionDirection).toBe('backward'); expect(input.scrollTop).toBe(scroll);
});

it('accepts a newer live view when an older confirmation returns and ignores dismissed reads', async () => {
  const f = goalFixture(), pending = deferred<FlowerThreadView>();
  await waitFor(() => Boolean(f.surface.querySelector('.flower-goal-tag')), 10000);
  const old = f.view(); f.setRead(() => pending.promise);
  await f.open(); await userEvent.keyboard('{Escape}');
  const trigger = f.surface.querySelector<HTMLButtonElement>('.flower-goal-tag')!;
  await f.open();
  f.publish({ version: 3, text: 'Live is newer', status: 'active', actor: 'model' });
  await waitFor(() => trigger.getAttribute('title') === 'Live is newer');
  pending.resolve(old);
  await waitFor(() => f.input()?.value === 'Live is newer');
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement).toBe(trigger);
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(f.surface.querySelector('.flower-goal-popup')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('does not reopen on a late conflict or silently advance the preserved draft baseline', async () => {
  const f = goalFixture(), pending = deferred<FlowerGoalResult>();
  f.manageGoal.mockImplementationOnce(() => pending.promise);
  await f.open(); await waitFor(() => Boolean(f.input())); edit(f.input(), 'Keep my edit');
  await userEvent.click(action(f.surface, 'Save goal'));
  await waitFor(() => f.manageGoal.mock.calls.length === 1);
  await userEvent.keyboard('{Escape}');
  const input = f.manageGoal.mock.calls[0]![0];
  const conflict = response({ ...input, text: 'Remote conflict' }, 5, true);
  pending.resolve({ ...conflict, current: { ...conflict.current, view_version: 30 } });
  await waitFor(() => f.surface.querySelector('.flower-goal-tag')?.getAttribute('title') === 'Remote conflict');
  expect(f.surface.querySelector('.flower-goal-popup')).toBeNull();
  expect(f.coordinator.read('thread-1').value.goal_edit).toMatchObject({ text: 'Keep my edit', version: 2 });
});

it('preserves a later identical edit and inherits only its own confirmed write version', async () => {
  const f = goalFixture(), pending = deferred<FlowerGoalResult>();
  f.manageGoal.mockImplementationOnce(() => pending.promise);
  await f.open(); await waitFor(() => Boolean(f.input())); edit(f.input(), 'Submitted edit');
  await userEvent.click(action(f.surface, 'Save goal'));
  await waitFor(() => f.manageGoal.mock.calls.length === 1);
  edit(f.input(), 'Changed while pending'); edit(f.input(), 'Submitted edit');
  const result = response(f.manageGoal.mock.calls[0]![0]);
  pending.resolve({ ...result, current: { ...result.current, view_version: 30, goal: { version: 7, text: 'Later model goal', status: 'active', actor: 'model' } } });
  await waitFor(() => f.surface.querySelector('.flower-goal-tag')?.getAttribute('title') === 'Later model goal');
  expect(f.input().value).toBe('Submitted edit');
  expect(f.coordinator.read('thread-1').value.goal_edit).toMatchObject({ text: 'Submitted edit', version: 3 });
  expect(f.surface.querySelector('[aria-label="Save goal"]')).toBeNull();
});

it('deletes the reviewed current version while preserving an older draft and its recovery entry', async () => {
  const f = goalFixture(); await f.open(); await waitFor(() => Boolean(f.input())); edit(f.input(), 'Recover this draft');
  await userEvent.keyboard('{Escape}');
  f.publish({ version: 5, text: 'Current to delete', status: 'active', actor: 'model' });
  await waitFor(() => f.surface.querySelector('.flower-goal-tag')?.getAttribute('title') === 'Current to delete');
  await f.open(); await waitFor(() => f.input()?.value === 'Current to delete');
  await userEvent.click(f.surface.querySelector<HTMLButtonElement>('[aria-label="Delete goal"]')!);
  await waitFor(() => f.manageGoal.mock.calls.length === 1);
  expect(f.manageGoal.mock.calls[0]![0]).toMatchObject({ operation: 'delete', expected_version: 5 });
  await waitFor(() => f.surface.querySelector('.flower-goal-popup')?.textContent?.includes('There is no current goal.') ?? false);
  expect(f.coordinator.read('thread-1').value.goal_edit?.text).toBe('Recover this draft');
  await userEvent.keyboard('{Escape}'); await f.open();
  await waitFor(() => Boolean(f.surface.querySelector('[role="tablist"]')));
  await userEvent.click(action(f.surface, 'Continue editing'));
  expect(f.input().value).toBe('Recover this draft');
  expect(f.manageGoal).toHaveBeenCalledTimes(1);
  await userEvent.click(action(f.surface, 'Discard draft'));
  expect(f.coordinator.read('thread-1').value.goal_edit).toBeUndefined();
  expect(f.surface.querySelector('.flower-goal-tag')).toBeNull();
});

it('times out confirmation locally, preserves a recoverable draft and never displays a late result', async () => {
  const f = goalFixture(), pending = deferred<FlowerThreadView>();
  await f.open(); await waitFor(() => Boolean(f.input())); edit(f.input(), 'Keep this through timeout');
  await userEvent.keyboard('{Escape}');
  f.setRead(() => pending.promise);
  // Advance only the existing read deadline; browser interaction timers remain real.
  const timer = window.setTimeout.bind(window);
  const deadline = vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
    timer(handler, delay === 15000 ? 40 : delay, ...args)) as typeof window.setTimeout);
  try {
    await f.open();
    await waitFor(() => Boolean(f.surface.querySelector('.flower-goal-popup [role="alert"]')));
  } finally { deadline.mockRestore(); }
  expect(composer(f.surface).disabled).toBe(false);
  await userEvent.click(f.surface.querySelector<HTMLButtonElement>('[data-goal-view="draft"]')!);
  expect(f.input().value).toBe('Keep this through timeout'); expect(f.input().readOnly).toBe(true);
  pending.resolve(f.view());
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(f.surface.querySelector('.flower-goal-popup [role="alert"]')).not.toBeNull();
  expect(f.coordinator.read('thread-1').value.goal_edit?.text).toBe('Keep this through timeout');
});

it('preserves drafts after a delete conflict without creating a draft or retrying deletion', async () => {
  const f = goalFixture();
  f.manageGoal.mockImplementationOnce(async input => {
    const conflict = response({ ...input, operation: 'set', text: 'Changed before delete' }, 4, true);
    return { ...conflict, current: { ...conflict.current, view_version: 30 } };
  });
  await f.open(); await waitFor(() => Boolean(f.input()));
  await userEvent.click(f.surface.querySelector<HTMLButtonElement>('[aria-label="Delete goal"]')!);
  await waitFor(() => f.input()?.value === 'Changed before delete');
  expect(f.manageGoal).toHaveBeenCalledTimes(1);
  expect(f.coordinator.read('thread-1').value.goal_edit).toBeUndefined();
  expect(f.surface.querySelector('.flower-goal-notice')?.textContent).toBe('The current goal has changed');
  expect(f.base.stopThread).not.toHaveBeenCalled();
});

it('restores restart drafts explicitly and keeps draft selection isolated between threads', async () => {
  const base = adapter(true), coordinator = createFlowerComposerDraftCoordinator();
  const before = createFlowerComposerDraftCoordinator();
  before.open('thread-1').mutate(value => ({ ...value, goal_edit: { text: 'Recovered draft', version: 1 } }));
  coordinator.restoreAfterRestart(before.exportForRestart()); before.dispose();
  const first = thread({ goal: { version: 3, text: 'First current', actor: 'user', status: 'active' } });
  const second = thread({ thread_id: 'thread-2', title: 'Second conversation', goal: { version: 4, text: 'Second current', actor: 'model', status: 'active' } });
  const pending = deferred<FlowerThreadView>(); let delayFirst = false;
  const loadThread = vi.fn(async (id: string) => delayFirst && id === 'thread-1' ? pending.promise : ({ ...liveBootstrap(id === 'thread-1' ? first : second, 20), current: { ...liveBootstrap(id === 'thread-1' ? first : second, 20).current, goal: (id === 'thread-1' ? first : second).goal } }));
  const surface = renderSurfaceWithDraftCoordinator({ ...base, listThreads: async () => [first, second], loadThread }, coordinator, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-tag')), 10000);
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
  await waitFor(() => surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')?.value === 'First current');
  await userEvent.click(action(surface, 'Continue editing'));
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')?.value).toBe('Recovered draft');
  await userEvent.keyboard('{Escape}');
  delayFirst = true;
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-loading')));
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-mobile-navigation-button')!);
  await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-2"] button')));
  await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-2"] button')!);
  await waitFor(() => surface.querySelector('.flower-goal-tag')?.getAttribute('title') === 'Second current');
  pending.resolve({ ...liveBootstrap(first, 20), current: { ...liveBootstrap(first, 20).current, goal: first.goal } });
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(surface.querySelector('.flower-goal-popup')).toBeNull();
  expect(coordinator.read('thread-1').value.goal_edit?.text).toBe('Recovered draft');
  expect(coordinator.read('thread-2').value.goal_edit).toBeUndefined();
});

it('does not consume a new draft after discard while the earlier save is pending', async () => {
  const f = goalFixture(), pending = deferred<FlowerGoalResult>();
  f.manageGoal.mockImplementationOnce(() => pending.promise);
  await f.open(); await waitFor(() => Boolean(f.input())); edit(f.input(), 'Submitted');
  await userEvent.click(action(f.surface, 'Save goal')); await waitFor(() => f.manageGoal.mock.calls.length === 1);
  await userEvent.click(action(f.surface, 'Discard draft'));
  edit(f.input(), 'Unrelated new draft');
  const result = response(f.manageGoal.mock.calls[0]![0]);
  pending.resolve({ ...result, current: { ...result.current, view_version: 30 } });
  await waitFor(() => f.surface.querySelector('.flower-goal-tag')?.getAttribute('title') === 'Submitted');
  expect(f.coordinator.read('thread-1').value.goal_edit).toMatchObject({ text: 'Unrelated new draft', version: 2 });
});

it('retries an unknown popup save with its frozen identity and preserves subsequent edits', async () => {
  const f = goalFixture();
  f.manageGoal.mockImplementationOnce(async () => { throw flowerTurnAdmissionError('unknown', new Error('Response lost')); });
  await f.open(); await waitFor(() => Boolean(f.input())); edit(f.input(), 'Frozen request');
  await userEvent.click(action(f.surface, 'Save goal'));
  await waitFor(() => Boolean(f.surface.querySelector('[data-flower-transport-delivery="unknown"]')));
  edit(f.input(), 'Edit after unknown outcome');
  await userEvent.keyboard('{Escape}');
  const retry = f.surface.querySelector<HTMLButtonElement>('[data-flower-transport-delivery="unknown"] [aria-label="Retry send"]')
    ?? [...f.surface.querySelectorAll<HTMLButtonElement>('[data-flower-transport-delivery="unknown"] button')].find(button => button.textContent?.includes('Retry'));
  await userEvent.click(retry!);
  await waitFor(() => f.manageGoal.mock.calls.length === 2);
  expect(f.manageGoal.mock.calls[1]![0]).toEqual(f.manageGoal.mock.calls[0]![0]);
  await waitFor(() => f.coordinator.read('thread-1').value.goal_edit?.version === 3);
  expect(f.coordinator.read('thread-1').value.goal_edit?.text).toBe('Edit after unknown outcome');
  expect(f.base.launchTurn).not.toHaveBeenCalled();
});

it('keeps a newly reopened popup open when an earlier save succeeds', async () => {
  const f = goalFixture(), pending = deferred<FlowerGoalResult>();
  f.manageGoal.mockImplementationOnce(() => pending.promise);
  await f.open(); await waitFor(() => Boolean(f.input())); edit(f.input(), 'Submitted before closing');
  await userEvent.click(action(f.surface, 'Save goal')); await waitFor(() => f.manageGoal.mock.calls.length === 1);
  await userEvent.keyboard('{Escape}'); await f.open(); await waitFor(() => Boolean(f.input()));
  const result = response(f.manageGoal.mock.calls[0]![0]);
  pending.resolve({ ...result, current: { ...result.current, view_version: 30 } });
  await waitFor(() => f.input()?.value === 'Submitted before closing');
  expect(f.surface.querySelector('.flower-goal-popup')).not.toBeNull();
  expect(f.coordinator.read('thread-1').value.goal_edit).toBeUndefined();
  expect(f.input().readOnly).toBe(false);
});

it('retains an unsent draft when the model removes the current Goal', async () => {
  const f = goalFixture(); await f.open(); await waitFor(() => Boolean(f.input())); edit(f.input(), 'Still recoverable');
  f.publish({ version: 3, status: 'absent', actor: 'model' });
  await waitFor(() => Boolean(f.surface.querySelector('.flower-goal-notice')));
  expect(f.input().value).toBe('Still recoverable'); expect(f.manageGoal).not.toHaveBeenCalled();
  await userEvent.keyboard('{Escape}'); await f.open();
  await waitFor(() => f.surface.querySelector('.flower-goal-popup')?.textContent?.includes('There is no current goal.') ?? false);
  expect(f.coordinator.read('thread-1').value.goal_edit?.text).toBe('Still recoverable');
  await userEvent.click(action(f.surface, 'Continue editing'));
  expect(action(f.surface, 'Replace current goal').disabled).toBe(false);
  expect(f.manageGoal).not.toHaveBeenCalled();
});

it('automatically hides a completed Goal and closes its editor without losing a draft', async () => {
  const f = goalFixture(); await f.open(); await waitFor(() => Boolean(f.input()));
  edit(f.input(), 'Keep this unsaved objective');
  f.publish({ version: 3, text: 'Current work', status: 'completed', actor: 'model' });
  await waitFor(() => f.surface.querySelector('.flower-goal-tag') === null);
  expect(f.surface.querySelector('.flower-goal-popup')).toBeNull();
  expect(f.coordinator.read('thread-1').value.goal_edit?.text).toBe('Keep this unsaved objective');
  expect(f.manageGoal).not.toHaveBeenCalled();
  f.publish({ version: 4, text: 'New objective', status: 'active', actor: 'user' });
  await waitFor(() => f.surface.querySelector('.flower-goal-tag')?.getAttribute('title') === 'New objective');
  expect(f.surface.querySelector('.flower-goal-popup')).toBeNull();
});

it('supports keyboard draft tabs and returns focus without modifying the draft', async () => {
  const f = goalFixture(); await f.open(); await waitFor(() => Boolean(f.input())); edit(f.input(), 'Keyboard draft');
  await userEvent.keyboard('{Escape}'); await f.open(); await waitFor(() => Boolean(f.input()));
  const tabs = f.surface.querySelectorAll<HTMLButtonElement>('[role="tab"]'); tabs[0]!.focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(tabs[1]); expect(f.input().value).toBe('Keyboard draft');
  await userEvent.keyboard('{Home}');
  expect(document.activeElement).toBe(tabs[0]); expect(f.input().value).toBe('Current goal');
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement).toBe(f.surface.querySelector('.flower-goal-tag'));
  expect(f.coordinator.read('thread-1').value.goal_edit?.text).toBe('Keyboard draft');
});

it('invalidates confirmation on reconnection without reopening or losing a draft', async () => {
  const f = goalFixture(), pending = deferred<FlowerThreadView>();
  await f.open(); await waitFor(() => Boolean(f.input())); edit(f.input(), 'Retained across reconnect');
  await userEvent.keyboard('{Escape}'); f.setRead(() => pending.promise);
  await f.open(); await waitFor(() => Boolean(f.surface.querySelector('.flower-goal-loading')));
  f.reconnect();
  await waitFor(() => !f.surface.querySelector('.flower-goal-popup'), 10000);
  pending.resolve(f.view());
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(f.surface.querySelector('.flower-goal-popup')).toBeNull();
  expect(f.coordinator.read('thread-1').value.goal_edit?.text).toBe('Retained across reconnect');
});

it.each(Object.keys(dictionaries) as (keyof typeof dictionaries)[])('keeps %s Goal popup states clear within narrow and wide surfaces', async locale => {
  const i18n = createTestI18nHelpers(locale);
  const copy = createLocalizedFlowerSurfaceCopy({ locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
  const base = adapter(true), coordinator = createFlowerComposerDraftCoordinator();
  let snapshot = thread({ goal: { version: 3, text: locale.startsWith('zh') ? '验证目标浮窗，保留所有编辑并确认最新内容。' : 'Verify the goal popup, preserve every edit and confirm the latest content.', actor: 'model', status: 'active' } });
  let viewVersion = 20;
  let read: (() => Promise<FlowerThreadView>) | undefined;
  const loadThread = async () => read ? read() : { ...liveBootstrap(snapshot, viewVersion), current: { ...liveBootstrap(snapshot, viewVersion).current, goal: snapshot.goal } };
  const surface = renderSurfaceWithDraftCoordinator({ ...base, listThreads: async () => [snapshot], loadThread }, coordinator, { focusThreadRequest: focus, copy });
  surface.style.cssText = 'width:100%;height:800px;position:relative;';
  const capture = async (state: string, theme: string, width: number) => {
    const popup = document.querySelector<HTMLElement>('.flower-goal-popup')!;
    await waitFor(() => popup.getBoundingClientRect().width > 0);
    expect(popup.querySelectorAll('textarea').length).toBeLessThanOrEqual(1);
    expect(popup.scrollWidth).toBeLessThanOrEqual(popup.clientWidth + 1);
    for (const button of popup.querySelectorAll<HTMLButtonElement>('button')) {
      expect(getComputedStyle(button).whiteSpace).toBe('nowrap');
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
      expect(button.textContent).not.toContain('flowerSurface.');
    }
    expect(popup.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
    expect(popup.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1' && (locale === 'zh-CN' || locale === 'en-US'))
      await page.screenshot({ element: popup, path: '__screenshots__/goal-' + locale + '-' + theme + '-' + width + '-' + state + '.png' });
  };
  await waitFor(() => Boolean(document.querySelector('.flower-goal-tag')), 10000);
  for (const width of [1100, 390]) for (const theme of ['light', 'dark']) {
    await page.viewport(width, 850); document.documentElement.classList.toggle('dark', theme === 'dark');
    await userEvent.click(document.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
    await waitFor(() => Boolean(document.querySelector('.flower-goal-input')));
    await capture('current', theme, width);
    edit(document.querySelector<HTMLTextAreaElement>('.flower-goal-input')!, locale.startsWith('zh') ? '保留未保存的目标草稿，等待核对后提交。' : 'Keep this unsaved goal draft for explicit review.');
    await capture('editing', theme, width);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(document.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
    await waitFor(() => Boolean(document.querySelector('.flower-goal-input')));
    await capture('draft-current', theme, width);
    await userEvent.keyboard('{Escape}');
    snapshot = { ...snapshot, goal: { ...snapshot.goal!, version: snapshot.goal!.version + 1 } }; viewVersion++;
    await userEvent.click(document.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
    await waitFor(() => Boolean(document.querySelector('.flower-goal-notice')));
    await userEvent.click(action(document.body, copy.chat.goalContinueEditing));
    await capture('replace', theme, width);
    await userEvent.keyboard('{Escape}');
    const pending = deferred<FlowerThreadView>(); read = () => pending.promise;
    await userEvent.click(document.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
    await capture('loading', theme, width);
    pending.reject(new Error('Visual confirmation failure'));
    await waitFor(() => Boolean(document.querySelector('.flower-goal-popup [role="alert"]')));
    await capture('error', theme, width);
    read = undefined;
    await userEvent.click(action(document.body, copy.chat.goalDiscardDraft));
    await userEvent.keyboard('{Escape}');
  }
});

it.each([['en-US', 1100, 'light'], ['zh-CN', 390, 'light'], ['en-US', 1100, 'dark'], ['zh-CN', 390, 'dark']] as const)('presents %s Goal facts as a single icon row at %s px in %s mode', async (locale, width, theme) => {
  await page.viewport(width, 850);
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const i18n = createTestI18nHelpers(locale);
  const copy = createLocalizedFlowerSurfaceCopy({ locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
  const base = adapter(true);
  const text = locale === 'zh-CN' ? '完善目标交互与界面设计，验证所有状态和恢复流程，并保留用户的全部要求。\n这一行原文也需要完整保留。' : 'Verify the release, preserve every user requirement, and document the result.\nKeep this second line intact.';
  const goal: FlowerGoal = { version: 1, text, status: 'completed', actor: 'model' };
  const snapshot = thread({ goal });
  const current: FlowerRuntimeCurrentView = { ...liveBootstrap(snapshot, 20).current, goal, items: [
    { id: 'goal-tool', ordinal: 1, canonical_ordinal: 1, kind: 'tool', turn_id: 'goal-turn', run_id: 'goal-run', activity: { item_id: 'goal-call', tool_id: 'goal-call', tool_name: 'goal', kind: 'tool', status: 'success', severity: 'normal' } },
    { id: 'goal-set', ordinal: 2, canonical_ordinal: 2, kind: 'goal', turn_id: 'goal-turn', run_id: 'goal-run', goal: { goal: { ...goal, status: 'active' }, operation: 'set', actor: 'model', at: '2026-10-18T00:00:00Z' } },
    { id: 'goal-user-set', ordinal: 3, canonical_ordinal: 3, kind: 'goal', goal: { goal: { ...goal, status: 'active', actor: 'user' }, operation: 'set', actor: 'user', at: '2026-10-18T00:00:30Z' } },
    { id: 'goal-done', ordinal: 4, canonical_ordinal: 4, kind: 'goal', goal: { goal, operation: 'completed', actor: 'model', at: '2026-10-18T00:01:00Z' } },
  ] };
  const surface = renderSurfaceWithAdapterProps({ ...base, listThreads: async () => [snapshot], loadThread: async () => ({ thread: applyFlowerRuntimeCurrentView(snapshot, current), current }) }, { copy, focusThreadRequest: focus });
  surface.style.cssText = 'width:100%;height:800px;position:relative;';
  await waitFor(() => surface.querySelectorAll('.flower-goal-history').length === 3, 10000);
  expect(surface.querySelector('.flower-goal-tag')).toBeNull();
  expect(surface.querySelector('[data-flower-tool-call-id="goal-call"]')).toBeNull();
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: surface, path: '__screenshots__/flower-goal-history-' + locale + '-' + theme + '.png' });
  for (const [index, label] of [copy.chat.goalSet, copy.chat.goalSet, copy.chat.goalCompleted].entries()) {
    const row = surface.querySelectorAll<HTMLDetailsElement>('.flower-goal-history')[index]!;
    const summary = row.querySelector('summary')!;
    expect(summary.querySelector('[data-flower-goal-icon]')).not.toBeNull();
    expect(summary.querySelector('.flower-goal-history-label')?.textContent).toBe(label);
    expect(summary.querySelector('.flower-goal-history-preview')?.textContent).toBe(text);
    expect(getComputedStyle(summary.querySelector('.flower-goal-history-preview')!).textOverflow).toBe('ellipsis');
    expect(row.open).toBe(false);
    expect(summary.getBoundingClientRect().height).toBeLessThan(40);
    expect(summary.scrollWidth).toBeLessThanOrEqual(summary.clientWidth + 1);
    summary.focus(); await userEvent.keyboard('{Enter}');
    expect(row.open).toBe(true);
    expect(row.querySelector('.flower-goal-history-text')?.textContent).toBe(text);
    const body = row.querySelector<HTMLElement>('.flower-goal-history-body')!;
    expect(body.textContent).toBe(text);
    const bodyStyle = getComputedStyle(body);
    expect(bodyStyle.borderTopWidth).toBe('0px');
    expect(bodyStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(bodyStyle.boxShadow).toBe('none');
    expect(body.getBoundingClientRect().left).toBeCloseTo(summary.querySelector('.flower-goal-history-label')!.getBoundingClientRect().left, 0);
    expect(getComputedStyle(summary).outlineStyle).not.toBe('none');
  }
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') {
    await userEvent.click(surface.querySelector<HTMLElement>('.flower-goal-history-text')!);
    await page.screenshot({ element: surface, path: '__screenshots__/flower-goal-history-expanded-' + locale + '-' + theme + '.png' });
  }
});

it('keeps failed Goal tools inspectable with the shared icon and never claims completion', async () => {
  const base = adapter(true), snapshot = thread({ messages: [] });
  const current: FlowerRuntimeCurrentView = { ...liveBootstrap(snapshot, 20).current, items: [
    { id: 'goal-error', ordinal: 1, canonical_ordinal: 1, turn_id: 'turn-goal', run_id: 'run-goal', kind: 'tool', activity: {
      item_id: 'goal-error', tool_id: 'goal-error', tool_name: 'goal', kind: 'tool', status: 'error', severity: 'error', needs_attention: true,
      presentation: { renderer: 'structured', payload: { error: { message: 'The Goal changed before review.' } } },
    } },
  ] };
  const surface = renderSurfaceWithAdapterProps({ ...base, listThreads: async () => [snapshot], loadThread: async () => ({ thread: applyFlowerRuntimeCurrentView(snapshot, current), current }) }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(surface.querySelector('[data-flower-activity-item-id="goal-error"]')), 10000);
  const row = surface.querySelector<HTMLElement>('[data-flower-activity-item-id="goal-error"]')!;
  expect(row.querySelector('[data-flower-goal-icon]')).not.toBeNull();
  expect(row.querySelector('.flower-activity-inline-title')?.textContent).toBe('Goal check failed');
  expect(surface.querySelector('[data-flower-goal-change="completed"]')).toBeNull();
  await userEvent.click(row.querySelector('button')!);
  await waitFor(() => Boolean(row.textContent?.includes('The Goal changed before review.')));
});

it('opens Goal from slash suggestions with keyboard and restores composer focus on Escape', async () => {
  const base = adapter(true);
  const manageGoal = vi.fn(async (input: FlowerGoalInput) => response(input));
  const surface = renderSurfaceWithAdapterProps({ ...base, manageGoal }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(composer(surface)), 10000);
  const input = composer(surface); edit(input, '/'); input.focus();
  await waitFor(() => surface.querySelectorAll('.flower-composer-command-item').length === 3);
  await userEvent.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-command-chip')));
  await waitFor(() => document.activeElement === input);
  expect(input.value).toBe('');
  await userEvent.keyboard('{Escape}');
  expect(surface.querySelector('.flower-goal-command-chip')).toBeNull();
  expect(document.activeElement).toBe(input);
  expect(base.launchTurn).not.toHaveBeenCalled(); expect(manageGoal).not.toHaveBeenCalled();
});

it('submits through the canonical Goal endpoint and preserves attachment, reference and newer command drafts', async () => {
  const base = adapter(true); const pending = deferred<FlowerGoalResult>();
  let currentDetail: FlowerThreadView | undefined;
  const loadThread = vi.fn(async (threadID: string, signal: AbortSignal) => currentDetail?.thread.thread_id === threadID ? currentDetail : base.loadThread(threadID, signal));
  const manageGoal = vi.fn((_input: FlowerGoalInput) => pending.promise);
  const coordinator = createFlowerComposerDraftCoordinator();
  const capability = { model_id: 'openai/gpt-5.2', revision: 'goal-capability', enabled: true, supports_long_text: true, max_attachments: 4, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000, routes: { 'text/plain': 'tool_read' as const } };
  const attachments = [{ local_id: 'file-1', source: 'file' as const, name: 'notes.txt', mime_type: 'text/plain', size_bytes: 12, upload_request_id: 'upload-1', attempt_state: 'staged_ready', staged: { attachment_id: 'attachment-1', name: 'notes.txt', mime_type: 'text/plain', size_bytes: 12, digest_sha256: 'a'.repeat(64), locator: 'attachment://v1/attachment-1/notes.txt', source: 'file' as const, capability_revision: capability.revision } }];
  const references = [{ local_id: 'ref-1', kind: 'file' as const, label: 'config.ts', path: '/workspace/redeven/config.ts' }];
  coordinator.open('__new_thread__').mutate(value => ({ ...value, attachments, references }));
  const uploadAttachment = vi.fn(async () => attachments[0]!.staged);
  const scope = await coordinator.ensureAttachmentStagingScope('__new_thread__', async () => ({ staging_scope_id: 'draft-scope', capability: 'draft-secret', target_id: 'draft-request', expires_at_unix_ms: Date.now() + 600000 }), async () => undefined);
  const bindAttachmentStagingScope = vi.fn(async (original, threadID: string) => ({ ...original, target_id: threadID }));
  const launchTurn = vi.fn(async input => {
    expect(input.staging_scope.target_id).toBe('created-goal');
    expect(input.attachment_ids).toEqual(['attachment-1']);
    return base.launchTurn(input);
  });
  const surface = renderSurfaceWithDraftCoordinator({ ...base, loadThread, manageGoal, loadSettings: async () => withModelDirectoryFixture(await base.loadSettings()), loadAttachmentCapability: async () => capability, uploadAttachment, bindAttachmentStagingScope, launchTurn }, coordinator);
  await waitFor(() => Boolean(composer(surface)), 10000);
  await command(surface, '/goal Verify the deployment');
  await waitFor(() => manageGoal.mock.calls.length === 1);
  const input = manageGoal.mock.calls[0]![0];
  expect(input.thread_id).toBeUndefined(); expect(input.new_thread).toBeDefined();
  expect(base.launchTurn).not.toHaveBeenCalled();
  edit(composer(surface), 'Newer draft');
  const accepted = response(input);
  currentDetail = goalDetail(accepted);
  pending.resolve(accepted);
  await waitFor(() => surface.querySelector('.flower-goal-tag')?.getAttribute('title') === 'Verify the deployment');
  expect(input.operation).toBe('submit');
  expect(composer(surface).value).toBe('Newer draft');
  expect(coordinator.read('created-goal').value.attachments).toEqual(attachments);
  expect(coordinator.read('created-goal').value.references).toEqual(references);
  expect(uploadAttachment).not.toHaveBeenCalled();
  expect(surface.querySelector('[data-flower-goal-change="set"]')).not.toBeNull();
  expect(base.launchTurn).not.toHaveBeenCalled();
  composer(surface).focus(); await userEvent.keyboard('{Escape}');
  edit(composer(surface), 'Send the retained draft');
  await userEvent.keyboard('{Enter}');
  await waitFor(() => launchTurn.mock.calls.length === 1);
  expect(bindAttachmentStagingScope).toHaveBeenCalledWith(scope, 'created-goal');
  expect(uploadAttachment).not.toHaveBeenCalled();
});

it('preserves conflict edits and resubmits the latest version with a fresh identity', async () => {
  const base = adapter(true);
  const manageGoal = vi.fn(async (input: FlowerGoalInput) => manageGoal.mock.calls.length === 1 ? response({ ...input, text: 'Changed elsewhere' }, 3, true) : response(input));
  const surface = renderSurfaceWithAdapterProps({ ...base, manageGoal }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(composer(surface)), 10000);
  await command(surface, '/goal My preserved edit');
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-command-chip')) && Boolean(surface.querySelector('[role="alert"]')));
  expect(composer(surface).value).toBe('My preserved edit');
  expect(surface.querySelector('[role="alert"]')?.textContent).toContain('Your edit is preserved');
  expect(surface.querySelector('.flower-goal-current')?.textContent).toBe('Changed elsewhere');
  composer(surface).focus(); await userEvent.keyboard('{Enter}');
  await waitFor(() => manageGoal.mock.calls.length === 2);
  const first = manageGoal.mock.calls[0]![0], second = manageGoal.mock.calls[1]![0];
  expect(second.operation).toBe('submit'); expect(second.expected_version).toBe(3); expect(second.text).toBe('My preserved edit');
  expect(second.client_request_id).not.toBe(first.client_request_id);
  await waitFor(() => surface.querySelector('.flower-goal-command-chip') === null);
});

it('retries an unknown Goal mutation with the exact original request', async () => {
  const base = adapter(true);
  const manageGoal = vi.fn(async (input: FlowerGoalInput) => { if (manageGoal.mock.calls.length === 1) throw flowerTurnAdmissionError('unknown', new Error('Response lost')); return response(input); });
  const surface = renderSurfaceWithAdapterProps({ ...base, manageGoal }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(composer(surface)), 10000);
  await command(surface, '/goal Verify the result');
  await waitFor(() => Boolean(surface.querySelector('[data-flower-transport-delivery="unknown"]')));
  const retry = surface.querySelector<HTMLButtonElement>('[data-flower-transport-delivery="unknown"] [aria-label="Retry send"]')
    ?? [...surface.querySelectorAll<HTMLButtonElement>('[data-flower-transport-delivery="unknown"] button')].find(button => button.textContent?.includes('Retry'));
  expect(retry).toBeDefined(); await userEvent.click(retry!);
  await waitFor(() => manageGoal.mock.calls.length === 2);
  expect(manageGoal.mock.calls[1]![0]).toEqual(manageGoal.mock.calls[0]![0]);
  await waitFor(() => surface.querySelector('[data-flower-transport-delivery="unknown"]') === null);
  expect(base.launchTurn).not.toHaveBeenCalled();
});

it.each(['running', 'waiting_approval', 'waiting_user'] as const)('keeps Goal editing and navigation available during %s', async status => {
  const base = adapter(true); const snapshot = thread({ status, goal: { version: 1, text: 'Original', status: 'active', actor: 'user' } });
  const loadThread = vi.fn(async () => ({ ...liveBootstrap(snapshot, 20), current: { ...liveBootstrap(snapshot, 20).current, goal: snapshot.goal } }));
  const manageGoal = vi.fn(async (input: FlowerGoalInput) => response(input));
  const surface = renderSurfaceWithAdapterProps({ ...base, listThreads: async () => [snapshot], loadThread, manageGoal }, { focusThreadRequest: focus });
  await waitFor(() => surface.querySelector('.flower-goal-tag')?.getAttribute('title') === 'Original', 10000);
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-popup [aria-label="Delete goal"]')!);
  await waitFor(() => manageGoal.mock.calls.length === 1);
  expect(manageGoal.mock.calls[0]![0]).toMatchObject({ thread_id: 'thread-1', expected_version: 1, operation: 'delete' });
  expect(base.stopThread).not.toHaveBeenCalled();
  expect(base.launchTurn).not.toHaveBeenCalled();
});

it('retains popup edits on dismiss and across restart while save remains edit-only', async () => {
  const base = adapter(true), coordinator = createFlowerComposerDraftCoordinator();
  let currentDetail: FlowerThreadView | undefined;
  const loadThread = vi.fn(async (threadID: string, signal: AbortSignal) => currentDetail?.thread.thread_id === threadID ? currentDetail : base.loadThread(threadID, signal));
  const manageGoal = vi.fn(async (input: FlowerGoalInput) => {
    const accepted = response(input);
    currentDetail = goalDetail(accepted);
    return accepted;
  });
  const surface = renderSurfaceWithDraftCoordinator({ ...base, loadThread, manageGoal }, coordinator);
  await waitFor(() => Boolean(composer(surface)), 10000);
  await command(surface, '/goal Original');
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-tag')));
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
  expect(surface.querySelector('.flower-goal-actions')).toBeNull();
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: surface, path: '__screenshots__/flower-goal-popup.png' });
  edit(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')!, 'My unsaved goal');
  await userEvent.keyboard('{Escape}');
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')!.value).toBe('Original');
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')!.readOnly).toBe(true);
  await userEvent.click(action(surface, 'Continue editing'));
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')!.value).toBe('My unsaved goal');
  const restored = createFlowerComposerDraftCoordinator();
  restored.restoreAfterRestart(coordinator.exportForRestart());
  expect(restored.read('created-goal').value.goal_edit?.text).toBe('My unsaved goal');
  await userEvent.click(action(surface, 'Save goal'));
  await waitFor(() => manageGoal.mock.calls.length === 2);
  expect(manageGoal.mock.calls[1]![0].operation).toBe('set');
  expect(base.launchTurn).not.toHaveBeenCalled();
  restored.dispose();
});

it('allows dismissing an uncertain Goal request and preserves its input for recovery', async () => {
  const base = adapter(true);
  const manageGoal = vi.fn(async () => { throw flowerTurnAdmissionError('unknown', new Error('Response lost')); });
  const surface = renderSurfaceWithAdapterProps({ ...base, manageGoal }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(composer(surface)), 10000);
  await command(surface, '/goal Recoverable goal');
  await waitFor(() => Boolean(surface.querySelector('[data-flower-transport-delivery="unknown"]')));
  const remove = surface.querySelector<HTMLButtonElement>('[data-flower-transport-delivery="unknown"] [aria-label="Remove local recovery copy"]')
    ?? surface.querySelector<HTMLButtonElement>('[data-flower-transport-delivery="unknown"] .flower-queued-turn-delete');
  expect(remove).not.toBeNull(); await userEvent.click(remove!);
  await waitFor(() => !surface.querySelector('[data-flower-transport-delivery="unknown"]'));
  expect(composer(surface).value).toBe('Recoverable goal');
  expect(surface.querySelector('.flower-goal-command-chip')).not.toBeNull();
  expect(base.launchTurn).not.toHaveBeenCalled();
});

it('keeps an inconsistent Goal response recoverable without consuming the draft', async () => {
  const base = adapter(true);
  const manageGoal = vi.fn(async (input: FlowerGoalInput) => {
    const accepted = response(input);
    return { ...accepted, current: { ...accepted.current, goal: { ...accepted.goal, version: 0 } } };
  });
  const surface = renderSurfaceWithAdapterProps({ ...base, manageGoal }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(composer(surface)), 10000);
  await command(surface, '/goal Verify result');
  await waitFor(() => Boolean(surface.querySelector('[data-flower-transport-delivery="unknown"]')));
  expect(composer(surface).value).toBe('Verify result');
  expect(base.launchTurn).not.toHaveBeenCalled();
});

it('keeps empty Goal mode local and restores an ordinary draft on every exit', async () => {
  const base = adapter(true), coordinator = createFlowerComposerDraftCoordinator();
  const manageGoal = vi.fn(async (input: FlowerGoalInput) => response(input));
  coordinator.open('__new_thread__').mutate(value => ({ ...value, text: 'Preserved ordinary draft', goal_command: { text: '' } }));
  const surface = renderSurfaceWithDraftCoordinator({ ...base, manageGoal }, coordinator);
  await waitFor(() => Boolean(composer(surface)), 10000);
  expect(surface.querySelector('.flower-goal-tag')).toBeNull();
  expect(surface.querySelector('.flower-goal-popup')).toBeNull();
  expect(surface.querySelector<HTMLButtonElement>('[data-flower-primary-action="goal"]')!.disabled).toBe(true);
  composer(surface).focus(); await userEvent.keyboard('{Enter}');
  expect(manageGoal).not.toHaveBeenCalled(); expect(base.launchTurn).not.toHaveBeenCalled();
  await userEvent.keyboard('{Backspace}');
  expect(composer(surface).value).toBe('Preserved ordinary draft');
  edit(composer(surface), '/goal ');
  expect(surface.querySelector('.flower-goal-command-chip')).not.toBeNull();
  edit(composer(surface), 'Unsent goal');
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-command-chip button')!);
  expect(surface.querySelector('.flower-goal-command-chip')).toBeNull();
  expect(manageGoal).not.toHaveBeenCalled();
});

it('retains a newer identical command edit when the submitted request returns', async () => {
  const base = adapter(true), pending = deferred<FlowerGoalResult>();
  const manageGoal = vi.fn((_input: FlowerGoalInput) => pending.promise);
  const surface = renderSurfaceWithAdapterProps({ ...base, manageGoal }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(composer(surface)), 10000);
  await command(surface, '/goal Original');
  await waitFor(() => manageGoal.mock.calls.length === 1);
  edit(composer(surface), 'Changed'); edit(composer(surface), 'Original');
  pending.resolve(response(manageGoal.mock.calls[0]![0]));
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-tag')));
  expect(composer(surface).value).toBe('Original');
  expect(surface.querySelector('.flower-goal-command-chip')).not.toBeNull();
});

it('keeps pasted Goal text intact without long-text conversion or IME submission', async () => {
  const base = adapter(true), coordinator = createFlowerComposerDraftCoordinator();
  const manageGoal = vi.fn(async (input: FlowerGoalInput) => response(input));
  const surface = renderSurfaceWithDraftCoordinator({ ...base, manageGoal }, coordinator);
  await waitFor(() => Boolean(composer(surface)), 10000);
  edit(composer(surface), '/goal ');
  const input = composer(surface), text = 'Keep this objective intact. '.repeat(3000);
  const data = new DataTransfer(); data.setData('text/plain', text);
  const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
  input.dispatchEvent(paste);
  expect(paste.defaultPrevented).toBe(false);
  edit(input, text);
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: surface, path: '__screenshots__/flower-goal-command.png' });
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', isComposing: true }));
  expect(manageGoal).not.toHaveBeenCalled();
  expect(coordinator.read('__new_thread__').value.attachments).toEqual([]);
  input.focus(); await userEvent.keyboard('{Enter}');
  await waitFor(() => manageGoal.mock.calls.length === 1);
  expect(manageGoal.mock.calls[0]![0].text).toBe(text.trim());
});

it.each(['question', 'approval'] as const)('submits Goal during %s without resolving the original interaction', async kind => {
  const base = adapter(true);
  let snapshot = kind === 'question' ? thread({ status: 'waiting_user', input_request: inputRequest() }) : thread({
    status: 'waiting_approval', approval_actions: [{ action_id: 'approve-goal', turn_id: 'turn-1', origin: 'main_tool', run_id: 'run:thread-1', tool_id: 'write', tool_name: 'terminal.exec', state: 'requested', status: 'pending', requested_at_ms: 1, can_approve: true, summary: { label: 'Write result', command: 'touch result' } }],
  });
  let version = 20;
  const manageGoal = vi.fn(async (input: FlowerGoalInput) => {
    const goal = response(input).goal;
    snapshot = { ...snapshot, goal };
    return { ...response(input), current: { ...liveBootstrap(snapshot, ++version).current, goal } };
  });
  const surface = renderSurfaceWithAdapterProps({ ...base, listThreads: async () => [snapshot], loadThread: async () => ({ ...liveBootstrap(snapshot, version), current: { ...liveBootstrap(snapshot, version).current, goal: snapshot.goal } }), manageGoal }, { focusThreadRequest: focus });
  const mode = kind === 'question' ? 'input_request' : 'approval';
  await waitFor(() => Boolean(surface.querySelector('[data-flower-bottom-mode="' + mode + '"]')), 10000);
  expect(surface.querySelector('.flower-goal-tag')).toBeNull();
  const transcript = surface.querySelector<HTMLElement>('.flower-chat-transcript')!;
  transcript.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 180, clientY: 120 }));
  await waitFor(() => Boolean([...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === '/goal')));
  await userEvent.click([...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === '/goal')!);
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-command-chip')));
  edit(composer(surface), 'Deliver the updated result'); composer(surface).focus(); await userEvent.keyboard('{Enter}');
  await waitFor(() => Boolean(surface.querySelector('[data-flower-bottom-mode="' + mode + '"]')));
  expect(manageGoal.mock.calls[0]![0].operation).toBe('submit');
  expect(base.submitInput).not.toHaveBeenCalled(); expect(base.submitApproval).not.toHaveBeenCalled();
  expect(base.launchTurn).not.toHaveBeenCalled(); expect(base.stopThread).not.toHaveBeenCalled();
  expect(surface.querySelector('.flower-goal-tag')?.closest('.flower-model-status-lane')).not.toBeNull();
});

it('uses the shared floating layer and keeps the popup and tag inside a narrow transformed surface', async () => {
  const base = adapter(true), snapshot = thread({ goal: { text: 'Verify the production result', version: 1, status: 'active', actor: 'user' } });
  const surface = renderSurfaceWithAdapterProps({ ...base, listThreads: async () => [snapshot], loadThread: async () => ({ ...liveBootstrap(snapshot, 20), current: { ...liveBootstrap(snapshot, 20).current, goal: snapshot.goal } }), manageGoal: async input => response(input) }, { focusThreadRequest: focus });
  surface.style.cssText = 'width:360px;height:700px;transform:translate(16px, 12px) scale(.85);transform-origin:top left;';
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-tag')), 10000);
  const trigger = surface.querySelector<HTMLButtonElement>('.flower-goal-tag')!;
  await userEvent.click(trigger);
  await waitFor(() => Boolean(document.querySelector('.flower-goal-popup')));
  const popup = document.querySelector<HTMLElement>('.flower-goal-popup')!;
  await waitFor(() => popup.getBoundingClientRect().width > 0);
  expect(popup.style.position).not.toBe('fixed'); expect(popup.style.left).toBe(''); expect(popup.style.top).toBe('');
  expect(popup.closest('[data-floe-local-interaction-surface]')).not.toBeNull();
  const rect = popup.getBoundingClientRect();
  expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
  expect(trigger.parentElement?.classList.contains('flower-model-status-lane')).toBe(true);
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: surface, path: '__screenshots__/flower-goal-popup-narrow.png' });
  await userEvent.keyboard('{Escape}'); expect(document.activeElement).toBe(trigger);
});

it('preserves newer popup edits and keeps subsequent saves edit-only', async () => {
  const base = adapter(true), pending = deferred<FlowerGoalResult>();
  const manageGoal = vi.fn((input: FlowerGoalInput) => manageGoal.mock.calls.length === 2 ? pending.promise : Promise.resolve(response(input)));
  const surface = renderSurfaceWithAdapterProps({ ...base, manageGoal }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(composer(surface)), 10000);
  await command(surface, '/goal Original');
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-tag')));
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
  edit(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')!, 'Submitted edit');
  await userEvent.click(action(surface, 'Save goal'));
  await waitFor(() => manageGoal.mock.calls.length === 2);
  edit(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')!, 'Newer unsent edit');
  pending.resolve(response(manageGoal.mock.calls[1]![0]));
  await waitFor(() => surface.querySelector('.flower-goal-tag')?.getAttribute('title') === 'Submitted edit');
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')?.value).toBe('Newer unsent edit');
  await userEvent.click(action(surface, 'Save goal'));
  await waitFor(() => manageGoal.mock.calls.length === 3);
  expect(manageGoal.mock.calls[2]![0]).toMatchObject({ operation: 'set', text: 'Newer unsent edit', expected_version: 2 });
  expect(base.launchTurn).not.toHaveBeenCalled(); expect(base.stopThread).not.toHaveBeenCalled();
});

it('preserves popup conflict edits without converting a save into submission', async () => {
  const base = adapter(true);
  const manageGoal = vi.fn(async (input: FlowerGoalInput) => manageGoal.mock.calls.length === 2 ? response({ ...input, text: 'Changed remotely' }, 4, true) : response(input));
  const surface = renderSurfaceWithAdapterProps({ ...base, manageGoal }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(composer(surface)), 10000);
  await command(surface, '/goal Original');
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-tag')));
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
  edit(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')!, 'Preserved popup edit');
  await userEvent.click(action(surface, 'Save goal'));
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-popup .flower-goal-notice')));
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')?.value).toBe('Preserved popup edit');
  await userEvent.click(action(surface, 'View current goal'));
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')?.value).toBe('Changed remotely');
  await userEvent.click(action(surface, 'Continue editing'));
  await userEvent.click(action(surface, 'Replace current goal'));
  await waitFor(() => manageGoal.mock.calls.length === 3);
  expect(manageGoal.mock.calls[2]![0]).toMatchObject({ operation: 'set', text: 'Preserved popup edit', expected_version: 4 });
  expect(surface.querySelector('.flower-goal-command-chip')).toBeNull();
});

it.each([['en-US', 1100, 'light'], ['zh-CN', 390, 'light'], ['en-US', 1100, 'dark'], ['zh-CN', 390, 'dark']] as const)('keeps %s Goal checks quiet and readable at %s px in %s mode', async (locale, width, theme) => {
  await page.viewport(width, 850);
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const i18n = createTestI18nHelpers(locale);
  const copy = createLocalizedFlowerSurfaceCopy({ locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
  const text = locale === 'zh-CN' ? '在本地启动 Redeven 开发环境，保留现有数据并验证服务可用。\n完整保留目标原文。' : 'Start the local development environment, preserve the existing data and verify availability.\nKeep the complete original goal.';
  const evidence = locale === 'zh-CN' ? '等待你确认处理方式后继续。' : 'Waiting for your decision before continuing.';
  const base = adapter(true), snapshot = thread({ messages: [], status: 'waiting_user', goal: { version: 2, status: 'active', text: 'A newer objective', actor: 'user' } });
  const cases = [
    { id: 'review-continue', status: 'success', goal: { operation: 'review', outcome: 'continue', text, evidence }, label: copy.chat.goalReviewIncomplete },
    { id: 'review-blocked', status: 'success', goal: { operation: 'review', outcome: 'blocked', text, evidence }, label: copy.chat.goalReviewBlocked },
    { id: 'review-completed', status: 'success', goal: { operation: 'review', outcome: 'completed', text, evidence }, label: copy.chat.goalReviewChecked },
    { id: 'review-running', status: 'running', goal: { operation: 'review', text }, label: copy.chat.goalReviewing },
    { id: 'review-missing', status: 'success', label: copy.chat.goalReviewUnavailable },
  ] as const;
  const current: FlowerRuntimeCurrentView = { ...liveBootstrap(snapshot, 20).current, activity: 'active', interactions: [{ id: 'input-1', turn_id: 'review-turn', run_id: 'review-run', kind: 'input', input: { summary: 'Choose how to continue', questions: [{ id: 'choice', header: 'Choice', prompt: 'Choose how to continue', kind: 'select', options: ['Preserve data', 'Pause'] }] } }], items: cases.map((test, index) => ({
    id: test.id, ordinal: index + 1, canonical_ordinal: index + 1, kind: 'tool', turn_id: 'review-turn', run_id: 'review-run', activity: { item_id: test.id, tool_id: test.id, tool_name: 'goal', kind: 'tool', status: test.status, severity: 'quiet', needs_attention: false, requires_approval: false, started_at_unix_ms: 1, ended_at_unix_ms: test.status === 'running' ? undefined : 36, presentation: { renderer: 'structured', payload: 'goal' in test ? { goal: { version: 1, ...test.goal } } : { summary: 'Historical tool activity' } } },
  })) };
  const surface = renderSurfaceWithAdapterProps({ ...base, listThreads: async () => [snapshot], loadThread: async () => ({ thread: applyFlowerRuntimeCurrentView(snapshot, current), current }) }, { copy, focusThreadRequest: focus });
  surface.style.cssText = 'width:100%;height:800px;position:relative;';
  await waitFor(() => surface.querySelectorAll('.flower-activity-inline-row-goal').length === cases.length, 10000);
  expect(surface.querySelector('[data-flower-goal-change="completed"]')).toBeNull();
  for (const test of cases) {
    const row = surface.querySelector<HTMLElement>('[data-flower-activity-item-id="' + test.id + '"]')!;
    expect(row.querySelector('[data-flower-goal-icon]')).not.toBeNull();
    expect(row.querySelector('.flower-activity-inline-title')?.textContent).toBe(test.label);
    expect(test.label).not.toContain('flowerSurface.');
    expect(getComputedStyle(row.closest('.flower-activity-inline')!).borderLeftWidth).toBe('0px');
    expect(row.querySelector('.flower-activity-inline-duration')).toBeNull();
    expect(row.querySelector('.flower-activity-inline-line')!.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    if (test.id === 'review-missing') {
      expect(row.querySelector('button')).toBeNull();
      expect(row.textContent).not.toContain('Historical tool activity');
      continue;
    }
    const button = row.querySelector<HTMLButtonElement>('button')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.focus(); await userEvent.keyboard('{Enter}');
    await waitFor(() => Boolean(row.querySelector('.flower-goal-review-text')));
    expect(row.querySelector('.flower-goal-review-text')?.textContent).toBe(text);
    const body = row.querySelector('.flower-activity-inline-details-content')!;
    expect(getComputedStyle(body).borderLeftWidth).toBe('0px');
    expect(getComputedStyle(body).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(body.textContent).not.toContain('A newer objective');
    if ('evidence' in test.goal) expect(row.querySelector('.flower-goal-review-evidence')?.textContent).toBe(evidence);
  }
  surface.querySelectorAll<HTMLButtonElement>('.flower-activity-inline-row-goal button[aria-expanded="true"]').forEach(button => button.click());
  await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="review-continue"] button')!);
  await userEvent.click(surface.querySelector<HTMLElement>('.flower-goal-review-text')!);
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: surface, path: '__screenshots__/flower-goal-review-' + locale + '-' + theme + '.png' });
});
