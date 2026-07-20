// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerLiveBootstrap,
  FlowerThreadSnapshot,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  activityItem,
  activityTimeline,
  adapter,
  flush,
  flowerSurfaceNotifications,
  inputRequest,
  launchReceipt,
  liveBootstrap,
  renderSurfaceWithAdapter,
  thread,
  threadOrder,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

describe('FlowerSurface navigation structured input', () => {
  it('renders structured input requests in the composer while Flower waits', async () => {
    const waitingThread = thread({
      thread_id: 'thread-waiting-input',
      title: 'Waiting input',
      created_at_ms: 3_800,
      updated_at_ms: 3_900,
      status: 'waiting_user',
      input_request: inputRequest(),
      messages: [
        {
          id: 'm-waiting-input',
          role: 'assistant',
          content: 'I need one choice before continuing.',
          status: 'complete',
          created_at_ms: 3_900,
          blocks: [
            { type: 'markdown', content: 'I need one choice before continuing.' },
            activityTimeline({
              thread_id: 'thread-waiting-input',
              run_id: 'run-waiting-input',
              turn_id: 'turn-waiting-input',
              status: 'waiting',
              severity: 'blocking',
              needs_attention: true,
              items: [activityItem({
                item_id: 'tool-ask-user',
                tool_id: 'tool-ask-user',
                tool_name: 'ask_user',
                kind: 'control',
                label: 'Requested input',
                description: 'Choose the deployment target before Flower continues.',
                renderer: 'question',
                status: 'waiting',
                severity: 'blocking',
                needs_attention: true,
                attention_reasons: ['waiting'],
                payload: {
                  reason_code: 'needs_user_choice',
                  required_from_user: ['deployment_target'],
                  questions: [{
                    id: 'deployment_target',
                    header: 'Deployment target',
                    question: 'Where should Flower deploy this change?',
                  }],
                  contains_secret: false,
                },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-waiting-input"] button')));
    (runtime.querySelector('[data-thread-id="thread-waiting-input"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-request-prompt]')));

    expect(runtime.querySelector('[data-flower-input-request-prompt]')?.textContent).toContain('Waiting for your reply');
    expect(runtime.querySelector('[data-flower-input-request-prompt]')?.textContent).toContain('Choose the deployment target before Flower continues.');
    expect(runtime.querySelector('[data-flower-input-request-prompt]')?.textContent).toContain('Where should Flower deploy this change?');
    expect(runtime.querySelector('[data-flower-input-request-prompt]')?.textContent).toContain('Staging');
    expect(runtime.querySelector('[data-flower-input-request-prompt]')?.textContent).toContain('Production');
    expect(runtime.querySelector('.flower-activity-inline')?.textContent).toContain('Requested input');
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    expect(runtime.querySelectorAll('textarea')).toHaveLength(1);
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).placeholder).toBe('Choose an option to continue.');
    expect((Array.from(runtime.querySelectorAll('.flower-composer button')) as HTMLButtonElement[])
      .some((button) => button.textContent?.includes('Continue') && button.disabled)).toBe(true);
  });

  it('uses the bottom composer password field for secret structured input', async () => {
    const secretInputRequest = inputRequest({
      contains_secret: true,
      public_summary: 'Provide the deployment token before Flower continues.',
      questions: [
        {
          id: 'deploy_token',
          header: 'Deployment token',
          question: 'Paste the deployment token.',
          is_secret: true,
          response_mode: 'write',
          write_placeholder: 'Deployment token',
        },
      ],
    });
    const waitingThread = thread({
      thread_id: 'thread-secret-input',
      title: 'Secret input',
      created_at_ms: 3_820,
      updated_at_ms: 3_920,
      status: 'waiting_user',
      input_request: secretInputRequest,
    });
    const continuedThread = thread({
      thread_id: 'thread-secret-input',
      title: 'Secret input',
      created_at_ms: 3_820,
      updated_at_ms: 4_020,
      status: 'running',
      input_request: null,
    });
    const submitInput = vi.fn(async () => liveBootstrap(continuedThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread)),
      submitInput,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-secret-input"] button')));
    (runtime.querySelector('[data-thread-id="thread-secret-input"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer input[type="password"]')));

    expect(runtime.querySelectorAll('.flower-composer input[type="password"]')).toHaveLength(1);
    expect(runtime.querySelector('.flower-composer textarea')).toBeNull();

    const password = runtime.querySelector('.flower-composer input[type="password"]') as HTMLInputElement;
    expect(password.placeholder).toBe('Deployment token');
    password.value = 'secret-token';
    password.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();
    (runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).click();
    await waitFor(() => submitInput.mock.calls.length > 0);

    expect(submitInput).toHaveBeenCalledWith({
      thread_id: 'thread-secret-input',
      prompt_id: 'prompt-ask-user',
      answers: {
        deploy_token: {
          text: 'secret-token',
        },
      },
    });
  });

  it('submits selected structured input through the adapter and keeps the same thread', async () => {
    const waitingThread = thread({
      thread_id: 'thread-submit-input',
      title: 'Submit input',
      created_at_ms: 3_850,
      updated_at_ms: 3_950,
      status: 'waiting_user',
      input_request: inputRequest(),
      messages: [
        {
          id: 'm-submit-input',
          role: 'assistant',
          content: 'Choose a target.',
          status: 'complete',
          created_at_ms: 3_950,
        },
      ],
    });
    const continuedThread = thread({
      thread_id: 'thread-submit-input',
      title: 'Submit input',
      created_at_ms: 3_850,
      updated_at_ms: 4_100,
      status: 'running',
      input_request: null,
      messages: [
        ...waitingThread.messages,
        {
          id: 'm-continued',
          role: 'assistant',
          content: 'Continuing with staging.',
          status: 'complete',
          created_at_ms: 4_100,
        },
      ],
    });
    const submitInput = vi.fn(async () => liveBootstrap(continuedThread));
    const loadThread = vi.fn(async () => liveBootstrap(loadThread.mock.calls.length === 1 ? waitingThread : continuedThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread,
      submitInput,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-submit-input"] button')));
    (runtime.querySelector('[data-thread-id="thread-submit-input"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-request-prompt]')));

    (Array.from(runtime.querySelectorAll('.flower-input-request-choice')) as HTMLButtonElement[])
      .find((button) => button.textContent?.includes('Staging'))?.click();
    await flush();
    (runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).click();
    await waitFor(() => submitInput.mock.calls.length > 0);
    await waitFor(() => runtime.textContent?.includes('Continuing with staging.') ?? false);

    expect(submitInput).toHaveBeenCalledWith({
      thread_id: 'thread-submit-input',
      prompt_id: 'prompt-ask-user',
      answers: {
        target: {
          choice_id: 'staging',
        },
      },
    });
    expect(runtime.querySelector('[data-flower-input-request-prompt]')).toBeNull();
    expect(runtime.textContent).toContain('Continuing with staging.');
  });

  it('shows structured input submission failures in the composer without losing the answer', async () => {
    const waitingThread = thread({
      thread_id: 'thread-input-error',
      title: 'Input error',
      created_at_ms: 3_860,
      updated_at_ms: 3_960,
      status: 'waiting_user',
      input_request: inputRequest(),
    });
    const submitInput = vi.fn(async () => {
      throw new Error('Flower is no longer waiting for that input.');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread)),
      submitInput,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-input-error"] button')));
    (runtime.querySelector('[data-thread-id="thread-input-error"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-request-prompt]')));

    (Array.from(runtime.querySelectorAll('.flower-input-request-choice')) as HTMLButtonElement[])
      .find((button) => button.textContent?.includes('Production'))?.click();
    await flush();
    (runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).click();
    await waitFor(() => flowerSurfaceNotifications().some((notice) => notice.message.includes('Flower is no longer waiting for that input.')));

    expect(flowerSurfaceNotifications()).toContainEqual(expect.objectContaining({
      tone: 'error',
      title: 'Flower could not send.',
      message: 'Flower is no longer waiting for that input.',
    }));
    expect(runtime.querySelector('.flower-composer-error')).toBeNull();
    expect(runtime.querySelector('.flower-composer-continue')?.textContent).toContain('Continue');
    expect(runtime.querySelector('.flower-input-request-choice-selected')?.textContent).toContain('Production');
  });

  it('clears waiting prompts when a summary-only refresh reports a terminal thread', async () => {
    const detailedThread = thread({
      thread_id: 'thread-waiting-summary-refresh',
      title: 'Waiting survives refresh',
      created_at_ms: 3_870,
      updated_at_ms: 3_970,
      status: 'waiting_user',
      input_request: inputRequest(),
    });
    const summaryOnlyThread = {
      ...detailedThread,
      updated_at_ms: 4_200,
      status: 'success' as const,
      messages: [],
      input_request: undefined,
      error: undefined,
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [detailedThread];
    let delayedDetailReloadStarted = false;
    const loadThread = vi.fn(() => {
      if (loadThread.mock.calls.length === 1) {
        return Promise.resolve(liveBootstrap(detailedThread));
      }
      delayedDetailReloadStarted = true;
      return new Promise<FlowerLiveBootstrap>(() => undefined);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-waiting-summary-refresh"] button')));
    (runtime.querySelector('[data-thread-id="thread-waiting-summary-refresh"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-request-prompt]')));

    listSnapshot = [summaryOnlyThread];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => delayedDetailReloadStarted);

    expect(runtime.querySelector('[data-flower-input-request-prompt]')).toBeNull();
  });

  it('ignores stale input requests when the thread is no longer waiting for user input', async () => {
    const staleThread = thread({
      thread_id: 'thread-stale-input',
      title: 'Stale input',
      created_at_ms: 3_890,
      updated_at_ms: 3_990,
      status: 'success',
      input_request: inputRequest(),
      messages: [
        {
          id: 'm-stale',
          role: 'assistant',
          content: 'This should behave like a normal thread.',
          status: 'complete',
          created_at_ms: 3_990,
        },
      ],
    });
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(staleThread.thread_id, input.turn_id ?? 'turn-stale-input'));
    const submitInput = vi.fn(async () => liveBootstrap(staleThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [staleThread]),
      loadThread: vi.fn(async () => liveBootstrap(staleThread)),
      launchTurn,
      submitInput,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-stale-input"] button')));
    (runtime.querySelector('[data-thread-id="thread-stale-input"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('This should behave like a normal thread.') ?? false);

    expect(runtime.querySelector('[data-flower-input-request-prompt]')).toBeNull();
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    textarea.value = 'Hello';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length > 0);
    expect(submitInput).not.toHaveBeenCalled();
  });

  it('preserves loaded details for non-selected threads during summary-only list refreshes', async () => {
    const detailedThread = thread({
      thread_id: 'thread-background',
      title: 'Background detail',
      created_at_ms: 4_000,
      updated_at_ms: 4_100,
      messages: [
        {
          id: 'm-background',
          role: 'assistant',
          content: 'Background preview remains available.',
          status: 'complete',
          created_at_ms: 4_100,
        },
      ],
    });
    const selectedThread = thread({
      thread_id: 'thread-selected',
      title: 'Selected thread',
      created_at_ms: 5_000,
      updated_at_ms: 5_100,
    });
    const summaryOnlyBackground = {
      ...detailedThread,
      updated_at_ms: 4_500,
      messages: [],
      error: undefined,
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [selectedThread, detailedThread];
    let backgroundReloadStarted = false;
    const loadThread = vi.fn((threadID: string) => {
      if (threadID === 'thread-background') {
        backgroundReloadStarted = true;
        return new Promise<FlowerLiveBootstrap>(() => undefined);
      }
      return Promise.resolve(liveBootstrap(selectedThread));
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
    });

    await waitFor(() => threadOrder(runtime).includes('thread-background'));

    (runtime.querySelector('[data-thread-id="thread-selected"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-thread-card-active')?.getAttribute('data-thread-id') === 'thread-selected');
    listSnapshot = [selectedThread, summaryOnlyBackground];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await flush();
    (runtime.querySelector('[data-thread-id="thread-background"] button') as HTMLButtonElement).click();
    await waitFor(() => backgroundReloadStarted);

    expect(runtime.textContent).toContain('Background preview remains available.');
  });

  it('shows a loading state instead of the empty state while first-loading a summary-only thread', async () => {
    const summaryThread = thread({
      thread_id: 'thread-summary-only',
      title: 'Summary only',
      created_at_ms: 4_800,
      updated_at_ms: 4_900,
      messages: [],
      error: undefined,
    });
    let loadStarted = false;
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [summaryThread]),
      loadThread: vi.fn(() => {
        loadStarted = true;
        return new Promise<FlowerLiveBootstrap>(() => undefined);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-summary-only"] button')));
    (runtime.querySelector('[data-thread-id="thread-summary-only"] button') as HTMLButtonElement).click();
    await waitFor(() => loadStarted && Boolean(runtime.querySelector('.flower-thread-loading')));

    expect(runtime.querySelector('.flower-thread-loading')?.textContent).toContain('Loading conversation...');
    expect(runtime.querySelector('.flower-thread-loading-panel')).toBeTruthy();
    expect(runtime.querySelector('.flower-thread-loading-indicator')).toBeTruthy();
    expect(runtime.querySelector('.flower-thread-loading-line')).toBeNull();
    expect(runtime.textContent).not.toContain('Flower can work from this runtime');
  });
});
