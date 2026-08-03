import '../index.css';

import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerLiveEvent,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  deferred,
  inputAdmissionReceipt,
  inputRequest,
  liveBootstrap,
  renderSurfaceWithAdapter,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

describe('Flower structured input admission browser behavior', () => {
  it('releases the consumed prompt without starting a post-admission detail read', async () => {
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
    const loadThread = vi.fn(async () => liveBootstrap(waitingThread, 10));
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
    expect(runtime.querySelector('.flower-composer [data-flower-input-request-prompt]')).toBeNull();
    expect(runtime.querySelector('.flower-composer-continue')).toBeNull();
    expect(loadThread).toHaveBeenCalledTimes(1);
    expect(runtime.textContent).not.toContain('Submitting...');
    expect((runtime.querySelector('.flower-composer textarea') as HTMLTextAreaElement).disabled).toBe(false);
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
});
