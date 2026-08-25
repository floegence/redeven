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

function renderNavigator(item: TerminalSessionNavigationItem, onSelectSession = vi.fn(), options?: {
  groups?: Parameters<typeof TerminalSessionNavigator>[0]['groups'];
  additionalItems?: readonly TerminalSessionNavigationItem[];
  onRelocateSession?: (sessionId: string, groupId: string, beforeSessionId: string | null) => void;
  onOpenGroupContextMenu?: (event: MouseEvent, groupId: string) => void;
  onToggleGroup?: (groupId: string) => void;
}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const items = [item, ...(options?.additionalItems ?? [])];
  const itemById = new Map(items.map((navigationItem) => [navigationItem.id, navigationItem]));
  disposers.push(render(() => (
    <TerminalSessionNavigator
      accessibilityIdPrefix="terminal-panel-test"
      mobile={false}
      drawerOpen={false}
      connected
      refreshing={false}
      activeTitle={item.title}
      activeAvatar={item.avatar}
      filterQuery=""
      itemIds={items.map((navigationItem) => navigationItem.id)}
      itemById={itemById}
      groups={options?.groups}
      sidebarActiveSessionId={item.id}
      activeSessionId={item.id}
      copiedPathSessionId={null}
      emptyListLoading={false}
      onCloseDrawer={() => undefined}
      onRelocateSession={options?.onRelocateSession}
      onOpenGroupContextMenu={options?.onOpenGroupContextMenu}
      onToggleGroup={options?.onToggleGroup}
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

function dispatchDragEvent(target: Element, type: 'dragstart' | 'dragover' | 'drop' | 'dragend', dataTransfer: DataTransfer, clientY = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  Object.defineProperty(event, 'clientY', { value: clientY });
  target.dispatchEvent(event);
  return event;
}

function createDataTransfer(): DataTransfer {
  const entries = new Map<string, string>();
  const transfer = {
    dropEffect: 'none',
    effectAllowed: 'none',
    types: [] as string[],
    getData(type: string) {
      return entries.get(type) ?? '';
    },
    setData(type: string, value: string) {
      entries.set(type, value);
      transfer.types = [...entries.keys()];
    },
  };
  return transfer as unknown as DataTransfer;
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
    transitionIndicator: 'none',
    processRunning: false,
    transitionState: 'none',
    failureKind: 'none',
    outputState: 'streaming',
    activitySource: 'output',
    attentionState: 'unread',
    remote: false,
    canBrowsePath: true,
    filesAvailability: 'available',
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
        filterQuery=""
        itemIds={itemIds()}
        itemById={itemById()}
        sidebarActiveSessionId="session-1"
        activeSessionId="session-1"
        copiedPathSessionId={null}
        emptyListLoading={false}
        onCloseDrawer={() => undefined}
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

    host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-files-session-1"]')?.focus();
    setItems((current) => current.map((item) => (
      item.id === 'session-1' ? { ...item, canBrowsePath: false, filesAvailability: 'invalid' } : item
    )));
    await Promise.resolve();
    const disabledFiles = host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-files-session-1"]');
    expect(disabledFiles?.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(disabledFiles);

    host.querySelector<HTMLButtonElement>('[data-testid="close-session-session-1"]')?.focus();
    setItems((current) => current.filter((item) => item.id !== 'session-1'));
    await Promise.resolve();
    expect(document.activeElement)
      .toBe(host.querySelector('button[data-terminal-session-id="session-2"]'));
  });

  it('keeps the streaming wave primary while unread output accumulates', () => {
    const { host } = renderNavigator(navigationItem());

    expect(host.querySelector('[data-terminal-agent-identity="codex"]')).not.toBeNull();
    expect(host.querySelector('[data-terminal-transition-indicator="spinner"]')).toBeNull();
    expect(host.querySelector('[data-terminal-output-state="streaming"]')).not.toBeNull();
    expect(host.querySelector('[data-terminal-output-attention="unread"]')).toBeNull();
    expect(host.querySelector('[data-terminal-attention-state="unread"]')).toBeNull();
    expect(host.querySelector('[data-terminal-session-avatar="agent-session"]')?.className).toContain('h-8 w-8');
    expect(host.querySelector('[data-terminal-session-avatar="agent-session"]')?.className).not.toContain('rgba(');
    expect(host.querySelector('[data-terminal-output-trigger="agent-session"]')?.className).toContain('h-7 w-7');
    const rowButton = host.querySelector<HTMLButtonElement>('button[data-terminal-session-id="agent-session"]')!;
    expect(rowButton.closest('[data-terminal-session-row]')?.className).toContain('border-primary/35');
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
    expect(host.querySelector('[data-terminal-transition-indicator="spinner"]')).toBeNull();
  });

  it.each([
    ['creating', 'initial', 'Creating terminal'],
    ['reconnecting', 'initial', 'Reconnecting'],
    ['opening', 'link', 'Connecting to SSH'],
    ['creating', 'agent', 'Agent CLI: Codex'],
  ] as const)('shows an explicit spinner for %s %s initialization', (transitionState, avatarKind, description) => {
    const avatar = avatarKind === 'agent'
      ? { kind: 'agent' as const, identity: 'codex' as const }
      : avatarKind === 'link'
        ? { kind: 'link' as const }
        : { kind: 'initial' as const };
    const { host } = renderNavigator(navigationItem({
      avatar,
      transitionIndicator: 'spinner',
      transitionState,
      processRunning: false,
      outputState: 'none',
      activitySource: 'none',
      attentionState: 'none',
    }));
    const rowButton = host.querySelector<HTMLButtonElement>('button[data-terminal-session-id="agent-session"]')!;
    const descriptionId = rowButton.getAttribute('aria-describedby') ?? '';

    expect(host.querySelector('[data-terminal-transition-indicator="spinner"]')).not.toBeNull();
    expect(host.querySelector('[data-terminal-tab-status="spinner"]')).not.toBeNull();
    expect(host.querySelector(`#${descriptionId}`)?.textContent).toContain(description);
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
      transitionIndicator: 'none',
      processRunning: true,
      outputState: 'none',
      attentionState: 'unread',
    }));
    const rowButton = host.querySelector<HTMLButtonElement>('button[data-terminal-session-id="agent-session"]')!;
    const descriptionId = rowButton.getAttribute('aria-describedby') ?? '';

    expect(host.querySelector('[data-terminal-transition-indicator="spinner"]')).toBeNull();
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

  it('aligns ordinary session unread attention with the output slot', () => {
    const { host } = renderNavigator(navigationItem({
      title: 'top',
      avatar: { kind: 'initial' },
      outputState: 'none',
    }));

    const outputSlot = host.querySelector('[data-terminal-output-slot="agent-session"]');
    const unreadDot = host.querySelector('[data-terminal-attention-state="unread"]');
    expect(outputSlot).not.toBeNull();
    expect(unreadDot?.parentElement).toBe(outputSlot);
    expect(host.querySelector('[data-terminal-attention-slot="agent-session"]')).toBe(outputSlot);
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
      transitionIndicator: 'none',
      outputState: 'none',
      attentionState: 'none',
      canBrowsePath: false,
      canDuplicate: false,
    }));

    expect(host.querySelector('[data-terminal-session-title="agent-session"]')?.textContent).toBe('root@host');
    expect(host.querySelector('[data-terminal-transition-indicator="spinner"]')).toBeNull();
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
      transitionIndicator: 'failed',
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
      transitionIndicator: 'failed',
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

  it('renders compact sessions beneath an independently collapsible group header', () => {
    const onToggleGroup = vi.fn();
    const item = navigationItem({ id: 'session-1' });
    const { host } = renderNavigator(item, vi.fn(), {
      groups: [{
        id: 'group-services',
        name: 'Services',
        defaultWorkingDir: '/workspace/services',
        isDefault: false,
        expanded: true,
        itemIds: ['session-1'],
        totalSessionCount: 3,
      }],
      onToggleGroup,
    });

    expect(host.querySelector('[data-terminal-group-id="group-services"]')?.textContent).toContain('Services');
    expect(host.querySelector('[data-terminal-group-id="group-services"]')?.textContent).toContain('/workspace/services');
    expect(host.querySelector('[data-terminal-group-header="group-services"]')?.className).toContain('var(--primary)_7%');
    expect(host.querySelector('[data-terminal-tree-children="group-services"]')?.className).toContain('ml-[18px]');
    expect(host.querySelector('[data-terminal-tree-children="group-services"]')?.className).toContain('pl-5');
    expect(host.querySelector('[data-terminal-tree-trunk="group-services"]')).not.toBeNull();
    expect(host.querySelector('[data-terminal-tree-rail="group-services"]')?.className).toContain('bottom-[26px]');
    expect(host.querySelector('[data-terminal-tree-connector="session-1"]')).not.toBeNull();
    expect(host.querySelector('[data-terminal-tree-junction="session-1"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="terminal-group-toggle-group-services"]')?.className).toContain('text-primary');
    expect(host.querySelector('[data-terminal-session-row="session-1"]')?.className).toContain('min-h-[52px]');
    expect(host.querySelector('[data-terminal-session-row="session-1"]')?.className).toContain('grid-cols-[32px_minmax(0,1fr)_40px]');
    host.querySelector<HTMLButtonElement>('[data-testid="terminal-group-toggle-group-services"]')?.click();
    expect(onToggleGroup).toHaveBeenCalledWith('group-services');
  });

  it('uses one continuous rail for every session branch in a group', () => {
    const firstItem = navigationItem({ id: 'session-1', title: 'alpha' });
    const secondItem = navigationItem({ id: 'session-2', title: 'beta' });
    const { host } = renderNavigator(firstItem, vi.fn(), {
      additionalItems: [secondItem],
      groups: [{
        id: 'group-services',
        name: 'Services',
        defaultWorkingDir: '/workspace/services',
        isDefault: false,
        expanded: true,
        itemIds: ['session-1', 'session-2'],
        totalSessionCount: 2,
      }],
    });

    expect(host.querySelectorAll('[data-terminal-tree-rail="group-services"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-terminal-tree-connector]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-terminal-tree-junction]')).toHaveLength(2);
    expect(host.querySelector('[data-terminal-tree-child="session-1"]')).not.toBeNull();
    expect(host.querySelector('[data-terminal-tree-child="session-2"]')).not.toBeNull();
  });

  it('keeps group creation explicit without a competing global session action', () => {
    const { host } = renderNavigator(navigationItem());
    const newSession = host.querySelector<HTMLButtonElement>('[data-testid="terminal-sidebar-add-session"]');
    const newGroup = host.querySelector<HTMLButtonElement>('[data-testid="terminal-sidebar-add-group"]');

    expect(newSession).toBeNull();
    expect(newGroup?.textContent).toContain('New group');
    expect(newGroup?.querySelector('svg')).not.toBeNull();
  });

  it('moves a dragged session to a highlighted group target', () => {
    const onRelocateSession = vi.fn();
    const item = navigationItem({ id: 'session-1' });
    const { host } = renderNavigator(item, vi.fn(), {
      groups: [{
        id: 'default',
        name: 'Default',
        defaultWorkingDir: '/workspace',
        isDefault: true,
        expanded: true,
        itemIds: [],
        totalSessionCount: 0,
      }, {
        id: 'group-services',
        name: 'Services',
        defaultWorkingDir: '/workspace/services',
        isDefault: false,
        expanded: true,
        itemIds: ['session-1'],
        totalSessionCount: 1,
      }],
      onRelocateSession,
    });
    const sessionRow = host.querySelector<HTMLElement>('[data-terminal-session-row="session-1"]')!;
    const defaultGroup = host.querySelector<HTMLElement>('[data-terminal-group-header="default"]')!;
    const dataTransfer = createDataTransfer();

    dispatchDragEvent(sessionRow, 'dragstart', dataTransfer);
    const dragOver = dispatchDragEvent(defaultGroup, 'dragover', dataTransfer);
    expect(defaultGroup.getAttribute('data-terminal-group-drop-target')).toBe('group');
    expect(defaultGroup.className).toContain('var(--primary)_15%');
    expect(defaultGroup.className).not.toContain('ring-2');
    expect(defaultGroup.className).not.toContain('scale-[1.01]');
    expect(defaultGroup.className).not.toContain('border-primary/70');
    expect(defaultGroup.className).not.toContain('shadow-[0_5px_16px');
    expect(host.querySelector('[data-terminal-group-drop-hint="default"]')).toBeNull();
    expect(host.querySelector('[data-redeven-tooltip-disabled="true"]')).not.toBeNull();
    const drop = dispatchDragEvent(defaultGroup, 'drop', dataTransfer);

    expect(dataTransfer.effectAllowed).toBe('move');
    expect(dataTransfer.dropEffect).toBe('move');
    expect(dragOver.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
    expect(onRelocateSession).toHaveBeenCalledWith('session-1', 'default', null);
  });

  it('shows before and after placement lines while reordering sessions', () => {
    const onRelocateSession = vi.fn();
    const firstItem = navigationItem({ id: 'session-1', title: 'alpha' });
    const secondItem = navigationItem({ id: 'session-2', title: 'beta' });
    const { host } = renderNavigator(firstItem, vi.fn(), {
      additionalItems: [secondItem],
      groups: [{
        id: 'default',
        name: 'Default',
        defaultWorkingDir: '/workspace',
        isDefault: true,
        expanded: true,
        itemIds: ['session-1', 'session-2'],
        totalSessionCount: 2,
      }],
      onRelocateSession,
    });
    const secondRow = host.querySelector<HTMLElement>('[data-terminal-session-row="session-2"]')!;
    const firstTreeRow = host.querySelector<HTMLElement>('[data-terminal-tree-child="session-1"]')!;
    Object.defineProperty(firstTreeRow, 'getBoundingClientRect', {
      value: () => ({ top: 100, height: 52, bottom: 152, left: 0, right: 200, width: 200, x: 0, y: 100, toJSON: () => ({}) }),
    });
    const dataTransfer = createDataTransfer();

    dispatchDragEvent(secondRow, 'dragstart', dataTransfer);
    dispatchDragEvent(firstTreeRow, 'dragover', dataTransfer, 110);
    expect(firstTreeRow.getAttribute('data-terminal-session-drop-position')).toBe('before');
    expect(host.querySelector('[data-terminal-session-drop-hint="session-1"]')?.textContent?.trim()).toBe('');
    dispatchDragEvent(firstTreeRow, 'drop', dataTransfer, 110);
    expect(onRelocateSession).toHaveBeenCalledWith('session-2', 'default', 'session-1');
  });

  it('clears every drag affordance when a native drag ends outside the navigator', () => {
    const item = navigationItem({ id: 'session-1' });
    const { host } = renderNavigator(item, vi.fn(), {
      groups: [{
        id: 'default',
        name: 'Default',
        defaultWorkingDir: '/workspace',
        isDefault: true,
        expanded: true,
        itemIds: ['session-1'],
        totalSessionCount: 1,
      }, {
        id: 'services',
        name: 'Services',
        defaultWorkingDir: '/services',
        isDefault: false,
        expanded: true,
        itemIds: [],
        totalSessionCount: 0,
      }],
    });
    const sessionRow = host.querySelector<HTMLElement>('[data-terminal-session-row="session-1"]')!;
    const servicesGroup = host.querySelector<HTMLElement>('[data-terminal-group-header="services"]')!;
    const dataTransfer = createDataTransfer();

    dispatchDragEvent(sessionRow, 'dragstart', dataTransfer);
    dispatchDragEvent(servicesGroup, 'dragover', dataTransfer);
    expect(servicesGroup.getAttribute('data-terminal-group-drop-target')).toBe('group');

    document.dispatchEvent(new Event('dragend', { bubbles: true }));

    expect(servicesGroup.getAttribute('data-terminal-group-drop-target')).toBeNull();
    expect(sessionRow.getAttribute('aria-grabbed')).toBe('false');
  });

  it('opens the same group menu from right click and the overflow action', () => {
    const onOpenGroupContextMenu = vi.fn();
    const { host } = renderNavigator(navigationItem({ id: 'session-1' }), vi.fn(), {
      groups: [{
        id: 'group-services',
        name: 'Services',
        defaultWorkingDir: '/workspace/services',
        isDefault: false,
        expanded: true,
        itemIds: ['session-1'],
        totalSessionCount: 1,
      }],
      onOpenGroupContextMenu,
    });
    const groupHeader = host.querySelector<HTMLElement>('[data-terminal-group-header="group-services"]')!;
    groupHeader.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    host.querySelector<HTMLButtonElement>('[data-testid="terminal-group-actions-group-services"]')?.click();

    expect(onOpenGroupContextMenu).toHaveBeenCalledTimes(2);
    expect(onOpenGroupContextMenu.mock.calls.map((call) => call[1])).toEqual(['group-services', 'group-services']);
    expect(groupHeader.querySelectorAll('.cursor-pointer').length).toBeGreaterThanOrEqual(4);
    expect(host.querySelector('[data-terminal-session-row="session-1"]')?.className).toContain('cursor-grab');
    expect(host.querySelector('[data-terminal-session-id="session-1"]')?.getAttribute('draggable')).toBe('true');
  });
});
