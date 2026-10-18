import '../index.css';
import './flower-feature.css';
import { userEvent } from 'vitest/browser';
import { expect, it, vi } from 'vitest';
import type { FlowerGoal, FlowerGoalInput, FlowerGoalResult, FlowerRuntimeCurrentView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { withModelDirectoryFixture } from '../../../../flower_ui/testing/modelDirectoryFixture';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import { adapter, deferred, liveBootstrap, thread, renderSurfaceWithAdapterProps, renderSurfaceWithDraftCoordinator, waitFor } from './FlowerSurface.navigation.testHarness';

const focus = { request_id: 'goal-focus', thread_id: 'thread-1' };
function response(input: FlowerGoalInput, version = input.expected_version + 1, conflict = false): FlowerGoalResult {
  const goal: FlowerGoal = { version, text: input.operation === 'set' ? input.text : undefined, status: input.operation === 'set' ? 'active' : 'absent', actor: 'user' };
  const current: FlowerRuntimeCurrentView = { thread_id: input.thread_id || 'created-goal', view_version: version + 2, activity: 'idle', goal, items: [{ id: 'goal:' + version, ordinal: version, kind: 'goal', goal: { goal, operation: input.operation, actor: 'user', at: '2026-10-18T00:00:00Z' } }] };
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

it('opens Goal from slash suggestions with keyboard and restores composer focus on Escape', async () => {
  const base = adapter(true);
  const manageGoal = vi.fn(async (input: FlowerGoalInput) => response(input));
  const surface = renderSurfaceWithAdapterProps({ ...base, manageGoal }, { focusThreadRequest: focus });
  await waitFor(() => Boolean(composer(surface)), 10000);
  const input = composer(surface); edit(input, '/'); input.focus();
  await waitFor(() => surface.querySelectorAll('.flower-composer-command-item').length === 2);
  await userEvent.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-input')));
  const goal = surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')!;
  await waitFor(() => document.activeElement === goal);
  expect(input.value).toBe('');
  await userEvent.keyboard('{Escape}');
  expect(surface.querySelector('.flower-goal-input')).toBeNull();
  expect(document.activeElement).toBe(input);
  expect(base.launchTurn).not.toHaveBeenCalled(); expect(manageGoal).not.toHaveBeenCalled();
});

it('creates only a conversation and goal while preserving attachment, reference and newer text drafts', async () => {
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
  await waitFor(() => surface.querySelector('.flower-goal-text')?.textContent === 'Verify the deployment');
  expect(composer(surface).value).toBe('Newer draft');
  expect(coordinator.read('created-goal').value.attachments).toEqual(attachments);
  expect(coordinator.read('created-goal').value.references).toEqual(references);
  expect(uploadAttachment).not.toHaveBeenCalled();
  expect(surface.querySelector('[data-flower-goal-change="set"]')).not.toBeNull();
  expect(base.launchTurn).not.toHaveBeenCalled();
  composer(surface).focus(); await userEvent.keyboard('{Enter}');
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
  await waitFor(() => Boolean(surface.querySelector('.flower-goal-input')));
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')!.value).toBe('My preserved edit');
  expect(surface.querySelector('[role="alert"]')?.textContent).toContain('Your edit is preserved');
  expect(surface.querySelector('.flower-goal-current')?.textContent).toBe('Changed elsewhere');
  await userEvent.click(action(surface, 'Save goal'));
  await waitFor(() => manageGoal.mock.calls.length === 2);
  const first = manageGoal.mock.calls[0]![0], second = manageGoal.mock.calls[1]![0];
  expect(second.expected_version).toBe(3); expect(second.text).toBe('My preserved edit');
  expect(second.client_request_id).not.toBe(first.client_request_id);
  await waitFor(() => surface.querySelector('.flower-goal-input') === null);
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
  const loadThread = vi.fn(async () => ({ ...liveBootstrap(snapshot), current: { ...liveBootstrap(snapshot).current, goal: snapshot.goal } }));
  const manageGoal = vi.fn(async (input: FlowerGoalInput) => response(input));
  const surface = renderSurfaceWithAdapterProps({ ...base, loadThread, manageGoal }, { focusThreadRequest: focus });
  await waitFor(() => surface.querySelector('.flower-goal-text')?.textContent === 'Original', 10000);
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-summary')!);
  await userEvent.click(action(surface, 'Delete goal'));
  await waitFor(() => manageGoal.mock.calls.length === 1);
  expect(manageGoal.mock.calls[0]![0]).toMatchObject({ thread_id: 'thread-1', expected_version: 1, operation: 'delete' });
  expect(base.stopThread).not.toHaveBeenCalled();
  expect(base.launchTurn).not.toHaveBeenCalled();
});

it('retains unsaved Goal edits when the summary is clicked again and across draft restart', async () => {
  const base = adapter(true), coordinator = createFlowerComposerDraftCoordinator();
  const manageGoal = vi.fn(async (input: FlowerGoalInput) => response(input));
  const surface = renderSurfaceWithDraftCoordinator({ ...base, manageGoal }, coordinator);
  await waitFor(() => Boolean(composer(surface)), 10000);
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-summary')!);
  edit(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')!, 'My unsaved goal');
  await userEvent.click(surface.querySelector<HTMLButtonElement>('.flower-goal-summary')!);
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-goal-input')!.value).toBe('My unsaved goal');
  const restored = createFlowerComposerDraftCoordinator();
  restored.restoreAfterRestart(coordinator.exportForRestart());
  expect(restored.read('__new_thread__').value.goal_edit?.text).toBe('My unsaved goal');
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
  expect(composer(surface).value).toBe('/goal Recoverable goal');
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
  expect(composer(surface).value).toBe('/goal Verify result');
  expect(base.launchTurn).not.toHaveBeenCalled();
});
