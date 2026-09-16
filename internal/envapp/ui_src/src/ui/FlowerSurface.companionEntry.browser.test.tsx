import '../index.css';
import './flower-feature.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { BottomBarCompanion, type BottomBarCompanionPhase } from '@floegence/floe-webapp-core/layout';
import { FlowerSurface, createFlowerComposerDraftCoordinator, type FlowerThreadFocusRequest, type FlowerSurfaceProps } from '../../../../flower_ui/src';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerThreadSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, inputRequest, liveBootstrap, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const companionCopy = {
  label: 'Switch Flower conversation', searchPlaceholder: 'Search conversations...',
  newConversation: 'New conversation', empty: 'No matching conversations', queued: 'Queued',
  groups: { attention: 'Needs attention', working: 'Working', pinned: 'Pinned', recent: 'Recent' },
  threadList: DEFAULT_FLOWER_SURFACE_COPY.threadList,
};

function choiceThread(mode: 'select' | 'select_or_write' = 'select_or_write'): FlowerThreadSnapshot {
  const request = inputRequest();
  return thread({
    thread_id: 'thread-companion-choice', title: 'Travel questionnaire', status: 'waiting_user',
    input_request: { ...request, questions: request.questions.map((question) => ({ ...question, response_mode: mode })) },
  });
}

function mountCompanion(selected: FlowerThreadSnapshot, summary?: FlowerSurfaceProps['companionSummary']) {
  const idle = thread({ thread_id: 'thread-idle' });
  const threads = [selected, idle];
  const surfaceAdapter = {
    ...adapter(true),
    listThreads: vi.fn(async () => threads),
    loadThread: vi.fn(async (id: string) => liveBootstrap(threads.find((value) => value.thread_id === id)!)),
    connectLiveStream: vi.fn(async function* (input) {
      yield { schema_version: 1 as const, kind: 'ready' as const, summaries: threads };
      await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }));
    }),
  } satisfies import('../../../../flower_ui/src/contracts/flowerSurfaceContracts').FlowerSurfaceAdapter;
  const runtime = document.createElement('div');
  const anchor = document.createElement('div');
  Object.assign(anchor.style, { position: 'fixed', left: '12px', bottom: '3px', width: '360px', height: '22px' });
  const mount = document.createElement('div');
  const outside = document.createElement('button');
  outside.textContent = 'Outside';
  document.body.append(runtime, anchor, mount, outside);
  const [open, setOpen] = createSignal(false);
  const [phase, setPhase] = createSignal<BottomBarCompanionPhase>('collapsed');
  const [focusRequest, setFocusRequest] = createSignal<FlowerThreadFocusRequest | null>({ request_id: 'initial', thread_id: selected.thread_id });
  const [focusComposerRequest, setFocusComposerRequest] = createSignal(0);
  const requestOpen = vi.fn(() => setOpen(true));
  const dispose = render(() => (
    <BottomBarCompanion retained visible open={open()} anchor={anchor} mount={mount}
      id="companion-entry-test" label="Flower" expandedWidth={544} onPhaseChange={setPhase}
      onDismiss={(reason) => {
        if (reason === 'escape') setFocusComposerRequest((value) => value + 1);
        else outside.focus();
        setOpen(false);
      }}>
      <FlowerSurface adapter={surfaceAdapter} draftCoordinator={createFlowerComposerDraftCoordinator()} notify={vi.fn()}
        presentation="companion" companionPresenceOwner engaged={open()} transcriptVisible={open()}
        companionOpen={open() || phase() === 'expanding' || phase() === 'collapsing'}
        companionRegionID="companion-entry-test" companionCopy={companionCopy}
        companionActionLabel="Open Flower to continue" onCompanionOpenRequest={requestOpen}
        companionSummary={summary}
        focusThreadRequest={focusRequest()} onFocusThreadRequestConsumed={() => setFocusRequest(null)}
        focusComposerRequest={focusComposerRequest()}
      />
    </BottomBarCompanion>
  ), runtime);
  onTestFinished(dispose);
  return { mount, outside, open, phase, setOpen, requestOpen, setFocusRequest, surfaceAdapter };
}

type Fixture = ReturnType<typeof mountCompanion>;
async function collapsedAction(fixture: Fixture): Promise<HTMLButtonElement> {
  await waitFor(() => fixture.mount.querySelector('main')?.dataset.flowerSelectedThreadLoading === 'false'
    && Boolean(fixture.mount.querySelector('.flower-companion-collapsed-action')));
  return fixture.mount.querySelector<HTMLButtonElement>('.flower-companion-collapsed-action')!;
}

async function closeWithEscape(fixture: Fixture) {
  await userEvent.keyboard('{Escape}');
  await waitFor(() => fixture.phase() === 'collapsed');
}

describe('Flower companion entry with the published shell', () => {
  it('opens the selected choice request from the collapsed entry without submitting it', async () => {
    await page.viewport(1280, 800);
    const fixture = mountCompanion(choiceThread());
    await waitFor(() => fixture.mount.querySelector('main')?.dataset.flowerSelectedThreadStatus === 'waiting_user');
    const action = fixture.mount.querySelector<HTMLButtonElement>('.flower-companion-collapsed-action');
    expect(action, 'a choice request must leave a visible drawer entry').not.toBeNull();
    expect(action!.getBoundingClientRect().width).toBeGreaterThan(100);
    await userEvent.click(action!);
    await waitFor(() => fixture.phase() === 'expanded');
    expect(fixture.mount.querySelector('.flower-input-request-surface')!.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(fixture.requestOpen).toHaveBeenCalledTimes(1);
    expect(fixture.surfaceAdapter.submitInput).not.toHaveBeenCalled();
    expect(fixture.surfaceAdapter.launchTurn).not.toHaveBeenCalled();
    expect(fixture.surfaceAdapter.stopThread).not.toHaveBeenCalled();
  });

  it.each(['{Enter}', ' '])('opens a choice request with %s and restores keyboard focus on Escape', async (key) => {
    const fixture = mountCompanion(choiceThread('select'));
    const action = await collapsedAction(fixture);
    action.focus();
    await userEvent.keyboard(key);
    await waitFor(() => fixture.phase() === 'expanded');
    expect(document.activeElement?.getAttribute('role')).toBe('radio');
    await closeWithEscape(fixture);
    expect(document.activeElement).toBe(await collapsedAction(fixture));
    await userEvent.keyboard(key);
    await waitFor(() => fixture.phase() === 'expanded');
    expect(fixture.requestOpen).toHaveBeenCalledTimes(2);
    expect(fixture.surfaceAdapter.submitInput).not.toHaveBeenCalled();
  });

  it('opens from composer padding without requiring an input and keeps title switching independent', async () => {
    const fixture = mountCompanion(choiceThread());
    await collapsedAction(fixture);
    const composer = fixture.mount.querySelector<HTMLElement>('.flower-composer')!;
    await userEvent.click(composer, { position: { x: 2, y: 10 } });
    await waitFor(() => fixture.phase() === 'expanded');
    expect(fixture.requestOpen).toHaveBeenCalledTimes(1);
    await userEvent.click(fixture.outside);
    await waitFor(() => fixture.phase() === 'collapsed');
    expect(document.activeElement).toBe(fixture.outside);
    await userEvent.click(fixture.mount.querySelector('.flower-companion-thread-trigger')!);
    await waitFor(() => fixture.phase() === 'expanded');
    expect(fixture.mount.querySelector('.flower-companion-thread-switcher-popover')).not.toBeNull();
    expect(fixture.requestOpen).toHaveBeenCalledTimes(2);
  });

  it('keeps the selected question ahead of another thread running and exposes the complete public summary', async () => {
    const selected = choiceThread();
    const fixture = mountCompanion(selected, {
      visualText: 'Working on another conversation', accessibleText: 'Other task', running: true,
      priorityStatus: 'running', targetThreadID: 'thread-idle',
    });
    const action = await collapsedAction(fixture);
    expect(action.textContent).toBe(selected.input_request!.public_summary);
    expect(action.title).toBe(selected.input_request!.public_summary);
    expect(action.getAttribute('aria-label')).toBe(selected.input_request!.public_summary);
    expect(fixture.mount.querySelector('.flower-companion-collapsed-summary')).toBeNull();
    const content = fixture.mount.querySelector<HTMLElement>('.flower-composer-content')!;
    expect(content.inert).toBe(true);
    expect(content.getAttribute('aria-hidden')).toBe('true');
    action.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => fixture.phase() === 'expanded');
    expect(fixture.mount.querySelector('main')!.dataset.flowerSelectedThreadId).toBe(selected.thread_id);
    expect(fixture.requestOpen.mock.calls[0]).toEqual([]);
  });

  it('retains a chosen option and the custom editor draft through collapse and reopening', async () => {
    const fixture = mountCompanion(choiceThread());
    await userEvent.click(await collapsedAction(fixture));
    await waitFor(() => fixture.phase() === 'expanded');
    const option = fixture.mount.querySelector<HTMLElement>('.flower-input-request-choice')!;
    await userEvent.click(option);
    await closeWithEscape(fixture);
    await userEvent.click(await collapsedAction(fixture));
    await waitFor(() => fixture.phase() === 'expanded');
    expect(fixture.mount.querySelector<HTMLInputElement>('input[role="radio"]')!.checked).toBe(true);
    await userEvent.click(fixture.mount.querySelector('.flower-input-request-choice-custom')!);
    await waitFor(() => Boolean(fixture.mount.querySelector('.flower-composer textarea')));
    const editor = fixture.mount.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    await userEvent.fill(editor, 'An alternative destination');
    editor.setSelectionRange(3, 8);
    await closeWithEscape(fixture);
    expect(fixture.mount.querySelector('.flower-companion-collapsed-action')).toBeNull();
    expect(fixture.mount.querySelector('.flower-composer textarea')).toBe(editor);
    expect(editor.value).toBe('An alternative destination');
    expect(editor.selectionStart).toBe(3);
    await userEvent.click(editor);
    await waitFor(() => fixture.phase() === 'expanded');
    expect(fixture.mount.querySelector('.flower-composer textarea')).toBe(editor);
    expect(fixture.surfaceAdapter.submitInput).not.toHaveBeenCalled();
  });

  it('keeps the entry usable after switching from chat to a question and quickly back again', async () => {
    const fixture = mountCompanion(choiceThread());
    await collapsedAction(fixture);
    fixture.setFocusRequest({ request_id: 'idle', thread_id: 'thread-idle' });
    await waitFor(() => fixture.mount.querySelector('main')?.dataset.flowerSelectedThreadId === 'thread-idle');
    fixture.setFocusRequest({ request_id: 'choice', thread_id: 'thread-companion-choice' });
    fixture.setFocusRequest({ request_id: 'back', thread_id: 'thread-idle' });
    fixture.setFocusRequest({ request_id: 'final', thread_id: 'thread-companion-choice' });
    await waitFor(() => fixture.mount.querySelector('main')?.dataset.flowerSelectedThreadId === 'thread-companion-choice');
    await userEvent.click(fixture.outside);
    await waitFor(() => fixture.phase() === 'collapsed');
    await userEvent.click(await collapsedAction(fixture));
    await waitFor(() => fixture.phase() === 'expanded');
    expect(fixture.mount.querySelector('main')!.dataset.flowerSelectedThreadId).toBe('thread-companion-choice');
    expect(fixture.surfaceAdapter.submitInput).not.toHaveBeenCalled();
  });

  it.each(['secret', 'computer', 'approval'] as const)('retains an accessible generic action for %s requests', async (kind) => {
    const selected = kind === 'approval' ? thread({ status: 'waiting_approval', approval_actions: [{
      action_id: 'approval-entry', origin: 'main_tool', run_id: 'run-entry', tool_id: 'tool-entry', tool_name: 'terminal.exec',
      state: 'requested', status: 'pending', requested_at_ms: 1, can_approve: true, surface_role: 'primary_action',
      summary: { label: 'Review command', command: 'pwd' },
    }] }) : thread({ status: 'waiting_user', input_request: inputRequest({
      tool_name: kind === 'computer' ? 'computer.request_control' : 'ask_user',
      public_summary: 'This detail should stay inside the drawer',
      questions: [{ id: kind === 'computer' ? 'computer_control' : 'password', header: 'Action', question: 'Private question',
        response_mode: kind === 'computer' ? 'select' : 'write', is_secret: kind === 'secret', choices: [] }],
    }) });
    const fixture = mountCompanion(selected);
    const action = await collapsedAction(fixture);
    expect(action.textContent).toBe('Open Flower to continue');
    action.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => fixture.phase() === 'expanded');
    expect(fixture.mount.querySelector('.flower-composer-content')?.contains(document.activeElement)).toBe(true);
    await closeWithEscape(fixture);
    expect(document.activeElement).toBe(await collapsedAction(fixture));
    expect(fixture.surfaceAdapter.submitInput).not.toHaveBeenCalled();
    expect(fixture.surfaceAdapter.submitApproval).not.toHaveBeenCalled();
    expect(fixture.surfaceAdapter.stopThread).not.toHaveBeenCalled();
  });

  it.each([1440, 390].flatMap((width) => [false, true].map((dark) => ({ width, dark }))))('fits the $width viewport with dark=$dark', async ({ width, dark }) => {
    await page.viewport(width, 800);
    const previousTheme = document.documentElement.className;
    document.documentElement.classList.toggle('dark', dark);
    onTestFinished(() => { document.documentElement.className = previousTheme; });
    const fixture = mountCompanion(choiceThread());
    await userEvent.click(await collapsedAction(fixture));
    await waitFor(() => fixture.phase() === 'expanded');
    const bounds = fixture.mount.querySelector('[data-floe-bottom-bar-companion]')!.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    const composer = fixture.mount.querySelector<HTMLElement>('.flower-composer')!;
    expect(composer.scrollWidth).toBeLessThanOrEqual(composer.clientWidth + 1);
  });

  it('opens immediately under reduced motion and supports reversing a close', async () => {
    const media = commands as unknown as { emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
    await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
    onTestFinished(() => media.emulateMediaPreferences({ reducedMotion: 'no-preference' }));
    const fixture = mountCompanion(choiceThread());
    await userEvent.click(await collapsedAction(fixture));
    await waitFor(() => fixture.phase() === 'expanded');
    fixture.setOpen(false);
    fixture.setOpen(true);
    await waitFor(() => fixture.phase() === 'expanded');
    expect(fixture.mount.querySelector('.flower-input-request-surface')!.getBoundingClientRect().height).toBeGreaterThan(0);
  });

  it('preserves the ordinary write response editor and composition through animated reversal', async () => {
    const selected = thread({ status: 'waiting_user', input_request: inputRequest({
      questions: [{ id: 'reply', header: 'Reply', question: 'Describe the destination', response_mode: 'write', choices: [] }],
    }) });
    const fixture = mountCompanion(selected);
    await waitFor(() => Boolean(fixture.mount.querySelector('.flower-composer textarea')));
    const editor = fixture.mount.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    await userEvent.click(editor);
    await waitFor(() => fixture.phase() === 'expanded');
    await userEvent.fill(editor, 'A quiet destination');
    editor.setSelectionRange(2, 7);
    editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    fixture.setOpen(false);
    await waitFor(() => fixture.phase() === 'collapsing');
    fixture.setOpen(true);
    await waitFor(() => fixture.phase() === 'expanded');
    expect(fixture.mount.querySelector('.flower-composer textarea')).toBe(editor);
    expect(editor.value).toBe('A quiet destination');
    expect(editor.selectionStart).toBe(2);
    expect(editor.selectionEnd).toBe(7);
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    expect(fixture.surfaceAdapter.submitInput).not.toHaveBeenCalled();
    editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
});
