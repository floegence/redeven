import '../index.css';
import './flower-feature.css';

import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
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
  Object.assign(runtime.style, { left: '12px', top: '100px', width: '360px', height: '22px' });
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
    await page.viewport(1280, 800);
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
    const control = runtime.querySelector<HTMLElement>(selector)!;
    const frame = runtime.getBoundingClientRect();
    const bounds = control.getBoundingClientRect();
    expect(bounds.top).toBeGreaterThanOrEqual(frame.top + 1);
    expect(bounds.bottom).toBeLessThanOrEqual(frame.bottom - 1);
  });

  it('reopens when the collapsed editor is clicked while it still has focus', async () => {
    await page.viewport(1280, 800);
    const control = renderSurfaceWithCompanionController(adapter(true), false, companionCopy, () => control.setOpen(true));
    const { runtime } = control;
    mountFrame(runtime);
    await waitFor(() => Boolean(runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea:not(:disabled)')));
    const textarea = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    textarea.focus();
    await waitFor(() => !runtime.querySelector('.flower-surface-companion-collapsed'));
    control.setOpen(false);
    await waitFor(() => Boolean(runtime.querySelector('.flower-surface-companion-collapsed')));
    expect(document.activeElement).toBe(textarea);
    await userEvent.click(textarea);
    expect(runtime.querySelector('.flower-surface-companion-collapsed')).toBeNull();
    expect(runtime.querySelector('.flower-composer textarea')).toBe(textarea);
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

it.each(['light', 'dark'] as const)('uses the shared reading scale and aligned composer in %s', async mode => {
  await page.viewport(1280, 900);
  const previousClass = document.documentElement.className;
  document.documentElement.classList.toggle('dark', mode === 'dark');
  document.documentElement.classList.toggle('light', mode === 'light');
  onTestFinished(() => { document.documentElement.className = previousClass; });
  const selected = thread({ thread_id: 'scale-reading', messages: [{
    id: 'scale-reply', role: 'assistant', status: 'complete', turn_id: 'turn-scale', created_at_ms: 2,
    content: '## Workspace review\n\nThe runtime and toolchain are ready. Review the changes before continuing.\n\n- Keep commands readable.\n- Preserve the current draft and selection.\n\n`node --version`',
  }] });
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true),
    listThreads: async () => [selected], loadThread: async () => liveBootstrap(selected),
  }, { focusThreadRequest: { request_id: 'scale-reading', thread_id: selected.thread_id } });
  Object.assign(runtime.style, { width: '1200px', height: '800px' });
  await waitFor(() => Boolean(runtime.querySelector('.flower-chat-md-block p')));
  await document.fonts.ready;
  const paragraph = runtime.querySelector('.flower-chat-md-block p')!;
  expect(getComputedStyle(paragraph).fontSize).toBe('14px');
  expect(getComputedStyle(paragraph).lineHeight).toBe('22px');
  expect(getComputedStyle(paragraph).fontFamily).toContain('Inter Variable');
  const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  await userEvent.fill(editor, 'Retained draft 中文');
  editor.setSelectionRange(2, 8);
  const send = runtime.querySelector('.flower-composer-submit')!.getBoundingClientRect();
  const attach = runtime.querySelector('.flower-composer-attachment-button')!.getBoundingClientRect();
  expect(send.height).toBe(32);
  expect(attach.height).toBe(32);
  expect(Math.abs(send.bottom - attach.bottom)).toBeLessThanOrEqual(1);
  expect(runtime.scrollWidth).toBeLessThanOrEqual(runtime.clientWidth);
  await page.screenshot({ element: runtime, path: `__screenshots__/interface-scale-${mode}.png` });
  runtime.style.width = '900px';
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(runtime.querySelector('.flower-composer textarea')).toBe(editor);
  expect(editor.value).toBe('Retained draft 中文');
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 8]);
});

it('retains usable composer targets and editable text with coarse input', async () => {
  await page.viewport(1280, 900);
  const touch = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
  await touch.emulateTouchInput(true);
  onTestFinished(() => touch.emulateTouchInput(false));
  const runtime = renderSurfaceWithAdapterProps(adapter(true), {});
  Object.assign(runtime.style, { width: '1200px', height: '800px' });
  await waitFor(() => Boolean(runtime.querySelector('.flower-model-reasoning-model-trigger')));
  const selectors = [
    '.flower-composer-submit', '.flower-composer-attachment-button',
    '.flower-model-reasoning-model-trigger', '.flower-permission-trigger',
  ];
  for (const selector of selectors) {
    const control = runtime.querySelector(selector)!;
    expect(control, selector).not.toBeNull();
    expect(control.getBoundingClientRect().height, selector).toBeGreaterThanOrEqual(44);
    expect(control.getBoundingClientRect().width, selector).toBeGreaterThanOrEqual(44);
  }
  const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  expect(Number.parseFloat(getComputedStyle(editor).fontSize)).toBeGreaterThanOrEqual(16);
  expect(runtime.scrollWidth).toBeLessThanOrEqual(runtime.clientWidth);
});
