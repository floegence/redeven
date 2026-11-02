import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { page } from 'vitest/browser';
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
    avatar: id === 'second' ? { kind: 'agent', identity: 'codex' } : { kind: 'initial' },
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

function expectCompactGroup(host: HTMLElement, groupId: string, scale = 1) {
  const group = host.querySelector<HTMLElement>('[data-terminal-tree-group="' + groupId + '"]')!;
  const header = group.querySelector<HTMLElement>('[data-terminal-group-header]')!;
  const folder = header.querySelector('svg[data-file-icon-type="folder"]')!;
  expect(header.getBoundingClientRect().height / scale).toBeCloseTo(32, 1);
  expect(folder).not.toBeNull();
  expect(header.querySelector('[data-terminal-group-drag-handle]')?.getAttribute('title')).toContain('/workspace/redeven');
  expect(header.textContent).not.toContain('/workspace/redeven');
  expect(group.querySelector('[data-terminal-tree-trunk], [data-terminal-tree-rail], [data-terminal-tree-connector]')).toBeNull();
  expect(getComputedStyle(folder).getPropertyValue('--floe-icon-folder').trim()).not.toBe('');
}

async function settleLayout() {
  await document.fonts.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

const surfaces = [
  { surface: 'desktop', mobile: false, scale: 1 },
  ...[0.75, 1.25, 2].map((scale) => ({ surface: `Workbench scale ${scale}`, mobile: false, scale })),
];

describe.each(['light', 'dark'])('TerminalSessionNavigator %s tree geometry', (theme) => {
  it.each(surfaces)('renders one-line directory groups with canonical folder artwork on $surface', async ({ mobile, scale }) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const host = mountNavigator(mobile, scale);
    await settleLayout();

    const search = host.querySelector<HTMLInputElement>('[data-testid="terminal-session-filter"]')!.getBoundingClientRect();
    const refresh = host.querySelector<HTMLButtonElement>('[data-testid="terminal-sidebar-refresh"]')!.getBoundingClientRect();
    expect(host.querySelector('.terminal-navigation-heading h2, .terminal-navigation-count')).toBeNull();
    expect(Math.abs(search.top + search.height / 2 - refresh.top - refresh.height / 2) / scale).toBeLessThan(1);
    expect(refresh.left).toBeGreaterThan(search.right);
    expect(host.querySelector('.terminal-navigation-heading')!.getBoundingClientRect().height / scale).toBeCloseTo(48, 1);
    expectCompactGroup(host, 'default', scale);
    expectCompactGroup(host, 'workspace', scale);
    for (const row of host.querySelectorAll('[data-terminal-session-row]')) expect(row.getBoundingClientRect().height / scale).toBeCloseTo(32, 1);
  });
});

it.each(['light', 'dark'])('uses rounded session tiles and a clean selected row in %s', async (theme) => {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const host = mountNavigator(false);
  await settleLayout();
  const row = host.querySelector<HTMLElement>('[data-terminal-session-row="first"]')!;
  const avatar = row.querySelector<HTMLElement>('[data-terminal-session-avatar]')!;
  const style = getComputedStyle(avatar);
  expect(parseFloat(style.borderRadius)).toBe(5);
  expect(avatar.getBoundingClientRect().width).toBe(18);
  expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(row.querySelector('.absolute.left-0')).toBeNull();
  const agent = host.querySelector<HTMLElement>('[data-terminal-session-avatar="second"]')!;
  expect(agent.getBoundingClientRect().width).toBe(18);
  expect(getComputedStyle(agent).borderRadius).toBe(style.borderRadius);
  await page.screenshot({ element: host, path: '../../../node_modules/.cache/terminal-workspace/sidebar-' + theme + '.png' });
});

it.each([false])('collapses groups and restores the compact folder row (mobile=%s)', async (mobile) => {
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
  expectCompactGroup(host, 'workspace');
});


it('opens mobile navigation without focusing an input and gives session actions a touch target', async () => {
  const host = mountNavigator(true);
  await settleLayout();
  await new Promise(resolve => setTimeout(resolve, 260));
  expect(document.activeElement).toBe(host.querySelector('[data-testid="terminal-session-drawer-close"]'));
  const action = host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-actions-single"]');
  expect(action).not.toBeNull();
  expect(action!.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
  expect(action!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  expect(host.querySelector('[data-terminal-tree-rail]')?.getBoundingClientRect().width ?? 0).toBe(0);
  await page.screenshot({ element: host, path: '../../../node_modules/.cache/mobile-navigation/terminal-populated.png' });
});

it('uses normal pointer cursors before a session drag starts', async () => {
  const host = mountNavigator(false);
  await settleLayout();
  for (const selector of ['[data-terminal-session-id="first"]', '[data-terminal-session-drag-handle="first"]', '[data-terminal-group-drag-handle]']) {
    expect(getComputedStyle(host.querySelector(selector)!).cursor).not.toBe('grab');
  }
});

it('keeps icon tile edges and surfaces distinguishable across all published shell palettes', async () => {
  const host = mountNavigator(false);
  const avatar = host.querySelector<HTMLElement>('[data-terminal-session-avatar]')!;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d')!;
  const luminance = (color: string) => {
    context.fillStyle = color; context.fillRect(0, 0, 1, 1);
    const values = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => {
      const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const contrast = (a: string, b: string) => {
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  for (const theme of builtInShellThemePresets) {
    for (const [token, value] of Object.entries(theme.semanticTokens ?? {})) if (value) host.style.setProperty(token, value);
    host.style.backgroundColor = 'var(--sidebar)';
    const tile = getComputedStyle(avatar); const background = getComputedStyle(host).backgroundColor;
    expect(contrast(tile.borderTopColor, background), theme.name + ' edge').toBeGreaterThan(1.4);
    expect(contrast(tile.backgroundColor, background), theme.name + ' surface').toBeGreaterThan(1.1);
    for (const token of Object.keys(theme.semanticTokens ?? {})) host.style.removeProperty(token);
  }
});
