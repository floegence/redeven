// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodexIcon } from './CodexIcon';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
}));

describe('CodexIcon', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('renders the preferred artwork by default', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <CodexIcon class="h-7 w-7" />, host);

    expect(host.querySelector('img[data-codex-icon-mode="preferred"]')).toBeTruthy();
    expect(host.querySelector('[data-codex-icon-mode="fallback"]')).toBeNull();
  });

  it('switches to the fallback glyph after an image load error', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <CodexIcon class="h-7 w-7" />, host);

    const image = host.querySelector('img[data-codex-icon-mode="preferred"]') as HTMLImageElement | null;
    expect(image).toBeTruthy();

    image?.dispatchEvent(new Event('error'));
    await Promise.resolve();

    expect(host.querySelector('img[data-codex-icon-mode="preferred"]')).toBeNull();
    expect(host.querySelector('[data-codex-icon-mode="fallback"]')).toBeTruthy();
  });
});
