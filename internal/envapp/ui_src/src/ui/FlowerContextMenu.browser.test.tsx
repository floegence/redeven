import '../index.css';
import './flower-feature.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { FileBrowserProvider, FileContextMenu, useFileBrowser } from '@floegence/floe-webapp-core/file-browser';
import { FlowerThreadList } from '../../../../flower_ui/src/threads/FlowerThreadList';
import type { FlowerThreadListItem } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const disposers: (() => void)[] = [];
const media = commands as unknown as {
  emulateTouchInput: (enabled: boolean) => Promise<void>;
  emulateMediaPreferences: (value: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void>;
};
afterEach(async () => {
  while (disposers.length) disposers.pop()?.();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark', 'light');
  await media.emulateTouchInput(false);
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
});
async function frame() { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); }
async function mount() {
  const host = document.createElement('div');
  host.className = 'flower-component-shell flower-surface';
  host.style.cssText = 'width:300px;height:600px';
  document.body.append(host);
  const thread: FlowerThreadListItem = {
    thread_id: 'menu', title: 'Conversation menu', title_status: 'ready', model_id: 'model',
    working_dir: '/workspace/project/long-directory-name', pinned: true, pin_rank: 1,
    created_at_ms: 1, updated_at_ms: 1, preview: '', status: 'idle', source_label: '', target_labels: [],
    read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } },
  };
  const [items, setItems] = createSignal<readonly FlowerThreadListItem[]>([thread]);
  disposers.push(render(() => <FlowerThreadList items={items()} query="" onQueryChange={() => undefined}
    onSelect={() => undefined} onRefresh={() => undefined} canFork canRename canPin showDeleteAction
    directoryActions={{ browse: { enabled: true }, terminal: { enabled: true } }}
  />, host));
  const trigger = host.querySelector<HTMLElement>('[data-flower-thread-card]')!;
  const open = (x = 320, y = 120) => {
    trigger.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    return document.querySelector<HTMLElement>('.flower-thread-context-menu')!;
  };
  await frame();
  return { open, setItems, thread };
}

it('shows the full menu on the first frame without an entrance transition', async () => {
  await page.viewport(1000, 760);
  const menu = (await mount()).open();
  await frame();
  expect(getComputedStyle(menu).opacity).toBe('1');
  expect(getComputedStyle(menu).transform).toBe('none');
  expect(menu.getAnimations()).toHaveLength(0);
  expect(menu.contains(document.activeElement)).toBe(true);
});

it('reaches full visibility at least as quickly as the published Files menu', async () => {
  await page.viewport(1000, 760);
  const flower = await mount();
  const filesHost = document.createElement('div');
  document.body.append(filesHost);
  let files!: ReturnType<typeof useFileBrowser>;
  const FilesMenu = () => { files = useFileBrowser(); return <FileContextMenu />; };
  disposers.push(render(() => <FileBrowserProvider files={[]}><FilesMenu /></FileBrowserProvider>, filesHost));
  await frame();
  const measure = async (open: () => HTMLElement) => {
    const start = performance.now();
    const menu = open();
    for (let frames = 1; frames <= 60; frames++) {
      await frame();
      const style = getComputedStyle(menu);
      if (style.visibility === 'visible' && style.opacity === '1') return { frames, ms: performance.now() - start };
    }
    throw new Error('Menu did not become fully visible');
  };
  const fileResult = await measure(() => {
    files.showContextMenu({ x: 320, y: 120, items: [], targetKind: 'directory-background', source: 'background', directory: null });
    return document.querySelector<HTMLElement>('[data-floe-context-menu]')!;
  });
  files.hideContextMenu();
  await frame();
  const flowerResult = await measure(() => flower.open());
  expect(flowerResult.frames).toBe(1);
  expect(flowerResult.frames).toBeLessThanOrEqual(fileResult.frames);
  console.info('Menu visibility acceptance', JSON.stringify({ files: fileResult, flower: flowerResult }));
});

it.each(['light', 'dark'])('keeps the complete desktop menu compact in %s mode', async (theme) => {
  await page.viewport(1000, 760);
  document.documentElement.classList.add(theme);
  const menu = (await mount()).open();
  await frame();
  const rows = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  expect(rows).toHaveLength(11);
  expect(rows.map(row => row.offsetHeight)).toEqual(Array(11).fill(26));
  expect(menu.offsetHeight).toBeLessThanOrEqual(360);
  expect(parseFloat(getComputedStyle(menu).borderRadius)).toBeLessThanOrEqual(10);
  expect(menu.scrollWidth).toBe(menu.clientWidth);
  await page.screenshot({ element: menu, path: `__screenshots__/flower-context-menu-${theme}.png` });
});

it('anchors the measured menu at the viewport edge and follows live size changes', async () => {
  await page.viewport(800, 600);
  const ui = await mount();
  const menu = ui.open(790, 590);
  await frame();
  const checkEdge = () => {
    const rect = menu.getBoundingClientRect();
    expect(rect.right).toBeCloseTo(792, 0);
    expect(rect.bottom).toBeCloseTo(592, 0);
  };
  checkEdge();
  ui.setItems([{ ...ui.thread, pinned: false }]);
  await frame();
  await frame();
  expect(document.querySelector('.flower-thread-context-menu')).toBe(menu);
  checkEdge();
  await userEvent.keyboard('{Escape}');
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it('retains touch targets and scrolling at a narrow viewport', async () => {
  await page.viewport(390, 600);
  await media.emulateTouchInput(true);
  const menu = (await mount()).open(380, 590);
  await frame();
  for (const row of menu.querySelectorAll<HTMLElement>('[role="menuitem"]')) expect(row.offsetHeight).toBeGreaterThanOrEqual(44);
  expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(592);
  expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(382);
  await userEvent.keyboard('{End}');
  expect(document.activeElement?.textContent).toContain('Delete');
  const last = document.activeElement!.getBoundingClientRect();
  expect(last.bottom).toBeLessThanOrEqual(menu.getBoundingClientRect().bottom);
});

it('remains immediate with reduced motion and enlarged text', async () => {
  await page.viewport(1000, 760);
  await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  document.documentElement.style.fontSize = '20px';
  const menu = (await mount()).open(990, 750);
  await frame();
  expect(getComputedStyle(menu).opacity).toBe('1');
  expect(menu.getAnimations()).toHaveLength(0);
  expect(menu.scrollWidth).toBe(menu.clientWidth);
  expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(992);
  expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(752);
});
