import { describe, expect, it, vi } from 'vitest';
import { adapter, deferred, liveBootstrap, renderSurfaceWithAdapter, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import type { EnvAppTranslationKey } from './i18n';

const detail = 'context_window_tokens=3891 reserved_output_tokens=4096 request_safe_limit=-205';

describe('Flower context failure recovery', () => {
  it.each([
    ['context_budget_invalid', "The request's context and output settings are incompatible."],
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
    expect(card.textContent).not.toContain('Retry reply');
    expect(card.querySelector('button')?.textContent).toContain('Inspect and continue');
  });
});

const providerDetail = '{"provider":"chatgpt","http_status":400,"param":"tools[0].parameters","request_id":"req-fixture","response_shape":"standard_error"}';
const upstreamDetail = '{"provider":"openrouter","http_status":429,"code":"429","limit_source":"upstream_provider_shared_pool","response_shape":"standard_error"}';

describe('Flower provider failure recovery', () => {
  it.each([
    ['provider_request_invalid', 'request format', 'Retry reply'],
    ['provider_request_rejected', 'diagnostic details', 'Retry reply'],
    ['provider_server_error', 'server error', 'Retry reply'],
    ['provider_rate_limited', 'try again later', 'Retry reply'],
    ['provider_upstream_rate_limited', 'shared capacity', 'Retry reply'],
    ['chatgpt_review_required', 'connection', 'Configure current provider'],
    ['chatgpt_usage_unavailable', 'usage', 'Manage usage'],
    ['chatgpt_temporarily_unavailable', 'temporarily', 'Retry reply'],
  ])('shows concise %s guidance and copyable diagnostics', async (code, guidance, action) => {
    const diagnosticDetail = code === 'provider_upstream_rate_limited' ? upstreamDetail : providerDetail;
    const failed = thread({ status: 'failed', error: { code, message: 'raw provider text must stay private', detail: diagnosticDetail } });
    const retryThread = vi.fn(async () => liveBootstrap(thread({ status: 'idle', error: undefined }), 2));
    const writeText = vi.fn(async () => undefined);
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      const surface = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [failed]), loadThread: vi.fn(async () => liveBootstrap(failed)), retryThread });
      await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"] button')));
      surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
      await waitFor(() => Boolean(surface.querySelector('.flower-error-card')));
      const card = surface.querySelector<HTMLElement>('.flower-error-card')!;
      expect(card.querySelector('.flower-error-message')?.textContent?.toLowerCase()).toContain(guidance);
      expect(card.textContent).not.toContain('raw provider text');
      expect(card.querySelector('.flower-error-actions')?.textContent).toContain(action);
      expect(card.querySelector('a[href="https://chatgpt.com/settings/usage"]') !== null).toBe(code === 'chatgpt_usage_unavailable');
      expect(retryThread).not.toHaveBeenCalled();
      const disclosure = card.querySelector<HTMLDetailsElement>('details')!;
      expect(disclosure.open).toBe(false);
      disclosure.querySelector('summary')!.click();
      expect(disclosure.open).toBe(true);
      expect(disclosure.querySelector('pre')?.textContent).toBe(diagnosticDetail);
      disclosure.querySelector<HTMLButtonElement>('button')!.click();
      await waitFor(() => writeText.mock.calls.length === 1);
      expect(writeText).toHaveBeenCalledWith(diagnosticDetail);
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it.each([['zh-CN', '共享容量'], ['en-US', 'shared capacity']] as const)('explains shared upstream limits in %s and retries only on request', async (locale, reason) => {
    const i18n = createTestI18nHelpers(locale);
    const copy = createLocalizedFlowerSurfaceCopy({ locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
    const failed = thread({ status: 'failed', error: { code: 'provider_upstream_rate_limited', message: 'raw provider text', detail: upstreamDetail } });
    const pending = deferred<ReturnType<typeof liveBootstrap>>();
    const retryThread = vi.fn(() => pending.promise);
    const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [failed]), loadThread: vi.fn(async () => liveBootstrap(failed)), retryThread }, { copy, focusThreadRequest: { request_id: 'upstream-limit', thread_id: failed.thread_id } });
    await waitFor(() => Boolean(surface.querySelector('.flower-error-card')));
    const card = surface.querySelector<HTMLElement>('.flower-error-card')!;
    expect(card.querySelector('.flower-error-message')?.textContent).toContain(reason);
    expect(card.querySelector('.flower-error-message')?.textContent).toContain('OpenRouter');
    expect(card.textContent).not.toContain('raw provider text');
    expect(card.querySelector<HTMLDetailsElement>('details')?.open).toBe(false);
    expect(retryThread).not.toHaveBeenCalled();
    const retry = Array.from(card.querySelectorAll('button')).find((button) => button.textContent === copy.chat.retryReply)!;
    retry.click();
    retry.click();
    await waitFor(() => retryThread.mock.calls.length === 1);
    expect(retry.disabled).toBe(true);
    pending.resolve(liveBootstrap(thread({ status: 'idle', error: undefined }), 2));
    await waitFor(() => !surface.querySelector('.flower-error-card'));
    expect(retryThread).toHaveBeenCalledTimes(1);
  });
});


describe('Flower upstream error messages', () => {
  it.each(['zh-CN', 'en-US'] as const)('shows the upstream reason directly in %s', async (locale) => {
    const i18n = createTestI18nHelpers(locale);
    const copy = createLocalizedFlowerSurfaceCopy({ locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
    const reason = 'The model is overloaded. Please retry shortly.';
    const diagnostic = JSON.stringify({ provider: 'openai', http_status: 500, message: reason, response_shape: 'standard_error' });
    const failed = thread({ status: 'failed', error: { code: 'provider_server_error', message: 'controlled fallback', detail: diagnostic } });
    const retryThread = vi.fn(async () => liveBootstrap(thread({ status: 'idle', error: undefined }), 2));
    const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [failed]), loadThread: vi.fn(async () => liveBootstrap(failed)), retryThread }, { copy, focusThreadRequest: { request_id: 'server-error', thread_id: failed.thread_id } });
    await waitFor(() => Boolean(surface.querySelector('.flower-error-card')));
    const card = surface.querySelector<HTMLElement>('.flower-error-card')!;
    expect(card.querySelector('.flower-error-message')?.textContent).toBe(reason);
    expect(card.querySelector<HTMLDetailsElement>('details')?.open).toBe(false);
    expect(card.textContent).not.toContain(copy.chat.runErrors.providerUnreachable);
    expect(card.querySelector('.flower-error-actions')?.textContent).toContain(copy.chat.retryReply);
    expect(retryThread).not.toHaveBeenCalled();
  });
});
