import '../index.css';
import './flower-feature.css';

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import {
  adapter,
  liveBootstrap,
  renderSurfaceWithAdapterProps,
  renderSurfaceWithCompanionController,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

const companionCopy = {
  label: 'Switch Flower conversation',
  searchPlaceholder: 'Search conversations...',
  newConversation: 'New conversation',
  empty: 'No matching conversations',
  queued: 'Queued',
  groups: { attention: 'Needs attention', working: 'Working', pinned: 'Pinned', recent: 'Recent' },
  threadList: DEFAULT_FLOWER_SURFACE_COPY.threadList,
};

function mountFrame(runtime: HTMLElement): void {
  runtime.className = 'flower-activity-companion floe-bottom-bar-companion';
  runtime.dataset.companionPhase = 'collapsed';
  Object.assign(runtime.style, { left: '12px', top: '100px', width: '544px', height: '24px' });
}

function expectSingleOutline(runtime: HTMLElement): void {
  const composer = runtime.querySelector<HTMLElement>('.flower-composer')!;
  const style = getComputedStyle(composer);
  const frame = getComputedStyle(runtime);
  for (const side of ['top', 'right', 'bottom', 'left']) {
    expect(frame.getPropertyValue(`border-${side}-width`)).toBe('1px');
    expect(style.getPropertyValue(`border-${side}-width`)).toBe('0px');
  }
  expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(style.borderRadius).toBe('0px');
  expect(style.boxShadow).toBe('none');
  expect(style.backdropFilter).toBe('none');
}

describe('Flower production companion appearance', () => {
  it.each(['idle', 'selected', 'running', 'approval'] as const)('keeps one outline with the real %s content', async (state) => {
    const selected = thread({
      messages: [],
      status: state === 'approval' ? 'waiting_approval' : 'idle',
      ...(state === 'approval' ? {
        approval_actions: [{
          action_id: 'appearance-approval', origin: 'main_tool' as const, run_id: 'run-appearance',
          tool_id: 'tool-appearance', tool_name: 'terminal.exec', state: 'requested' as const,
          status: 'pending' as const, requested_at_ms: 20_000, can_approve: true,
          surface_role: 'primary_action' as const, summary: { label: 'Review command', command: 'pwd' },
        }],
      } : {}),
    });
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true),
      listThreads: vi.fn(async () => [selected]),
      loadThread: vi.fn(async () => liveBootstrap(selected)),
    }, {
      presentation: 'companion', companionOpen: false, engaged: true, transcriptVisible: true,
      companionPresenceOwner: true, companionCopy,
      ...(state === 'selected' || state === 'approval' ? {
        focusThreadRequest: { request_id: `appearance-${state}`, thread_id: selected.thread_id },
      } : {}),
      ...(state === 'running' ? {
        companionSummary: {
          visualText: 'Thinking...', accessibleText: 'Flower task running',
          priorityStatus: 'running' as const, targetThreadID: selected.thread_id, running: true,
        },
      } : {}),
    });
    mountFrame(runtime);
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer')));
    const selector = state === 'approval' ? '.flower-companion-collapsed-action'
      : state === 'running' ? '.flower-companion-collapsed-summary'
        : '.flower-companion-thread-trigger';
    await waitFor(() => Boolean(runtime.querySelector(selector)));
    if (state === 'selected') {
      await waitFor(() => runtime.querySelector('.flower-companion-thread-trigger')?.textContent?.includes(selected.title) ?? false);
    }
    expectSingleOutline(runtime);
  });

  it('preserves the editor, draft, selection and composition through expansion and collapse', async () => {
    const surfaceAdapter = adapter(true);
    const control = renderSurfaceWithCompanionController(surfaceAdapter, false, companionCopy, () => control.setOpen(true));
    const { runtime } = control;
    mountFrame(runtime);
    await waitFor(() => Boolean(runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea:not(:disabled)')));
    const textarea = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    expectSingleOutline(runtime);
    textarea.focus();
    await waitFor(() => !runtime.querySelector('.flower-surface-companion-collapsed'));
    textarea.value = 'Draft for composition';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    textarea.setSelectionRange(2, 7);
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    control.setOpen(false);
    runtime.dataset.companionPhase = 'collapsing';
    expectSingleOutline(runtime);
    control.setOpen(true);
    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', isComposing: true }));
    expect(surfaceAdapter.launchTurn).not.toHaveBeenCalled();
    expect(runtime.querySelector('.flower-composer textarea')).toBe(textarea);
    expect(textarea.value).toBe('Draft for composition');
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(7);
    textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    textarea.blur();
    control.setOpen(false);
    runtime.dataset.companionPhase = 'collapsed';
    expectSingleOutline(runtime);
  });
});
