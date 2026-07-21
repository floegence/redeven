// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TerminalSessionNavigator,
  type TerminalSessionNavigationItem,
} from './TerminalSessionNavigator';

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.innerHTML = '';
});

function renderNavigator(item: TerminalSessionNavigationItem, onSelectSession = vi.fn()) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const itemById = new Map([[item.id, item]]);
  disposers.push(render(() => (
    <TerminalSessionNavigator
      mobile={false}
      drawerOpen={false}
      connected
      refreshing={false}
      activeTitle={item.title}
      shortcutModLabel="Ctrl"
      filterQuery=""
      itemIds={[item.id]}
      itemById={itemById}
      sidebarActiveSessionId={item.id}
      activeSessionId={item.id}
      copiedPathSessionId={null}
      emptyListLoading={false}
      onCloseDrawer={() => undefined}
      onCreateSession={() => undefined}
      onRefresh={() => undefined}
      onFilterQueryChange={() => undefined}
      onPreviewSession={() => undefined}
      onResetSessionPreview={() => undefined}
      onSelectSession={onSelectSession}
      onOpenKeyboardMenu={() => undefined}
      onOpenContextMenu={() => undefined}
      onCopyPath={() => undefined}
      onCloseSession={() => undefined}
      onOpenFiles={() => undefined}
    />
  ), host));
  return { host, onSelectSession };
}

function navigationItem(overrides: Partial<TerminalSessionNavigationItem> = {}): TerminalSessionNavigationItem {
  return {
    id: 'agent-session',
    label: 'Terminal 1',
    title: 'codex',
    avatarInitial: 'R',
    avatarTone: {
      background: 'rgb(10, 20, 30)',
      border: 'rgb(40, 50, 60)',
      foreground: 'rgb(240, 240, 240)',
    },
    fullPath: '/workspace/redeven',
    processState: 'running',
    outputState: 'streaming',
    attentionState: 'unread',
    agentIdentity: 'codex',
    canBrowsePath: true,
    canClear: true,
    canDuplicate: true,
    closable: true,
    ...overrides,
  };
}

describe('TerminalSessionNavigator agent status presentation', () => {
  it('renders brand identity, process, output, and unread signals at the same time', () => {
    const { host } = renderNavigator(navigationItem());

    expect(host.querySelector('[data-terminal-agent-identity="codex"]')).not.toBeNull();
    expect(host.querySelector('[data-terminal-process-state="running"]')).not.toBeNull();
    expect(host.querySelector('[data-terminal-output-state="streaming"]')).not.toBeNull();
    expect(host.querySelector('[data-terminal-attention-state="unread"]')).not.toBeNull();
    expect(host.querySelector('[data-terminal-session-avatar="agent-session"]')?.className).toContain('h-9 w-9');
    expect(host.querySelector('[data-terminal-output-trigger="agent-session"]')?.className).toContain('h-7 w-7');
    const rowButton = host.querySelector<HTMLButtonElement>('button[data-terminal-session-id="agent-session"]')!;
    const descriptionId = rowButton.getAttribute('aria-describedby');
    expect(descriptionId).toBe('terminal-session-status-agent-session');
    expect(host.querySelector(`#${descriptionId}`)?.textContent).toContain('foreground process is running');
    expect(host.querySelector(`#${descriptionId}`)?.textContent).toContain('Unread terminal output');
    expect(rowButton.hasAttribute('aria-live')).toBe(false);
    expect(rowButton.hasAttribute('aria-busy')).toBe(false);
  });

  it('uses a static flat line for settled output without claiming success', () => {
    const { host } = renderNavigator(navigationItem({ outputState: 'settled' }));
    const trigger = host.querySelector<HTMLButtonElement>('[data-terminal-output-trigger="agent-session"]');

    expect(host.querySelector('[data-terminal-output-state="settled"]')).not.toBeNull();
    expect(trigger?.getAttribute('aria-label')).toContain('stable');
    expect(trigger?.querySelector('svg')?.className).not.toContain('animate-spin');
    expect(trigger?.textContent?.toLowerCase()).not.toContain('complete');
  });

  it('opens output help from touch-style clicks without selecting the session and closes on Escape', async () => {
    const onSelectSession = vi.fn();
    const { host } = renderNavigator(navigationItem(), onSelectSession);
    const trigger = host.querySelector<HTMLButtonElement>('[data-terminal-output-trigger="agent-session"]')!;

    trigger.focus();
    trigger.click();
    await Promise.resolve();
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('producing');
    expect(onSelectSession).not.toHaveBeenCalled();

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();
    expect(document.body.querySelector('[role="tooltip"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('does not open output help when ordinary session selection focuses the row', async () => {
    const { host } = renderNavigator(navigationItem());
    host.querySelector<HTMLButtonElement>('button[data-terminal-session-id="agent-session"]')?.focus();
    await Promise.resolve();

    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('keeps the neutral initial avatar and no agent output indicator for ordinary commands', () => {
    const { host } = renderNavigator(navigationItem({
      title: 'top',
      agentIdentity: null,
      outputState: 'none',
      attentionState: 'none',
    }));

    expect(host.querySelector('[data-terminal-agent-identity]')).toBeNull();
    expect(host.querySelector('[data-terminal-session-avatar="agent-session"]')?.textContent).toContain('R');
    expect(host.querySelector('[data-terminal-output-state]')).toBeNull();
  });
});
