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

  it('separates compact status badges from text actions in the header rail', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <CodexHeaderBar
        summary={{
          threadTitle: 'New chat',
          workspaceLabel: '/workspace',
          modelLabel: 'GPT-5.4',
          statusLabel: 'working',
          statusFlags: ['workspace dirty'],
          contextLabel: 'Workspace',
          contextDetail: '/workspace',
          hostReady: true,
          pendingRequestCount: 2,
        }}
        actions={[
          {
            key: 'archive',
            label: 'Archive',
            aria_label: 'Archive Codex thread',
            onClick: () => undefined,
          },
          {
            key: 'review',
            label: 'Review',
            aria_label: 'Review current workspace changes',
            onClick: () => undefined,
          },
        ]}
      />
    ), host);

    expect(host.querySelector('.codex-page-header-badges')).not.toBeNull();
    expect(host.querySelectorAll('.codex-page-header-tag').length).toBe(2);
    expect(host.textContent).toContain('working');
    expect(host.textContent).toContain('2 pending');
    expect(host.textContent).not.toContain('workspace dirty');
    expect(host.querySelector('.codex-page-header-actions')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Archive Codex thread"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Review current workspace changes"]')).not.toBeNull();
  });

  it('prefers the install-required badge over pending counts and status flags when host access is unavailable', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <CodexHeaderBar
        summary={{
          threadTitle: 'New chat',
          workspaceLabel: '/workspace',
          modelLabel: 'GPT-5.4',
          statusLabel: 'idle',
          statusFlags: ['workspace dirty'],
          contextLabel: 'Workspace',
          contextDetail: '/workspace',
          hostReady: false,
          pendingRequestCount: 3,
        }}
        actions={[]}
      />
    ), host);

    expect(host.querySelectorAll('.codex-page-header-tag').length).toBe(1);
    expect(host.textContent).toContain('Install required');
    expect(host.textContent).not.toContain('3 pending');
    expect(host.textContent).not.toContain('workspace dirty');
  });

  it('suppresses Codex bridge not-loaded lifecycle noise in the header', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <CodexHeaderBar
        summary={{
          threadTitle: 'Existing chat',
          workspaceLabel: '/workspace',
          modelLabel: 'GPT-5.4',
          statusLabel: 'not loaded',
          statusFlags: [],
          contextLabel: '',
          contextDetail: '',
          hostReady: true,
          pendingRequestCount: 0,
        }}
        actions={[]}
      />
    ), host);

    expect(host.querySelector('.codex-page-header-badges')).toBeNull();
    expect(host.textContent).not.toContain('not loaded');
  });
});
