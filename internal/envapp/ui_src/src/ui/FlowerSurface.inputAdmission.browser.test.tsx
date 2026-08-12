import '../index.css';

import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerLiveEvent,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import {
  adapter,
  deferred,
  inputAdmissionReceipt,
  inputRequest,
  liveBootstrap,
  renderSurfaceWithAdapter,
  renderSurfaceWithAdapterProps,
  renderSurfaceWithCompanionController,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

describe('Flower structured input admission browser behavior', () => {
  it('keeps the thread rail interactive while an unanswered waiting_user prompt remains open', async () => {
    const requestA = inputRequest({
      prompt_id: 'prompt-unanswered-a',
      questions: [{ id: 'answer-a', header: 'A', question: 'Answer A', response_mode: 'write' }],
    });
    const threadA = thread({ thread_id: 'thread-unanswered-a', title: 'Unanswered A', status: 'waiting_user', input_request: requestA });
    const threadB = thread({ thread_id: 'thread-unanswered-b', title: 'Unanswered B', status: 'success', messages: [{
      id: 'b-history', turn_id: 'b-turn', role: 'assistant', content: 'B history', status: 'complete', created_at_ms: 2,
    }] });
    const delayedA = deferred<ReturnType<typeof liveBootstrap>>();
    const loadThread = vi.fn(async (threadID: string) => {
      if (threadID === threadA.thread_id) return delayedA.promise;
      return liveBootstrap(threadB, 20);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [threadA, threadB]),
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-unanswered-a"] button')));
    const threadACard = runtime.querySelector('[data-thread-id="thread-unanswered-a"]') as HTMLElement;
    const threadBCard = runtime.querySelector('[data-thread-id="thread-unanswered-b"]') as HTMLElement;
    Object.defineProperty(threadACard, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 8, top: 8, right: 208, bottom: 58, width: 200, height: 50 }) });
    Object.defineProperty(threadBCard, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 8, top: 64, right: 208, bottom: 114, width: 200, height: 50 }) });
    const bButton = threadBCard.querySelector('button') as HTMLButtonElement;
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => bButton);

    (threadACard.querySelector('button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Answer A') ?? false);
    expect(runtime.querySelector('#redeven-flower-surface')?.closest('[inert]')).toBeNull();
    expect(runtime.querySelector('.flower-component-thread-rail')?.closest('[inert]')).toBeNull();
    expect(getComputedStyle(threadBCard).pointerEvents).not.toBe('none');

    const hit = document.elementFromPoint(20, 80) as HTMLButtonElement;
    expect(hit).toBe(bButton);
    hit.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 80, button: 0 }));
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 80, button: 0 }));
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === threadB.thread_id);

    delayedA.resolve(liveBootstrap(threadA, 10));
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === threadB.thread_id);
    expect(runtime.textContent).toContain('B history');
    document.elementFromPoint = originalElementFromPoint;
  });

  it('keeps the collapsed companion thread switcher interactive while waiting_user remains unanswered', async () => {
    const requestA = inputRequest({ prompt_id: 'prompt-companion-a', questions: [{ id: 'a', header: 'A', question: 'Answer A', response_mode: 'write' }] });
    const threadA = thread({ thread_id: 'thread-companion-a', title: 'Companion A', status: 'waiting_user', input_request: requestA });
    const threadB = thread({ thread_id: 'thread-companion-b', title: 'Companion B', status: 'success' });
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true),
      listThreads: vi.fn(async () => [threadA, threadB]),
      loadThread: vi.fn(async (threadID) => liveBootstrap(threadID === threadA.thread_id ? threadA : threadB, 10)),
    }, {
      presentation: 'companion',
      companionOpen: false,
      engaged: true,
      transcriptVisible: true,
      companionCopy: {
        label: 'Switch conversation',
        searchPlaceholder: 'Search conversations',
        newConversation: 'New conversation',
        empty: 'No conversations',
        queued: 'Queued',
        groups: { attention: 'Attention', working: 'Working', pinned: 'Pinned', recent: 'Recent' },
        threadList: DEFAULT_FLOWER_SURFACE_COPY.threadList,
      },
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-companion-a"] button')));
    (runtime.querySelector('[data-thread-id="thread-companion-a"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-selected-thread-id="thread-companion-a"]')));
    const trigger = runtime.querySelector('.flower-composer .flower-companion-thread-trigger') as HTMLButtonElement;
    expect(trigger.closest('[inert]')).toBeNull();
    trigger.click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-companion-thread-switcher-popover')));
    const b = runtime.querySelector('[data-flower-thread-switcher-thread="thread-companion-b"]') as HTMLButtonElement;
    b.click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-selected-thread-id="thread-companion-b"]')));
    expect(runtime.querySelector('.flower-companion-thread-switcher-popover')).toBeNull();
  });

  it('preserves companion thread navigation across collapsed and expanded layouts', async () => {
    const requestA = inputRequest({ prompt_id: 'prompt-companion-toggle-a', questions: [{ id: 'a', header: 'A', question: 'Answer A', response_mode: 'write' }] });
    const threadA = thread({ thread_id: 'thread-companion-toggle-a', title: 'Toggle A', status: 'waiting_user', input_request: requestA });
    const threadB = thread({ thread_id: 'thread-companion-toggle-b', title: 'Toggle B', status: 'success' });
    const copy = {
      label: 'Switch conversation',
      searchPlaceholder: 'Search conversations',
      newConversation: 'New conversation',
      empty: 'No conversations',
      queued: 'Queued',
      groups: { attention: 'Attention', working: 'Working', pinned: 'Pinned', recent: 'Recent' },
      threadList: DEFAULT_FLOWER_SURFACE_COPY.threadList,
    };
    let controller: ReturnType<typeof renderSurfaceWithCompanionController> | null = null;
    controller = renderSurfaceWithCompanionController({
      ...adapter(true),
      listThreads: vi.fn(async () => [threadA, threadB]),
      loadThread: vi.fn(async (threadID) => liveBootstrap(threadID === threadA.thread_id ? threadA : threadB, 10)),
    }, false, copy, () => controller?.setOpen(true));
    const { runtime } = controller;
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-companion-toggle-a"] button')));
    (runtime.querySelector('[data-thread-id="thread-companion-toggle-a"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-selected-thread-id="thread-companion-toggle-a"]')));
    controller.setOpen(false);
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-companion-open') === 'false');

    const selectFromSwitcher = async (threadID: string) => {
      const trigger = runtime.querySelector('.flower-companion-thread-trigger') as HTMLButtonElement;
      expect(trigger).toBeTruthy();
      expect(trigger.closest('[inert]')).toBeNull();
      if (!runtime.querySelector('.flower-companion-thread-switcher-popover')) {
        trigger.click();
        await waitFor(() => Boolean(runtime.querySelector('.flower-companion-thread-switcher-popover')));
      }
      (runtime.querySelector(`[data-flower-thread-switcher-thread="${threadID}"]`) as HTMLButtonElement).click();
      await waitFor(() => Boolean(runtime.querySelector(`[data-flower-selected-thread-id="${threadID}"]`)));
    };

    const collapsedTrigger = runtime.querySelector('.flower-composer .flower-companion-thread-trigger') as HTMLButtonElement;
    expect(collapsedTrigger).toBeTruthy();
    expect(collapsedTrigger.closest('[inert]')).toBeNull();
    collapsedTrigger.click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-companion-open') === 'true');
    expect(runtime.querySelector('.flower-chat-header')?.hasAttribute('inert')).toBe(false);
    await selectFromSwitcher(threadB.thread_id);
    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe(threadB.thread_id);
    controller.setOpen(false);
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-companion-open') === 'false');
    const collapsedHeader = runtime.querySelector('.flower-chat-header') as (HTMLElement & { inert?: boolean }) | null;
    expect(collapsedHeader === null || collapsedHeader.inert === true || getComputedStyle(collapsedHeader).display === 'none').toBe(true);
  });

  it('keeps A to B to A selection stable across delayed bootstrap responses', async () => {
    const request = (id: string) => inputRequest({ prompt_id: id, questions: [{ id: 'answer', header: id, question: `Answer ${id}`, response_mode: 'write' }] });
    const threadA = thread({ thread_id: 'thread-fast-a', title: 'Fast A', status: 'waiting_user', input_request: request('prompt-fast-a') });
    const threadB = thread({ thread_id: 'thread-fast-b', title: 'Fast B', status: 'waiting_user', input_request: request('prompt-fast-b') });
    const delayed = new Map([[threadA.thread_id, deferred<ReturnType<typeof liveBootstrap>>()], [threadB.thread_id, deferred<ReturnType<typeof liveBootstrap>>()]]);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [threadA, threadB]),
      loadThread: vi.fn((threadID: string) => delayed.get(threadID)!.promise),
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-fast-a"] button')));
    (runtime.querySelector('[data-thread-id="thread-fast-a"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === threadA.thread_id);
    (runtime.querySelector('[data-thread-id="thread-fast-b"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === threadB.thread_id);
    (runtime.querySelector('[data-thread-id="thread-fast-a"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === threadA.thread_id);
    delayed.get(threadB.thread_id)!.resolve(liveBootstrap(threadB, 30));
    delayed.get(threadA.thread_id)!.resolve(liveBootstrap(threadA, 20));
    await waitFor(() => runtime.textContent?.includes('Answer prompt-fast-a') ?? false);
    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe(threadA.thread_id);
    expect(runtime.textContent).not.toContain('Answer prompt-fast-b');
  });

  it('keeps detail and navigation when receipt bootstrap is summary-only and the next prompt is already waiting', async () => {
    const firstRequest = inputRequest({
      prompt_id: 'prompt-summary-race-first',
      questions: [{ id: 'answer', header: 'First', question: 'Answer the first prompt.', response_mode: 'write' }],
    });
    const nextRequest = inputRequest({
      prompt_id: 'prompt-summary-race-next',
      questions: [{ id: 'answer-next', header: 'Next', question: 'Answer the next prompt.', response_mode: 'write' }],
    });
    const initialThread = thread({
      thread_id: 'thread-summary-race',
      title: 'Summary race',
      status: 'waiting_user',
      input_request: firstRequest,
      messages: [{
        id: 'history-user',
        turn_id: 'turn-history',
        role: 'user',
        content: 'Keep this history visible.',
        status: 'complete',
        created_at_ms: 1,
      }],
    });
    const summaryOnlyNextPrompt = liveBootstrap({
      ...initialThread,
      status: 'waiting_user',
      input_request: nextRequest,
      messages: [],
    }, 11);
    const postAdmissionBootstrap = deferred<ReturnType<typeof liveBootstrap>>();
    let loadCount = 0;
    const loadThread = vi.fn(async () => {
      loadCount += 1;
      if (loadCount === 1) return liveBootstrap(initialThread, 10);
      return postAdmissionBootstrap.promise;
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [initialThread]),
      loadThread,
      submitInput: vi.fn(async () => inputAdmissionReceipt(
        initialThread.thread_id,
        firstRequest.prompt_id,
        'turn-summary-race-answer',
        'run-summary-race',
      )),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-summary-race"] button')));
    (runtime.querySelector('[data-thread-id="thread-summary-race"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Answer the first prompt.') ?? false);
    const textarea = runtime.querySelector('.flower-composer textarea') as HTMLTextAreaElement;
    textarea.value = 'First answer';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => !(runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).disabled);
    (runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).click();
    await waitFor(() => loadThread.mock.calls.length === 2);

    postAdmissionBootstrap.resolve(summaryOnlyNextPrompt);
    await waitFor(() => runtime.textContent?.includes('Answer the next prompt.') ?? false);
    expect(runtime.textContent).toContain('Keep this history visible.');
    expect(runtime.querySelector('[data-flower-input-admission-handoff]')).not.toBeNull();
    expect(runtime.querySelector('[data-thread-id="thread-summary-race"] button')).not.toBeNull();
    expect(runtime.querySelector('.flower-composer')?.closest('[inert]')).toBeNull();
  });

  it('keeps history and an answered receipt visible until post-admission bootstrap reconciles', async () => {
    const request = inputRequest({
      prompt_id: 'prompt-browser-input',
      public_summary: 'What should Flower do next?',
      questions: [{
        id: 'direction',
        header: 'Direction',
        question: 'What should Flower do next?',
        is_secret: false,
        response_mode: 'write',
      }],
    });
    const waitingThread = thread({
      thread_id: 'thread-browser-input',
      title: 'Browser input admission',
      status: 'waiting_user',
      active_run_id: 'run-before-input',
      input_request: request,
    });
    const canonicalThread = thread({
      ...waitingThread,
      status: 'running',
      active_run_id: 'run-after-input',
      input_request: undefined,
      messages: [
        ...waitingThread.messages,
        {
          id: 'message-input-answer',
          turn_id: 'turn-after-input',
          role: 'user',
          content: 'Continue with the release.',
          status: 'complete',
          created_at_ms: 20,
        },
      ],
    });
    const postAdmissionBootstrap = deferred<ReturnType<typeof liveBootstrap>>();
    let loadCount = 0;
    const loadThread = vi.fn(() => {
      loadCount += 1;
      return loadCount === 1
        ? Promise.resolve(liveBootstrap(waitingThread, 10))
        : postAdmissionBootstrap.promise;
    });
    const submitInput = vi.fn(async () => {
      return inputAdmissionReceipt(
        waitingThread.thread_id,
        request.prompt_id,
        'turn-after-input',
        'run-after-input',
      );
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread,
      submitInput,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-browser-input"] button')));
    (runtime.querySelector('[data-thread-id="thread-browser-input"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-request-prompt]')));
    expect(runtime.querySelectorAll('[data-flower-input-request-prompt]')).toHaveLength(1);
    const promptPanel = runtime.querySelector('[data-flower-input-request-prompt]') as HTMLElement;
    const promptPanelStyle = window.getComputedStyle(promptPanel);
    expect(['', '0px']).toContain(promptPanelStyle.borderTopWidth);
    expect(['', 'none']).toContain(promptPanelStyle.backgroundImage);
    expect(['', 'none']).toContain(promptPanelStyle.boxShadow);
    expect(promptPanel.querySelector('.flower-input-request-description')).toBeNull();
    expect(promptPanel.querySelector('.flower-input-request-question-text')?.textContent).toContain('What should Flower do next?');
    const textarea = runtime.querySelector('.flower-composer textarea') as HTMLTextAreaElement;
    textarea.value = 'Continue with the release.';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => !(runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).disabled);

    (runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).click();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(submitInput).toHaveBeenCalledTimes(1);
    expect(runtime.textContent).toContain('Plan deploy');
    expect(runtime.querySelector('[data-flower-input-admission-handoff]')?.textContent).toContain('Continue with the release.');
    expect(runtime.querySelector('.flower-composer [data-flower-input-request-prompt]')).toBeNull();
    expect(runtime.querySelector('.flower-composer-continue')).toBeNull();
    expect(loadThread).toHaveBeenCalledTimes(2);
    expect(runtime.textContent).not.toContain('Submitting...');
    expect((runtime.querySelector('.flower-composer textarea') as HTMLTextAreaElement).disabled).toBe(false);

    postAdmissionBootstrap.resolve(liveBootstrap(canonicalThread, 11));
    await waitFor(() => runtime.textContent?.includes('Continue with the release.') ?? false);
    expect(runtime.querySelector('[data-flower-input-admission-handoff]')).toBeNull();
    expect(runtime.textContent?.match(/Continue with the release\./g)).toHaveLength(1);
  });

  it('does not let a late admission receipt overwrite a newer waiting prompt', async () => {
    const consumedRequest = inputRequest({
      prompt_id: 'prompt-consumed',
      questions: [{
        id: 'answer-consumed',
        header: 'Consumed answer',
        question: 'Answer the first prompt.',
        is_secret: false,
        response_mode: 'write',
      }],
    });
    const nextRequest = inputRequest({
      prompt_id: 'prompt-next',
      message_id: 'message-next',
      tool_id: 'tool-next',
      questions: [{
        id: 'answer-next',
        header: 'Next answer',
        question: 'Answer the newer prompt.',
        is_secret: false,
        response_mode: 'write',
      }],
    });
    const waitingThread = thread({
      thread_id: 'thread-input-race',
      title: 'Input admission race',
      status: 'waiting_user',
      active_run_id: 'run-before-input',
      input_request: consumedRequest,
    });
    const delayedReceipt = deferred<ReturnType<typeof inputAdmissionReceipt>>();
    let submissionStarted = false;
    let newerPromptDelivered = false;
    const submitInput = vi.fn(() => {
      submissionStarted = true;
      return delayedReceipt.promise;
    });
    const listThreadLiveEvents = vi.fn(async (_threadID: string, afterSeq: number) => {
      if (!submissionStarted || newerPromptDelivered) {
        return { stream_generation: 1, events: [], next_cursor: afterSeq, retained_from_seq: 1 };
      }
      newerPromptDelivered = true;
      return {
        stream_generation: 1,
        events: [
          {
            schema_version: 1,
            seq: 11,
            endpoint_id: 'test-runtime',
            thread_id: waitingThread.thread_id,
            run_id: 'run-after-input',
            turn_id: 'turn-after-input',
            at_unix_ms: 11,
            kind: 'run.started',
            payload: { run_id: 'run-after-input', status: 'running' },
          },
          {
            schema_version: 1,
            seq: 12,
            endpoint_id: 'test-runtime',
            thread_id: waitingThread.thread_id,
            run_id: 'run-after-input',
            turn_id: 'turn-after-input',
            at_unix_ms: 12,
            kind: 'input.requested',
            payload: { request: nextRequest },
          },
        ] satisfies FlowerLiveEvent[],
        next_cursor: 12,
        retained_from_seq: 1,
      };
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread, 10)),
      submitInput,
      listThreadLiveEvents,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-input-race"] button')));
    (runtime.querySelector('[data-thread-id="thread-input-race"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Answer the first prompt.') ?? false);
    const textarea = runtime.querySelector('.flower-composer textarea') as HTMLTextAreaElement;
    textarea.value = 'First answer';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => !(runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).disabled);
    (runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).click();

    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.textContent).not.toContain('Answer the first prompt.');
    expect(runtime.textContent).not.toContain('Submitting...');

    await waitFor(() => runtime.textContent?.includes('Answer the newer prompt.') ?? false);
    delayedReceipt.resolve(inputAdmissionReceipt(
      waitingThread.thread_id,
      consumedRequest.prompt_id,
      'turn-after-input',
      'run-after-input',
    ));

    await waitFor(() => runtime.querySelector('.flower-composer-continue')?.textContent?.includes('Continue') ?? false);
    expect(runtime.textContent).toContain('Answer the newer prompt.');
    expect(runtime.textContent).not.toContain('Answer the first prompt.');
    expect((runtime.querySelector('.flower-composer textarea') as HTMLTextAreaElement).disabled).toBe(false);
  });

  it('keeps thread navigation clickable while thread A admission is delayed', async () => {
    const requestA = inputRequest({
      prompt_id: 'prompt-a',
      questions: [{ id: 'answer-a', header: 'A', question: 'Answer A', response_mode: 'write' }],
    });
    const requestB = inputRequest({
      prompt_id: 'prompt-b',
      questions: [{ id: 'answer-b', header: 'B', question: 'Answer B', response_mode: 'write' }],
    });
    const threadA = thread({ thread_id: 'thread-a', title: 'Thread A', status: 'waiting_user', input_request: requestA });
    const threadB = thread({ thread_id: 'thread-b', title: 'Thread B', status: 'waiting_user', input_request: requestB });
    const delayedReceipt = deferred<ReturnType<typeof inputAdmissionReceipt>>();
    const submitInput = vi.fn(() => delayedReceipt.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [threadA, threadB]),
      loadThread: vi.fn(async (threadID) => liveBootstrap(threadID === threadA.thread_id ? threadA : threadB, 10)),
      submitInput,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-a"] button')));
    (runtime.querySelector('[data-thread-id="thread-a"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Answer A') ?? false);
    const textarea = runtime.querySelector('.flower-composer textarea') as HTMLTextAreaElement;
    textarea.value = 'A answer';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => !(runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).disabled);
    (runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).click();
    await waitFor(() => submitInput.mock.calls.length === 1);

    const threadBCard = runtime.querySelector('[data-thread-id="thread-b"]') as HTMLElement;
    Object.defineProperty(threadBCard, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 10, top: 10, right: 210, bottom: 60, width: 200, height: 50 }),
    });
    const originalElementFromPoint = document.elementFromPoint;
    const hit = runtime.querySelector('[data-thread-id="thread-b"] button') as HTMLButtonElement;
    document.elementFromPoint = vi.fn(() => hit);
    hit.click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === 'thread-b');
    expect(document.elementFromPoint(20, 20)).toBe(hit);
    expect(threadBCard.closest('[inert]')).toBeNull();

    delayedReceipt.resolve(inputAdmissionReceipt(threadA.thread_id, requestA.prompt_id, 'turn-a', 'run-a'));
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe('thread-b');
    expect(runtime.textContent).toContain('Answer B');
    document.elementFromPoint = originalElementFromPoint;
  });
});
