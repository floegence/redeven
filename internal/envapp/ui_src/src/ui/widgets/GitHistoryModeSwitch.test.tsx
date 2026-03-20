// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
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
    const disabledReason = 'Git is not installed or not available in PATH on this agent.';

    const dispose = render(() => (
      <GitHistoryModeSwitch
        mode="files"
        onChange={() => {}}
        gitHistoryDisabled
        gitHistoryDisabledReason={disabledReason}
      />
    ), host);

    try {
      const gitButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Git'));
      expect(gitButton).toBeTruthy();
      expect((gitButton as HTMLButtonElement | undefined)?.disabled).toBe(true);
      expect(gitButton?.closest('[data-testid="tooltip"]')?.getAttribute('data-content')).toBe(disabledReason);
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
