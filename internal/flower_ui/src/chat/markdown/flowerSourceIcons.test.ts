import { describe, expect, it, vi } from 'vitest';
import { bundledFlowerSourceIcon, createFlowerSourceIconResolver, flowerSourceIconPlaceholder, type FlowerSourceIcon } from './flowerSourceIcons';

const icon = (): FlowerSourceIcon => ({ expires_at: new Date(Date.now() + 90 * 86400000).toISOString(), data_url: 'data:image/png;base64,aW1hZ2U=' });

describe('Flower source icons', () => {
  it('escapes origin text inside generated icon attributes', () => {
    const placeholder = flowerSourceIconPlaceholder(new URL('https://x"y.example/article'));
    expect(placeholder).toContain('data-flower-source-origin="https://x&quot;y.example"');
    expect(placeholder).not.toContain('https://x"y.example');
  });

  it('bundles common sites and matches domain boundaries without spoofing', () => {
    for (const host of ['github.com', 'docs.github.com', 'arxiv.org', 'openai.com', 'wikipedia.org', 'stackoverflow.com', 'zhihu.com']) expect(bundledFlowerSourceIcon(host)).toBeTruthy();
    for (const host of ['github.com.evil.example', 'fakegithub.com', 'unknown.example']) expect(bundledFlowerSourceIcon(host)).toBeUndefined();
  });

  it('deduplicates pending loads and reuses the same bytes until expiry', async () => {
    let release!: (value: FlowerSourceIcon) => void;
    const request = vi.fn(() => new Promise<FlowerSourceIcon>(resolve => { release = resolve; }));
    const resolve = createFlowerSourceIconResolver(request);
    const first = resolve('https://example.com');
    expect(resolve('https://example.com')).toBe(first);
    await Promise.resolve();
    release(icon());
    const result = await first;
    expect(await resolve('https://example.com')).toBe(result);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('limits background concurrency and continues after failure', async () => {
    const releases: Array<() => void> = [];
    const request = vi.fn(() => new Promise<FlowerSourceIcon>(resolve => releases.push(() => resolve(icon()))));
    const resolve = createFlowerSourceIconResolver(request);
    const pending = Array.from({ length: 7 }, (_, index) => resolve('https://example' + index + '.com'));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(4);
    while (releases.length) { releases.shift()!(); await new Promise(r => setTimeout(r, 0)); }
    await Promise.all(pending);
    expect(request).toHaveBeenCalledTimes(7);
    const failing = vi.fn().mockRejectedValue(new Error('offline'));
    const fallback = createFlowerSourceIconResolver(failing);
    expect((await fallback('https://offline.example')).data_url).toBeUndefined();
    await fallback('https://offline.example');
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('refreshes expired resources without extending a backend expiry', async () => {
    const request = vi.fn().mockResolvedValueOnce({ expires_at: new Date(0).toISOString() }).mockResolvedValueOnce(icon());
    const resolve = createFlowerSourceIconResolver(request);
    await resolve('https://example.com');
    await resolve('https://example.com');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
