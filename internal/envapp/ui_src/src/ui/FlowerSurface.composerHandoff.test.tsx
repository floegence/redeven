// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type { FlowerComposerHandoffRequest } from '../../../../flower_ui/src';
import {
  adapter,
  liveBootstrap,
  renderSurfaceWithComposerHandoffController,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

function handoff(
  requestID: string,
  text: string,
  selectionStart = 0,
  selectionEnd = text.length,
): FlowerComposerHandoffRequest {
  return {
    request_id: requestID,
    text,
    selection_start: selectionStart,
    selection_end: selectionEnd,
    is_composing: false,
    source: 'activity_bottom_bar',
  };
}

function composer(runtime: HTMLElement): HTMLTextAreaElement {
  const textarea = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea');
  if (!textarea) throw new Error('Flower composer textarea is not mounted.');
  return textarea;
}

function updateComposer(runtime: HTMLElement, value: string): HTMLTextAreaElement {
  const textarea = composer(runtime);
  textarea.value = value;
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
  return textarea;
}

describe('FlowerSurface composer handoff', () => {
  it('switches to new chat without losing the selected-thread draft and consumes each request once', async () => {
    const selected = thread({ thread_id: 'thread-selected', title: 'Selected thread' });
    const controller = renderSurfaceWithComposerHandoffController({
      ...adapter(true),
      listThreads: vi.fn(async () => [selected]),
      loadThread: vi.fn(async () => liveBootstrap(selected)),
    });
    const { runtime } = controller;

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-selected"] button')));
    (runtime.querySelector('[data-thread-id="thread-selected"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === 'thread-selected');
    await waitFor(() => document.activeElement === composer(runtime));
    updateComposer(runtime, 'selected thread draft');
    await waitFor(() => composer(runtime).value === 'selected thread draft');

    controller.setComposerHandoffRequest(handoff('handoff-1', 'quick request', 2, 7));
    await waitFor(() => composer(runtime).value === 'quick request');
    await waitFor(() => controller.consumedRequests().length === 1);

    expect(runtime.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id')).toBe('');
    expect(document.activeElement).toBe(composer(runtime));
    expect(composer(runtime).selectionStart).toBe(2);
    expect(composer(runtime).selectionEnd).toBe(7);
    expect(controller.consumedRequests()).toEqual(['handoff-1']);

    controller.setComposerHandoffRequest(handoff('handoff-1', 'must not replay'));
    await Promise.resolve();
    await Promise.resolve();
    expect(composer(runtime).value).toBe('quick request');
    expect(controller.consumedRequests()).toEqual(['handoff-1']);

    (runtime.querySelector('[data-thread-id="thread-selected"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === 'thread-selected');
    await waitFor(() => document.activeElement === composer(runtime));
    expect(composer(runtime).value).toBe('selected thread draft');
    (runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement).click();
    await waitFor(() => composer(runtime).value === 'quick request');
  });

  it('appends to an existing new-chat draft with two newlines and selects only the inserted range', async () => {
    const controller = renderSurfaceWithComposerHandoffController({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
    });
    const { runtime } = controller;

    await waitFor(() => Boolean(runtime.querySelector('.flower-composer textarea')));
    updateComposer(runtime, 'existing new-chat draft');
    const order: string[] = [];
    const textarea = composer(runtime);
    const originalFocus = textarea.focus.bind(textarea);
    const originalSetSelectionRange = textarea.setSelectionRange.bind(textarea);
    vi.spyOn(textarea, 'focus').mockImplementation((options?: FocusOptions) => {
      expect(controller.consumedRequests()).toEqual([]);
      order.push('focus');
      originalFocus(options);
    });
    vi.spyOn(textarea, 'setSelectionRange').mockImplementation((start, end, direction) => {
      expect(controller.consumedRequests()).toEqual([]);
      order.push(`selection:${start}:${end}`);
      originalSetSelectionRange(start, end, direction);
    });

    controller.setComposerHandoffRequest(handoff('handoff-append', 'inserted text', 1, 8));
    await waitFor(() => controller.consumedRequests().length === 1);

    expect(textarea.value).toBe('existing new-chat draft\n\ninserted text');
    expect(textarea.selectionStart).toBe('existing new-chat draft\n\n'.length + 1);
    expect(textarea.selectionEnd).toBe('existing new-chat draft\n\n'.length + 8);
    expect(order).toEqual([
      'focus',
      `selection:${'existing new-chat draft\n\n'.length + 1}:${'existing new-chat draft\n\n'.length + 8}`,
    ]);
    expect(controller.consumedRequests()).toEqual(['handoff-append']);
  });

  it('does not replay an acknowledged request after collapse and reopen', async () => {
    const controller = renderSurfaceWithComposerHandoffController({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
    });
    const { runtime } = controller;

    await waitFor(() => Boolean(runtime.querySelector('.flower-composer textarea')));
    controller.setComposerHandoffRequest(handoff('handoff-stable', 'stable text'));
    await waitFor(() => controller.consumedRequests().length === 1);

    controller.setEngaged(false);
    controller.setTranscriptVisible(false);
    await Promise.resolve();
    controller.setEngaged(true);
    controller.setTranscriptVisible(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(composer(runtime).value).toBe('stable text');
    expect(controller.consumedRequests()).toEqual(['handoff-stable']);
  });

  it('does not acknowledge a handoff while the companion is hidden', async () => {
    const controller = renderSurfaceWithComposerHandoffController({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
    });
    const { runtime } = controller;

    await waitFor(() => Boolean(runtime.querySelector('.flower-composer textarea')));
    controller.setEngaged(false);
    controller.setTranscriptVisible(false);
    controller.setComposerHandoffRequest(handoff('handoff-hidden', 'wait for a visible composer'));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.consumedRequests()).toEqual([]);
    expect(document.activeElement).not.toBe(composer(runtime));

    controller.setEngaged(true);
    controller.setTranscriptVisible(true);
    await waitFor(() => controller.consumedRequests().length === 1);
    expect(composer(runtime).value).toBe('wait for a visible composer');
    expect(controller.consumedRequests()).toEqual(['handoff-hidden']);
  });

  it('does not acknowledge after the target composer leaves the DOM before focus applies', async () => {
    const controller = renderSurfaceWithComposerHandoffController({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
    });
    const { runtime } = controller;

    await waitFor(() => Boolean(runtime.querySelector('.flower-composer textarea')));
    controller.setComposerHandoffRequest(handoff('handoff-detached', 'detached target'));
    composer(runtime).remove();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.consumedRequests()).toEqual([]);
  });
});
