// @vitest-environment jsdom

import { createMemo, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TerminalSessionNavigator,
  describeTerminalSessionNavigationItem,
  joinTerminalStatusAnnouncements,
  terminalStatusSentence,
  type TerminalSessionNavigationItem,
} from './TerminalSessionNavigator';

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function renderNavigator(item: TerminalSessionNavigationItem, onSelectSession = vi.fn()) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const itemById = new Map([[item.id, item]]);
  disposers.push(render(() => (
    <TerminalSessionNavigator
      accessibilityIdPrefix="terminal-panel-test"
      mobile={false}
      drawerOpen={false}
      connected
      refreshing={false}
      activeTitle={item.title}
      activeAvatar={item.avatar}
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
    avatar: { kind: 'agent', identity: 'codex' },
    subtitleIcon: 'none',
    subtitle: '/workspace/redeven',
    fullPath: '/workspace/redeven',
    localWorkingDir: '/workspace/redeven',
    processState: 'none',
    transitionState: 'none',
    failureKind: 'none',
    outputState: 'streaming',
    activitySource: 'output',
    attentionState: 'unread',
    remote: false,
    canBrowsePath: true,
    canClear: true,
    canDuplicate: true,
    closable: true,
    ...overrides,
  };
}

describe('TerminalSessionNavigator agent status presentation', () => {
  it('restores desktop focus when a session control or its row disappears', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const [items, setItems] = createSignal([
      navigationItem({ id: 'session-1', title: 'alpha' }),
      navigationItem({ id: 'session-2', title: 'beta' }),
    ]);
    const itemIds = createMemo(() => items().map((item) => item.id));
    const itemById = createMemo(() => new Map(items().map((item) => [item.id, item])));
    disposers.push(render(() => (
      <TerminalSessionNavigator
        accessibilityIdPrefix="terminal-panel-test"
        mobile={false}
        drawerOpen={false}
        connected
        refreshing={false}
        activeTitle="alpha"
        activeAvatar={{ kind: 'initial' }}
        shortcutModLabel="Ctrl"
        filterQuery=""
        itemIds={itemIds()}
        itemById={itemById()}
        sidebarActiveSessionId="session-1"
        activeSessionId="session-1"
        copiedPathSessionId={null}
        emptyListLoading={false}
        onCloseDrawer={() => undefined}
        onCreateSession={() => undefined}
        onRefresh={() => undefined}
        onFilterQueryChange={() => undefined}
        onPreviewSession={() => undefined}
        onResetSessionPreview={() => undefined}
        onSelectSession={() => undefined}
        onOpenKeyboardMenu={() => undefined}
        onOpenContextMenu={() => undefined}
        onCopyPath={() => undefined}
        onCloseSession={() => undefined}
        onOpenFiles={() => undefined}
      />
    ), host));

    const sessionOneRow = host.querySelector<HTMLButtonElement>('button[data-terminal-session-id="session-1"]')!;
    host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-files-session-1"]')?.focus();
    setItems((current) => current.map((item) => (
      item.id === 'session-1' ? { ...item, canBrowsePath: false } : item
    )));
    await Promise.resolve();
    expect(host.querySelector('[data-testid="terminal-session-files-session-1"]')).toBeNull();
    expect(document.activeElement).toBe(sessionOneRow);

    host.querySelector<HTMLButtonElement>('[data-testid="close-session-session-1"]')?.focus();
    setItems((current) => current.filter((item) => item.id !== 'session-1'));
    await Promise.resolve();
    expect(document.activeElement)
      .toBe(host.querySelector('button[data-terminal-session-id="session-2"]'));
  });

  it('keeps the streaming wave primary while unread output accumulates', () => {
    const { host } = renderNavigator(navigationItem());

    expect(host.querySelector('[data-terminal-agent-identity="codex"]')).not.toBeNull();
    expect(host.querySelector('[data-terminal-process-state="running"]')).toBeNull();
    expect(host.querySelector('[data-terminal-output-state="streaming"]')).not.toBeNull();
    expect(host.querySelector('[data-terminal-output-attention="unread"]')).toBeNull();
    expect(host.querySelector('[data-terminal-attention-state="unread"]')).toBeNull();
    expect(host.querySelector('[data-terminal-session-avatar="agent-session"]')?.className).toContain('h-9 w-9');
    expect(host.querySelector('[data-terminal-session-avatar="agent-session"]')?.className).not.toContain('rgba(');
    expect(host.querySelector('[data-terminal-output-trigger="agent-session"]')?.className).toContain('h-7 w-7');
    const rowButton = host.querySelector<HTMLButtonElement>('button[data-terminal-session-id="agent-session"]')!;
    expect(rowButton.closest('[data-terminal-session-row]')?.className).toContain('color-mix(in_srgb,var(--foreground)_6%,transparent)');
    const descriptionId = rowButton.getAttribute('aria-describedby');
    expect(descriptionId).toBe('terminal-panel-test-session-status-agent-session');
    expect(host.querySelector(`#${descriptionId}`)?.textContent).toContain('Unread terminal output');
    expect(rowButton.hasAttribute('aria-live')).toBe(false);
    expect(rowButton.hasAttribute('aria-busy')).toBe(false);
  });

  it('uses a stable amber attention dot when an Agent needs user input', () => {
    const { host } = renderNavigator(navigationItem({ outputState: 'none', attentionState: 'waiting' }));
    const waitingDot = host.querySelector<HTMLElement>('[data-terminal-attention-state="waiting"]');

    expect(waitingDot).not.toBeNull();
    expect(waitingDot?.className).toContain('bg-current');
    expect(host.querySelector('[data-terminal-attention-trigger="agent-session"]')?.className).toContain('text-warning');
    expect(host.querySelector('[data-terminal-output-state]')).toBeNull();
    expect(host.querySelector('[data-terminal-tab-status="waiting"]')).not.toBeNull();
  });

  it('opens waiting help from touch-style clicks and closes it on Escape', async () => {
    const onSelectSession = vi.fn();
    const { host } = renderNavigator(
      navigationItem({ outputState: 'none', activitySource: 'none', attentionState: 'waiting' }),
      onSelectSession,
    );
    const trigger = host.querySelector<HTMLButtonElement>('[data-terminal-attention-trigger="agent-session"]')!;

    trigger.focus();
    trigger.click();
    await Promise.resolve();
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('User input');
    expect(onSelectSession).not.toHaveBeenCalled();

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();
    expect(document.body.querySelector('[role="tooltip"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps an idle Agent quiet after output settles', () => {
    const { host } = renderNavigator(navigationItem({ outputState: 'none', attentionState: 'none' }));

    expect(host.querySelector('[data-terminal-output-state]')).toBeNull();
    expect(host.querySelector('[data-terminal-attention-state]')).toBeNull();
    expect(host.querySelector('[data-terminal-process-state="running"]')).toBeNull();
  });

  it('describes semantic Agent work without claiming terminal output', () => {
    const { host } = renderNavigator(navigationItem({ activitySource: 'semantic', attentionState: 'none' }));
    const trigger = host.querySelector<HTMLButtonElement>('[data-terminal-output-trigger="agent-session"]')!;
    const rowButton = host.querySelector<HTMLButtonElement>('button[data-terminal-session-id="agent-session"]')!;
    const descriptionId = rowButton.getAttribute('aria-describedby') ?? '';

    expect(trigger.getAttribute('aria-label')).toBe('Working');
    expect(trigger.dataset.terminalActivitySource).toBe('semantic');
    expect(host.querySelector(`#${descriptionId}`)?.textContent).toContain('Working');
    expect(host.querySelector(`#${descriptionId}`)?.textContent).not.toContain('output');
  });

  it('opens output help from touch-style clicks without selecting the session and closes on Escape', async () => {
    const onSelectSession = vi.fn();
    const { host } = renderNavigator(navigationItem(), onSelectSession);
    const trigger = host.querySelector<HTMLButtonElement>('[data-terminal-output-trigger="agent-session"]')!;

    trigger.focus();
    trigger.click();
    await Promise.resolve();
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('Terminal output is active');
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
      avatar: { kind: 'initial' },
      outputState: 'none',
      attentionState: 'none',
    }));

    expect(host.querySelector('[data-terminal-agent-identity]')).toBeNull();
    expect(host.querySelector('[data-terminal-session-avatar="agent-session"]')?.textContent).toContain('R');
    expect(host.querySelector('[data-terminal-session-avatar="agent-session"]')?.className).toContain('color-mix(in_srgb,var(--background)_18%,transparent)');
    expect(host.querySelector('[data-terminal-output-state]')).toBeNull();
  });

  it('shows confirmed ordinary foreground work independently from unread attention', () => {
    const { host } = renderNavigator(navigationItem({
      title: 'top',
      avatar: { kind: 'initial' },
      processState: 'running',
      outputState: 'none',
      attentionState: 'unread',
    }));
    const rowButton = host.querySelector<HTMLButtonElement>('button[data-terminal-session-id="agent-session"]')!;
    const descriptionId = rowButton.getAttribute('aria-describedby') ?? '';

    expect(host.querySelector('[data-terminal-process-state="running"]')).not.toBeNull();
    expect(host.querySelector('[data-terminal-attention-state="unread"]')).not.toBeNull();
    expect(host.querySelector(`#${descriptionId}`)?.textContent).toContain('The foreground process is running.');
    expect(host.querySelector(`#${descriptionId}`)?.textContent).toContain('Unread terminal output.');
  });

  it('discloses the full title and subtitle from row focus and closes on Escape', async () => {
    vi.useFakeTimers();
    const { host } = renderNavigator(navigationItem({
      title: 'root@build-runner-with-a-very-long-hostname.example.internal',
      subtitle: '/srv/repositories/redeven/feature/terminal-context',
      fullPath: '/srv/repositories/redeven/feature/terminal-context',
    }));
    const rowButton = host.querySelector<HTMLButtonElement>('button[data-terminal-session-id="agent-session"]')!;
    expect(rowButton.getAttribute('aria-label')).toContain('/srv/repositories/redeven/feature/terminal-context');
    rowButton.focus();
    await vi.advanceTimersByTimeAsync(300);
    expect(document.body.querySelector('[role="tooltip"]')?.textContent)
      .toContain('root@build-runner-with-a-very-long-hostname.example.internal');
    expect(document.body.querySelector('[role="tooltip"]')?.textContent)
      .toContain('/srv/repositories/redeven/feature/terminal-context');

    rowButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();
    expect(document.body.querySelector('[role="tooltip"]')?.getAttribute('aria-hidden') ?? 'true').toBe('true');
  });

  it('keeps ordinary session unread attention in the title slot', () => {
    const { host } = renderNavigator(navigationItem({
      title: 'top',
      avatar: { kind: 'initial' },
      outputState: 'none',
    }));

    expect(host.querySelector('[data-terminal-attention-state="unread"]')).not.toBeNull();
    expect(host.querySelector('[data-terminal-output-attention="unread"]')).toBeNull();
  });

  it('uses the Link avatar for an idle remote shell without a spinner', () => {
    const { host } = renderNavigator(navigationItem({
      title: 'root@host',
      avatar: { kind: 'link' },
      remote: true,
      subtitle: '/root/project',
      fullPath: '/root/project',
      localWorkingDir: '',
      processState: 'none',
      outputState: 'none',
      attentionState: 'none',
      canBrowsePath: false,
      canDuplicate: false,
    }));

    expect(host.querySelector('[data-terminal-session-title="agent-session"]')?.textContent).toBe('root@host');
    expect(host.querySelector('[data-terminal-process-state="running"]')).toBeNull();
    expect(host.querySelector('[data-terminal-session-avatar="agent-session"] svg')).not.toBeNull();
  });

  it('shows a Link location marker beneath an Agent running over SSH', () => {
    const { host } = renderNavigator(navigationItem({
      subtitleIcon: 'link',
      subtitle: 'root@host · /root/project',
      remote: true,
    }));

    const path = host.querySelector('[data-testid="terminal-session-path-agent-session"]');
    expect(path?.previousElementSibling?.tagName.toLowerCase()).toBe('svg');
    expect(path?.textContent).toBe('root@host · /root/project');
  });

  it('describes a pending session creation failure precisely', () => {
    const { host } = renderNavigator(navigationItem({
      processState: 'failed',
      transitionState: 'failed',
      failureKind: 'creation',
      outputState: 'none',
      activitySource: 'none',
      attentionState: 'none',
    }));
    const rowButton = host.querySelector<HTMLButtonElement>('button[data-terminal-session-id="agent-session"]')!;
    const descriptionId = rowButton.getAttribute('aria-describedby') ?? '';

    expect(descriptionId).toBe('terminal-panel-test-session-status-agent-session');
    expect(host.querySelector(`#${descriptionId}`)?.textContent).toContain('Creation failed');
    expect(host.querySelector(`#${descriptionId}`)?.textContent).not.toContain('Needs attention');
  });

  it('describes a blocking terminal runtime failure precisely', () => {
    const { host } = renderNavigator(navigationItem({
      processState: 'failed',
      transitionState: 'failed',
      failureKind: 'runtime',
      outputState: 'none',
      activitySource: 'none',
      attentionState: 'none',
    }));
    const rowButton = host.querySelector<HTMLButtonElement>('button[data-terminal-session-id="agent-session"]')!;
    const descriptionId = rowButton.getAttribute('aria-describedby') ?? '';

    expect(descriptionId).toBe('terminal-panel-test-session-status-agent-session');
    expect(host.querySelector(`#${descriptionId}`)?.textContent).toContain('This terminal could not be restored.');
    expect(host.querySelector(`#${descriptionId}`)?.textContent).not.toContain('Needs attention');
  });

  it('preserves localized sentence punctuation while completing unpunctuated statuses', () => {
    const messages: Record<string, string> = {
      'terminal.reconnecting': 'Terminal wird erneut verbunden...',
      'terminal.terminalUnavailable': 'Dieses Terminal konnte nicht wiederhergestellt werden.',
      'terminal.creatingStatus': 'Creating terminal',
    };
    const t = ((key: string, params?: Record<string, unknown>) => (
      key === 'terminal.statusSentence'
        ? `${String(params?.status ?? '')}.`
        : key === 'terminal.statusAnnouncementPair'
          ? `${String(params?.first ?? '')} ${String(params?.second ?? '')}`
        : messages[key] ?? ''
    )) as Parameters<typeof describeTerminalSessionNavigationItem>[1];
    const base = navigationItem({
      avatar: { kind: 'initial' },
      outputState: 'none',
      activitySource: 'none',
      attentionState: 'none',
    });

    expect(describeTerminalSessionNavigationItem({
      ...base,
      transitionState: 'reconnecting',
    }, t)).toBe('Terminal wird erneut verbunden...');
    expect(describeTerminalSessionNavigationItem({
      ...base,
      transitionState: 'failed',
      failureKind: 'runtime',
    }, t)).toBe('Dieses Terminal konnte nicht wiederhergestellt werden.');
    expect(describeTerminalSessionNavigationItem({
      ...base,
      transitionState: 'creating',
    }, t)).toBe('Creating terminal.');
  });

  it('uses CJK sentence punctuation and joins complete announcements without ASCII separators', () => {
    const t = ((key: string, params?: Record<string, unknown>) => {
      if (key === 'terminal.statusSentence') return `${String(params?.status ?? '')}。`;
      if (key === 'terminal.statusAnnouncementPair') {
        return `${String(params?.first ?? '')}${String(params?.second ?? '')}`;
      }
      return '';
    }) as Parameters<typeof terminalStatusSentence>[1];

    expect(terminalStatusSentence('入力が必要です', t)).toBe('入力が必要です。');
    expect(terminalStatusSentence('復元に失敗しました。', t)).toBe('復元に失敗しました。');
    expect(joinTerminalStatusAnnouncements([
      'ビルド。入力が必要です。',
      'レビュー。未読の出力があります。',
    ], t)).toBe('ビルド。入力が必要です。レビュー。未読の出力があります。');
  });

  it('reserves four explicit trailing action cells even when actions are unavailable', () => {
    const { host } = renderNavigator(navigationItem({
      fullPath: '',
      canBrowsePath: false,
      closable: false,
    }));
    const grid = host.querySelector('[data-terminal-session-actions="agent-session"]');
    const cells = Array.from(grid?.querySelectorAll('[data-terminal-session-action-cell]') ?? []);

    expect(cells.map((cell) => cell.getAttribute('data-terminal-session-action-cell'))).toEqual([
      'index',
      'close',
      'copy',
      'files',
    ]);
    expect(grid?.className).toContain('grid-cols-[20px_20px]');
    expect(grid?.className).toContain('grid-rows-[20px_20px]');
  });
});
