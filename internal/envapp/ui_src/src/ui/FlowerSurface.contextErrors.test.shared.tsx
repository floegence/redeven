import { describe, expect, it, vi } from 'vitest';
import { adapter, deferred, liveBootstrap, renderSurfaceWithAdapter, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const detail = 'context_window_tokens=3891 reserved_output_tokens=4096 request_safe_limit=-205';

describe('Flower context failure recovery', () => {
  it.each([
    ['context_budget_invalid', 'The output allowance leaves no room for input.'],
    ['context_fixed_overhead', 'The system instructions and tool definitions'],
    ['context_compaction_limit', 'The conversation still exceeds'],
  ])('explains %s and exposes deliberate recovery without automatic retry', async (code, guidance) => {
    const failed = thread({ status: 'failed', error: { code, message: 'raw engine message', detail } });
    const pending = deferred<ReturnType<typeof liveBootstrap>>();
    const retryThread = vi.fn(() => pending.promise);
    const surface = renderSurfaceWithAdapter({
      ...adapter(true), listThreads: vi.fn(async () => [failed]), loadThread: vi.fn(async () => liveBootstrap(failed)), retryThread,
    });
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"] button')));
    surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
    await waitFor(() => Boolean(surface.querySelector('.flower-error-card')));
    const card = surface.querySelector<HTMLElement>('.flower-error-card')!;
    expect(card.querySelector('.flower-error-title')?.textContent).toBe('Model context limit');
    expect(card.querySelector('.flower-error-message')?.textContent).toContain(guidance);
    expect(card.textContent).not.toContain('raw engine message');
    const disclosure = card.querySelector<HTMLDetailsElement>('details')!;
    expect(disclosure.open).toBe(false);
    disclosure.querySelector('summary')!.click();
    expect(disclosure.open).toBe(true);
    expect(disclosure.querySelector('pre')?.textContent).toBe(detail);
    expect(card.querySelector('.flower-error-actions')?.textContent).toContain('Open settings');
    expect(retryThread).not.toHaveBeenCalled();
    const retry = Array.from(card.querySelectorAll('button')).find((button) => button.textContent?.includes('Retry reply'))!;
    retry.click();
    retry.click();
    await waitFor(() => retryThread.mock.calls.length === 1);
    expect(retry.disabled).toBe(true);
    pending.resolve(liveBootstrap(thread({ status: 'idle', error: undefined }), 2));
    await waitFor(() => !surface.querySelector('.flower-error-card'));
    expect(retryThread).toHaveBeenCalledTimes(1);
  });

  it('keeps opaque failures private and does not offer retry for unknown effects', async () => {
    const failed = thread({ status: 'failed', error: { code: 'floret_effect_outcome_unknown', message: 'private effect state', detail: 'must stay hidden' } });
    const surface = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [failed]), loadThread: vi.fn(async () => liveBootstrap(failed)) });
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"] button')));
    surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
    await waitFor(() => Boolean(surface.querySelector('.flower-error-card')));
    const card = surface.querySelector('.flower-error-card')!;
    expect(card.textContent).not.toContain('private effect state');
    expect(card.textContent).not.toContain('must stay hidden');
    expect(card.querySelector('details')).toBeNull();
    expect(card.querySelector('button')).toBeNull();
  });
});
