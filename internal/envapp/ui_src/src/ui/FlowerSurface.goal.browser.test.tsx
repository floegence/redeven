import '../index.css';
import './flower-feature.css';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import type { FlowerGoal, FlowerGoalInput, FlowerGoalResult, FlowerRuntimeCurrentView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { withModelDirectoryFixture } from '../../../../flower_ui/testing/modelDirectoryFixture';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import type { EnvAppTranslationKey } from './i18n';
import { adapter, deferred, inputRequest, liveBootstrap, thread, renderSurfaceWithAdapterProps, renderSurfaceWithDraftCoordinator, waitFor } from './FlowerSurface.navigation.testHarness';

const focus = { request_id: 'goal-focus', thread_id: 'thread-1' };
afterEach(() => document.documentElement.classList.remove('dark'));
function response(input: FlowerGoalInput, version = input.expected_version + 1, conflict = false): FlowerGoalResult {
  const goal: FlowerGoal = { version, text: input.operation !== 'delete' ? input.text : undefined, status: input.operation !== 'delete' ? 'active' : 'absent', actor: 'user' };
  const current: FlowerRuntimeCurrentView = { thread_id: input.thread_id || 'created-goal', view_version: version + 2, activity: 'idle', goal, items: [{ id: 'goal:' + version, ordinal: version, kind: 'goal', goal: { goal, operation: input.operation === 'delete' ? 'delete' : 'set', actor: 'user', at: '2026-10-18T00:00:00Z' } }] };
  return { client_request_id: input.client_request_id, thread_id: current.thread_id, current, goal, conflict };
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
  const button = [...surface.querySelectorAll<HTMLButtonElement>('.flower-goal-actions button')].find(item => item.textContent === label);
  if (!button) throw new Error('Goal action is unavailable: ' + label);
  return button;
}

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
    { id: 'goal-done', ordinal: 3, canonical_ordinal: 3, kind: 'goal', goal: { goal, operation: 'completed', actor: 'model', at: '2026-10-18T00:01:00Z' } },
  ] };
  const surface = renderSurfaceWithAdapterProps({ ...base, listThreads: async () => [snapshot], loadThread: async () => ({ thread: applyFlowerRuntimeCurrentView(snapshot, current), current }) }, { copy, focusThreadRequest: focus });
  surface.style.cssText = 'width:100%;height:800px;position:relative;';
  await waitFor(() => surface.querySelectorAll('.flower-goal-history').length === 2, 10000);
  const badge = surface.querySelector<HTMLButtonElement>('.flower-goal-tag')!;
  expect(badge.querySelector('[data-flower-goal-icon]')).not.toBeNull();
  expect(badge.querySelector('.flower-goal-dot')).toBeNull();
  const badgeStyle = getComputedStyle(badge);
  expect(badgeStyle.borderTopWidth).toBe('0px');
  expect(parseFloat(badgeStyle.borderTopLeftRadius)).toBeGreaterThan(0);
  expect(parseFloat(badgeStyle.borderTopLeftRadius)).toBeLessThan(badge.getBoundingClientRect().height / 2);
  expect(surface.querySelector('[data-flower-tool-call-id="goal-call"]')).toBeNull();
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: surface, path: '__screenshots__/flower-goal-history-' + locale + '-' + theme + '.png' });
  for (const [index, label] of [copy.chat.goalSet, copy.chat.goalCompleted].entries()) {
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
    const bodyStyle = getComputedStyle(body);
    expect(bodyStyle.borderTopWidth).toBe('0px');
    expect(bodyStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(bodyStyle.boxShadow).toBe('none');
    expect(body.getBoundingClientRect().left).toBeCloseTo(summary.querySelector('.flower-goal-history-label')!.getBoundingClientRect().left, 0);
    expect(getComputedStyle(summary).outlineStyle).not.toBe('none');
  }
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') {
    await userEvent.click(surface.querySelector<HTMLElement>('.flower-goal-history-actor')!);
    await page.screenshot({ element: surface, path: '__screenshots__/flower-goal-history-expanded-' + locale + '-' + theme + '.png' });
  }
  await userEvent.click(badge);
  await waitFor(() => Boolean(document.querySelector('.flower-goal-popup')));
  const popup = document.querySelector<HTMLElement>('.flower-goal-popup')!;
  const editor = popup.querySelector<HTMLTextAreaElement>('.flower-goal-input')!;
  await waitFor(() => document.activeElement === editor);
  const popupStyle = getComputedStyle(popup);
  expect(popupStyle.borderTopWidth).toBe('0px');
  expect(popupStyle.outlineStyle).toBe('none');
  expect(popupStyle.boxShadow).not.toBe('none');
  expect(popup.hasAttribute('data-floe-input-surface')).toBe(false);
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: surface, path: '__screenshots__/flower-goal-popup-' + locale + '-' + theme + '.png' });
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
  expect(document.activeElement).toBe(popup.querySelector('.flower-goal-popup-controls button:last-child'));
  expect(getComputedStyle(document.activeElement!).boxShadow).not.toBe('none');
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement).toBe(badge);
  expect(getComputedStyle(badge).outlineStyle).not.toBe('none');
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
  expect(row.querySelector('.flower-activity-inline-title')?.textContent).toBe('Goal');
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
  await waitFor(() => surface.querySelectorAll('.flower-composer-command-item').length === 2);
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
  const surface = renderSurfaceWithDraftCoordinator({ ...base, manageGoal, loadSettings: async () => withModelDirectoryFixture(await base.loadSettings()), loadAttachmentCapability: async () => capability, uploadAttachment, bindAttachmentStagingScope, launchTurn }, coordinator);
  await waitFor(() => Boolean(composer(surface)), 10000);
  await command(surface, '/goal Verify the deployment');
  await waitFor(() => manageGoal.mock.calls.length === 1);
  const input = manageGoal.mock.calls[0]![0];
  expect(input.thread_id).toBeUndefined(); expect(input.new_thread).toBeDefined();
  expect(base.launchTurn).not.toHaveBeenCalled();
  edit(composer(surface), 'Newer draft');
  pending.resolve(response(input));
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
  const manageGoal = vi.fn(async (input: FlowerGoalInput) => response(input));
  const surface = renderSurfaceWithDraftCoordinator({ ...base, manageGoal }, coordinator);
  await waitFor(() => Boolean(composer(surface)), 10000);
  await command(surface, '/goal Original');
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-tag')));
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
  expect(surface.querySelector('.flower-goal-actions')).toBeNull();
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: surface, path: '__screenshots__/flower-goal-popup.png' });
  edit(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')!, 'My unsaved goal');
  await userEvent.keyboard('{Escape}');
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-tag')!);
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
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-popup [role="alert"]')));
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')?.value).toBe('Preserved popup edit');
  await userEvent.click(action(surface, 'Save goal'));
  await waitFor(() => manageGoal.mock.calls.length === 3);
  expect(manageGoal.mock.calls[2]![0]).toMatchObject({ operation: 'set', text: 'Preserved popup edit', expected_version: 4 });
  expect(surface.querySelector('.flower-goal-command-chip')).toBeNull();
});
