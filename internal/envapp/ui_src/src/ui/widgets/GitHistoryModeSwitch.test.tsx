// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../primitives/Tooltip', () => ({
  Tooltip: (props: any) => (
    <div data-testid="tooltip" data-content={String(props.content ?? '')}>
      {props.children}
    </div>
  ),
}));

import { GitHistoryModeSwitch } from './GitHistoryModeSwitch';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('GitHistoryModeSwitch', () => {
  it('wraps the disabled Git mode button with a tooltip that explains why it is unavailable', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const disabledReason = 'Git is not installed or not available in PATH on this runtime host.';
    const preview = vi.fn();

    const dispose = render(() => (
      <GitHistoryModeSwitch
        mode="files"
        onChange={() => {}}
        onPreviewGitMode={preview}
        gitHistoryDisabled
        gitHistoryDisabledReason={disabledReason}
      />
    ), host);

    try {
      const gitButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Git'));
      expect(gitButton).toBeTruthy();
      expect((gitButton as HTMLButtonElement | undefined)?.disabled).toBe(true);
      expect(gitButton?.closest('[data-testid="tooltip"]')?.getAttribute('data-content')).toBe(disabledReason);
      gitButton?.dispatchEvent(new FocusEvent('focus'));
      expect(preview).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('renders a stable sliding thumb and previews Git mode on focus', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const preview = vi.fn();
    const [mode, setMode] = createSignal<'files' | 'git'>('files');

    const dispose = render(() => (
      <GitHistoryModeSwitch
        mode={mode()}
        onChange={setMode}
        onPreviewGitMode={preview}
      />
    ), host);

    try {
      const group = host.querySelector('[data-browser-mode-switch]') as HTMLElement | null;
      const thumb = host.querySelector('.browser-mode-switch__thumb');
      const gitButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Git')) as HTMLButtonElement | undefined;
      expect(group).toBeTruthy();
      expect(thumb).toBeTruthy();
      expect(group?.getAttribute('data-mode')).toBe('files');

      gitButton?.dispatchEvent(new FocusEvent('focus'));
      expect(preview).toHaveBeenCalledTimes(1);

      gitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(group?.getAttribute('data-mode')).toBe('git');
    } finally {
      dispose();
    }
  });

  it('renders the Git mode button without a tooltip wrapper when no disabled reason is provided', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <GitHistoryModeSwitch
        mode="files"
        onChange={() => {}}
        gitHistoryDisabled={false}
      />
    ), host);

    try {
      expect(host.querySelector('[data-testid="tooltip"]')).toBeNull();
    } finally {
      dispose();
    }
  });
});
