import '../index.css';
import './flower-feature.css';

import { describe, expect, it, vi } from 'vitest';

import {
  adapter,
  inputRequest,
  liveBootstrap,
  renderSurfaceWithAdapter,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

describe('Flower input response presentation', () => {
  it('renders the Continue action as a capsule without reshaping the decision surface', async () => {
    const waitingThread = thread({
      thread_id: 'thread-input-capsule',
      status: 'waiting_user',
      input_request: inputRequest(),
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread, 20)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-input-capsule"] button')));
    (runtime.querySelector('[data-thread-id="thread-input-capsule"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-bottom-mode="input_request"]')));

    const surface = runtime.querySelector('[data-flower-bottom-mode="input_request"]') as HTMLElement;
    const continueButton = surface.querySelector('.flower-composer-continue') as HTMLButtonElement;
    expect(window.getComputedStyle(continueButton).borderRadius).toBe('9999px');
    const continueRect = continueButton.getBoundingClientRect();
    expect(continueRect.width).toBeGreaterThan(continueRect.height);
    expect(window.getComputedStyle(surface).borderRadius).not.toBe('9999px');
  });

  it('renders settled questions and answers in one ordered receipt without choices', async () => {
    const settledThread = thread({
      thread_id: 'thread-input-response-receipt',
      status: 'success',
      messages: [{
        id: 'interaction-input-response',
        thread_id: 'thread-input-response-receipt',
        turn_id: 'turn-input-response',
        run_id: 'run-input-response',
        role: 'user',
        content: 'Second question?\nsecond answer\n\nFirst question?\nfirst answer\n\nDeployment token?',
        status: 'complete',
        created_at_ms: 21_000,
        blocks: [{
          type: 'input-response',
          questions: [
            { question_id: 'second', question: 'Second question?', answer: 'second answer' },
            { question_id: 'first', question: 'First question?', answer: 'first answer' },
            { question_id: 'token', question: 'Deployment token?', redacted: true },
          ],
        }],
      }],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [settledThread]),
      loadThread: vi.fn(async () => liveBootstrap(settledThread, 20)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-input-response-receipt"] button')));
    (runtime.querySelector('[data-thread-id="thread-input-response-receipt"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-response]')));

    const receipt = runtime.querySelector('[data-flower-input-response]') as HTMLElement;
    const rows = Array.from(receipt.querySelectorAll<HTMLElement>('[data-flower-input-response-question]'));
    expect(rows.map((row) => row.dataset.flowerInputResponseQuestion)).toEqual(['second', 'first', 'token']);
    expect(rows[0]?.textContent).toContain('Second question?');
    expect(rows[0]?.textContent).toContain('second answer');
    expect(rows[1]?.textContent).toContain('First question?');
    expect(rows[1]?.textContent).toContain('first answer');
    expect(rows[2]?.textContent).toContain('Deployment token?');
    expect(rows[2]?.textContent).toContain('Answer hidden');
    expect(receipt.querySelector('.flower-input-request-choice')).toBeNull();
    expect(receipt.textContent).not.toContain('secret-token');
  });
});
