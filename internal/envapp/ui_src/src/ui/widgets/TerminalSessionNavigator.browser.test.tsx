import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import {
  TerminalSessionNavigator,
  type TerminalSessionNavigationGroup,
  type TerminalSessionNavigationItem,
} from './TerminalSessionNavigator';

let dispose: (() => void) | undefined;
const initialDark = document.documentElement.classList.contains('dark');

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  document.documentElement.classList.toggle('dark', initialDark);
});

function mountNavigator(mobile: boolean, scale = 1) {
  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'relative',
    display: 'flex',
    width: mobile ? '360px' : '640px',
    height: '800px',
    transform: `translate(13px, 7px) scale(${scale})`,
    transformOrigin: 'top left',
  });
  document.body.appendChild(host);
  const items: TerminalSessionNavigationItem[] = ['single', 'first', 'second'].map((id) => ({
    id,
    label: id,
    title: id,
    avatarInitial: 'T',
    avatarTone: { background: '#ddd', border: '#999', foreground: '#333' },
    avatar: { kind: 'initial' },
    subtitleIcon: 'none',
    subtitle: '/workspace/redeven',
    fullPath: '/workspace/redeven',
    localWorkingDir: '/workspace/redeven',
    transitionIndicator: 'none',
    processRunning: false,
    transitionState: 'none',
    failureKind: 'none',
    outputState: 'none',
    activitySource: 'none',
    attentionState: 'none',
    remote: false,
    canBrowsePath: true,
    filesAvailability: 'available',
    canClear: true,
    canDuplicate: true,
    closable: true,
  }));
  const [groups, setGroups] = createSignal<TerminalSessionNavigationGroup[]>([
    { id: 'default', name: 'Default', itemIds: ['single'], isDefault: true },
    { id: 'workspace', name: 'Workspace', itemIds: ['first', 'second'], isDefault: false },
    { id: 'empty', name: 'Empty', itemIds: [], isDefault: false },
  ].map((group) => ({
    ...group,
    defaultWorkingDir: '/workspace/redeven',
    expanded: true,
    totalSessionCount: group.itemIds.length,
  })));
  dispose = render(() => (
    <TerminalSessionNavigator
      accessibilityIdPrefix="terminal-tree-geometry"
      mobile={mobile}
      drawerOpen={mobile}
      connected
      refreshing={false}
      activeTitle="first"
      activeAvatar={{ kind: 'initial' }}
      filterQuery=""
      itemIds={items.map((item) => item.id)}
      itemById={new Map(items.map((item) => [item.id, item]))}
      groups={groups()}
      sidebarActiveSessionId="first"
      activeSessionId="first"
      copiedPathSessionId={null}
      emptyListLoading={false}
      onToggleGroup={(id) => setGroups((current) => current.map((group) => (
        group.id === id ? { ...group, expanded: !group.expanded } : group
      )))}
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
  ), host);
  return host;
}

function expectContinuousRail(host: HTMLElement, groupId: string) {
  const group = host.querySelector<HTMLElement>(`[data-terminal-tree-group="${groupId}"]`)!;
  const trunk = group.querySelector<HTMLElement>('[data-terminal-tree-trunk]')!;
  const rail = group.querySelector<HTMLElement>('[data-terminal-tree-rail]')!;
  const trunkRect = trunk.getBoundingClientRect();
  const railRect = rail.getBoundingClientRect();

  expect(trunkRect.width).toBeGreaterThan(0);
  expect(trunkRect.height).toBeGreaterThan(0);
  expect(railRect.height).toBeGreaterThan(0);
  expect(Math.abs(trunkRect.left - railRect.left), `${groupId}: horizontal alignment`).toBeLessThan(0.1);
  expect(Math.abs(trunkRect.bottom - railRect.top), `${groupId}: vertical continuity`).toBeLessThan(0.1);
  expect(trunkRect.width).toBeCloseTo(railRect.width, 2);
  expect(getComputedStyle(trunk).backgroundColor).toBe(getComputedStyle(rail).backgroundColor);
  for (const connector of group.querySelectorAll<HTMLElement>('[data-terminal-tree-connector]')) {
    expect(Math.abs(connector.getBoundingClientRect().left - railRect.left)).toBeLessThan(0.1);
    expect(getComputedStyle(connector).backgroundColor).toBe(getComputedStyle(rail).backgroundColor);
  }
}

async function settleLayout() {
  await document.fonts.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

const surfaces = [
  { surface: 'desktop', mobile: false, scale: 1 },
  { surface: 'mobile drawer', mobile: true, scale: 1 },
  ...[0.75, 1.25, 2].map((scale) => ({ surface: `Workbench scale ${scale}`, mobile: false, scale })),
];

describe.each(['light', 'dark'])('TerminalSessionNavigator %s tree geometry', (theme) => {
  it.each(surfaces)('joins group and session rails on $surface', async ({ mobile, scale }) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const host = mountNavigator(mobile, scale);
    await settleLayout();

    expectContinuousRail(host, 'default');
    expectContinuousRail(host, 'workspace');
  });
});

it.each([false, true])('removes empty and folded rails and restores alignment (mobile=%s)', async (mobile) => {
  const host = mountNavigator(mobile);
  await settleLayout();
  const empty = host.querySelector('[data-terminal-tree-group="empty"]')!;
  expect(empty.querySelector('[data-terminal-tree-trunk], [data-terminal-tree-rail]')).toBeNull();

  const toggle = host.querySelector<HTMLButtonElement>('[data-testid="terminal-group-toggle-workspace"]')!;
  toggle.click();
  await settleLayout();
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  const folded = host.querySelector('[data-terminal-tree-group="workspace"]')!;
  expect(folded.querySelector('[data-terminal-tree-trunk], [data-terminal-tree-rail], [data-terminal-tree-child]')).toBeNull();

  toggle.click();
  await settleLayout();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expectContinuousRail(host, 'workspace');
});
