// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodexIcon, CodexWorkbenchIcon } from './CodexIcon';

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

describe('CodexWorkbenchIcon', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('wraps codex artwork in a neutral contrast shell for compact workbench slots', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <CodexWorkbenchIcon class="h-[18px] w-[18px]" />, host);

    const shell = host.querySelector('[data-codex-icon-shell="workbench"]') as HTMLElement | null;
    expect(shell).toBeTruthy();
    expect(shell?.className).toContain('redeven-codex-workbench-icon');
    expect(shell?.style.width).toBe('');
    expect(shell?.style.height).toBe('');
    expect(
      shell?.querySelector('img[data-codex-icon-mode="preferred"], [data-codex-icon-mode="fallback"]')
    ).toBeTruthy();
  });

  it('keeps the shell when the preferred artwork falls back to the vector glyph', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <CodexWorkbenchIcon class="h-[18px] w-[18px]" />, host);

    const image = host.querySelector('img[data-codex-icon-mode="preferred"]') as HTMLImageElement | null;
    if (image) {
      image.dispatchEvent(new Event('error'));
      await Promise.resolve();
    }

    const shell = host.querySelector('[data-codex-icon-shell="workbench"]') as HTMLElement | null;
    expect(shell).toBeTruthy();
    expect(shell?.querySelector('[data-codex-icon-mode="fallback"]')).toBeTruthy();
  });
});
