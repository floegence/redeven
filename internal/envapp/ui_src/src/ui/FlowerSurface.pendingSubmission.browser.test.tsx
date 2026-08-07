import '../index.css';
import './flower-feature.css';

import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';

import type { FlowerTurnLaunchReceipt } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  deferred,
  renderSurfaceWithAdapter,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

async function verifyPendingSubmission(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  const admission = deferred<FlowerTurnLaunchReceipt>();
  const launchTurn = vi.fn(() => admission.promise);
  const runtime = renderSurfaceWithAdapter({
    ...adapter(true),
    listThreads: vi.fn(async () => []),
    launchTurn,
  });
  await waitFor(() => Boolean(runtime.querySelector('textarea')));

  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = 'Inspect the first-turn submission experience';
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
  (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
  await waitFor(() => Boolean(runtime.querySelector('[data-flower-pending-submission-id]')));

  const transcript = runtime.querySelector('.flower-chat-transcript') as HTMLElement;
  const pending = runtime.querySelector('[data-flower-pending-submission-id]') as HTMLElement;
  const bubble = pending.querySelector('.flower-pending-submission-bubble') as HTMLElement;
  const pendingRect = pending.getBoundingClientRect();
  const transcriptRect = transcript.getBoundingClientRect();

  expect(pending.textContent).toContain('Inspect the first-turn submission experience');
  expect(pending.textContent).toContain('Sending message...');
  expect(pending.querySelector('[data-flower-message-id]')).toBeNull();
  expect(getComputedStyle(bubble).borderStyle).toBe('dashed');
  expect(textarea.value).toBe('');
  expect(textarea.disabled).toBe(true);
  expect(pendingRect.left).toBeGreaterThanOrEqual(transcriptRect.left - 1);
  expect(pendingRect.right).toBeLessThanOrEqual(transcriptRect.right + 1);
  expect(pending.scrollWidth).toBeLessThanOrEqual(pending.clientWidth + 1);
  expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
}

describe('Flower pending submission browser presentation', () => {
  it('keeps immediate first-turn feedback contained on mobile', async () => {
    await verifyPendingSubmission(375, 812);
  });

  it('keeps immediate first-turn feedback contained on desktop', async () => {
    await verifyPendingSubmission(1280, 900);
  });
});
