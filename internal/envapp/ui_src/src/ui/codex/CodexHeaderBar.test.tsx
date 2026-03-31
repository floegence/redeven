// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodexHeaderBar } from './CodexHeaderBar';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button
      type={props.type ?? 'button'}
      class={props.class}
      disabled={props.disabled}
      onClick={props.onClick}
      aria-label={props['aria-label']}
      title={props.title}
    >
      {props.children}
    </button>
  ),
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
}));

vi.mock('../icons/CodexIcon', () => ({
  CodexIcon: (props: any) => <span class={props.class}>Codex</span>,
}));

vi.mock('../primitives/Tooltip', () => ({
  Tooltip: (props: any) => <div data-testid="tooltip" data-content={String(props.content ?? '')}>{props.children}</div>,
}));

describe('CodexHeaderBar', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('wraps disabled actions with a tooltip reason', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <CodexHeaderBar
        summary={{
          threadTitle: 'Codex',
          workspaceLabel: '/workspace',
          modelLabel: 'GPT-5.4',
          statusLabel: 'idle',
          statusFlags: [],
          contextLabel: '',
          contextDetail: '',
          hostReady: false,
          pendingRequestCount: 0,
        }}
        actions={[
          {
            key: 'restore',
            label: 'Restore',
            aria_label: 'Restore Codex thread',
            disabled: true,
            disabled_reason: 'host codex binary not found on PATH',
            onClick: () => undefined,
          },
        ]}
      />
    ), host);

    const restoreButton = host.querySelector('button[aria-label="Restore Codex thread"]');
    expect(restoreButton?.hasAttribute('disabled')).toBe(true);
    expect(restoreButton?.closest('[data-testid="tooltip"]')?.getAttribute('data-content')).toContain('host codex binary not found on PATH');
  });
});
