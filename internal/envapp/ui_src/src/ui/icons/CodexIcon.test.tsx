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

  it('renders the lobehub codex artwork', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <CodexIcon class="h-7 w-7" />, host);

    const artwork = host.querySelector('[data-codex-icon-mode="lobehub"]') as HTMLElement | null;
    expect(artwork).toBeTruthy();
    expect(artwork?.querySelector('svg')).toBeTruthy();
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
    expect(shell?.querySelector('[data-codex-icon-mode="lobehub"]')).toBeTruthy();
  });
});
