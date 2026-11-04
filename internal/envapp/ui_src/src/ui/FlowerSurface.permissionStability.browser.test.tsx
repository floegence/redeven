import '../index.css';
import './flower-feature.css';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { adapter, renderSurfaceWithAdapterProps, settingsSnapshot, thread, liveBootstrap, waitFor } from './FlowerSurface.navigation.testHarness';

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
afterEach(() => {
  const root = document.documentElement;
  root.removeAttribute('data-floe-surface-style'); root.removeAttribute('data-floe-shell-theme');
  root.removeAttribute('style'); root.classList.remove('dark', 'light');
});
async function mount(width = 1280) {
  await page.viewport(width, 850);
  document.documentElement.dataset.floeSurfaceStyle = 'soft-neumorphic';
  const threads = new Map(['thread-1', 'thread-2'].map((id, index) => [id, thread({
    thread_id: id, title: index ? 'Review branch' : 'Deploy plan', updated_at_ms: index + 2,
    permission_type: 'full_access', messages: Array.from({ length: 30 }, (_, i) => ({
      id: `message-${i}`, turn_id: `turn-${i}`, role: i % 2 ? 'assistant' : 'user',
      content: `Message ${i}: stable conversation content.\n\nRead and retain this conversation.`, status: 'complete', created_at_ms: i + 1,
    })),
  })]));
  let revision = 1;
  const client: ReturnType<typeof adapter> = {
    ...adapter(),
    loadSettings: vi.fn(async () => ({ ...settingsSnapshot(), defaults: { permission_type: 'full_access' as const } })),
    loadThread: vi.fn(async threadID => liveBootstrap(threads.get(threadID)!, revision)),
    setThreadPermissionType: vi.fn(async (threadID, permissionType) => {
      const current = threads.get(threadID)!;
      const next = { ...current, permission_type: permissionType, settings_revision: current.settings_revision! + 1 };
      threads.set(threadID, next);
      return liveBootstrap(next, ++revision);
    }),
  };
  const host = renderSurfaceWithAdapterProps(client, { layout: true, focusThreadRequest: { request_id: 'permission-stability', thread_id: 'thread-1' } });
  host.style.cssText = 'width:100%;height:800px';
  await waitFor(() => host.textContent?.includes('Message 29') === true);
  await document.fonts.ready;
  for (let i = 0; i < 5; i++) await frame();
  return host;
}
function appearance(element: HTMLElement) {
  const css = getComputedStyle(element), rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity: css.opacity,
    visibility: css.visibility, transform: css.transform, background: css.backgroundColor, border: css.borderColor, shadow: css.boxShadow };
}
it('keeps the composer border unchanged through focus transfers', async () => {
  const host = await mount();
  const composer = host.querySelector<HTMLElement>('.flower-composer')!;
  const editor = composer.querySelector('textarea')!;
  editor.blur();
  await new Promise(resolve => setTimeout(resolve, 160));
  const before = appearance(composer);
  editor.focus();
  for (let i = 0; i < 12; i++) { await frame(); expect(appearance(composer)).toEqual(before); }
});
it.each([1280, 390])('keeps controls close to the composer bottom at %ipx', async width => {
  const host = await mount(width);
  const composer = host.querySelector<HTMLElement>('.flower-composer')!;
  const footer = composer.querySelector<HTMLElement>('.flower-composer-footer')!;
  const gap = composer.getBoundingClientRect().bottom - footer.getBoundingClientRect().bottom;
  expect(gap).toBeGreaterThanOrEqual(7);
  expect(gap).toBeLessThanOrEqual(10);
});
it.each([1280, 820, 390])('nests the bottom controls concentrically inside the composer at %ipx', async width => {
  const host = await mount(width);
  const composer = host.querySelector<HTMLElement>('.flower-composer')!;
  const outer = composer.getBoundingClientRect();
  const radius = Number.parseFloat(getComputedStyle(composer).borderBottomRightRadius);
  const send = composer.querySelector<HTMLElement>('.flower-composer-submit')!;
  const sendBounds = send.getBoundingClientRect();
  expect(Math.abs(outer.right - radius - (sendBounds.left + sendBounds.width / 2))).toBeLessThan(1);
  expect(Math.abs(outer.bottom - radius - (sendBounds.top + sendBounds.height / 2))).toBeLessThan(1);
  expect(Math.abs((outer.right - sendBounds.right) - (outer.bottom - sendBounds.bottom))).toBeLessThan(1);
  const permission = composer.querySelector<HTMLElement>('.flower-composer-controls-inline .flower-permission-trigger');
  if (width >= 820) {
    expect(permission).not.toBeNull();
    const bounds = permission!.getBoundingClientRect();
    const innerRadius = Math.min(Number.parseFloat(getComputedStyle(permission!).borderBottomLeftRadius), bounds.height / 2, bounds.width / 2);
    expect(Math.abs(outer.left + radius - (bounds.left + innerRadius))).toBeLessThan(1);
    expect(Math.abs(outer.bottom - radius - (bounds.bottom - innerRadius))).toBeLessThan(1);
    expect(Math.abs(bounds.left - outer.left - (outer.bottom - bounds.bottom))).toBeLessThan(1);
    expect(bounds.height).toBe(sendBounds.height);
    await userEvent.click(permission!);
    expect(permission!.getBoundingClientRect().toJSON()).toEqual(bounds.toJSON());
    await userEvent.keyboard('{Escape}');
  }
});
it('keeps the page stationary through repeated permission opens and gives each mode a distinct icon', async () => {
  const host = await mount();
  const composer = host.querySelector<HTMLElement>('.flower-composer')!;
  const editor = composer.querySelector('textarea')!;
  const trigger = host.querySelector<HTMLButtonElement>('.flower-permission-trigger')!;
  await userEvent.fill(editor, 'Retain this draft while choosing permissions.');
  const transcript = host.querySelector<HTMLElement>('.flower-chat-transcript')!;
  transcript.scrollTop = Math.floor(transcript.scrollHeight / 2);
  transcript.dispatchEvent(new Event('scroll'));
  for (let i = 0; i < 8; i++) await frame();
  const tracked = [...host.querySelectorAll<HTMLElement>('.flower-surface,.flower-chat-transcript,.flower-chat-bottom-dock-track,.flower-composer')];
  const before = tracked.map(appearance);
  const scrollers = [document.documentElement, document.body, ...host.querySelectorAll<HTMLElement>('*')].filter(node => node.scrollHeight > node.clientHeight);
  const scroll = () => [window.scrollX, window.scrollY, ...scrollers.map(node => node.scrollTop)];
  const beforeScroll = scroll();
  for (let cycle = 0; cycle < 3; cycle++) {
    const positions: { x: number; y: number; height: number }[] = [];
    trigger.click();
    for (let i = 0; i < 16; i++) {
      await frame();
      const panel = document.querySelector<HTMLElement>('.flower-permission-menu-layer');
      const popup = panel?.querySelector<HTMLElement>('.flower-permission-menu');
      if (panel && popup && getComputedStyle(panel).visibility === 'visible' && Number(getComputedStyle(popup).opacity) > 0) {
        positions.push({ x: panel.offsetLeft, y: panel.offsetTop, height: panel.offsetHeight });
      }
      expect(tracked.map(appearance), `opening frame ${i}`).toEqual(before);
      expect(scroll(), `scroll frame ${i}`).toEqual(beforeScroll);
      expect(host.querySelector('.flower-composer textarea')).toBe(editor);
    }
    expect(positions.length).toBeGreaterThan(1);
    for (const position of positions) expect(position, 'first painted popup position is already settled').toEqual(positions.at(-1));
    const menu = document.querySelector<HTMLElement>('.flower-permission-menu')!;
    expect(menu.contains(document.activeElement)).toBe(true);
    const icons = [...menu.querySelectorAll('.flower-permission-menu-icon')].map(icon => icon.innerHTML);
    expect(new Set(icons).size).toBe(3);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => !menu.isConnected);
  }
  expect(editor.value).toBe('Retain this draft while choosing permissions.');
});

it.each(['paper', 'porcelain-dark'])('keeps surrounding pixels stable while the permission popup opens in %s', async theme => {
  const preset = builtInShellThemePresets.find(value => value.name === theme)!;
  const root = document.documentElement;
  root.classList.add(preset.mode === 'dark' ? 'dark' : 'light');
  root.dataset.floeShellTheme = theme;
  for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) if (value) root.style.setProperty(name, value);
  const host = await mount();
  const editor = host.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  await userEvent.fill(editor, 'Preserve the writing surface. 保留草稿与选择。');
  for (let i = 0; i < 10; i++) await frame();
  const capture = commands as unknown as { capturePermissionOpening: () => Promise<{ frames: { maxChannelDelta: number; changedPixelRatio: number }[] }> };
  const evidence = await capture.capturePermissionOpening();
  expect(evidence.frames.length).toBeGreaterThan(1);
  for (const [index, sample] of evidence.frames.entries()) {
    // Bound Chromium's antialias rounding to two of 255 levels in fewer than
    // 0.1% of pixels. Page-wide color changes and visible movement still fail.
    expect(sample.maxChannelDelta, `opening frame ${index}`).toBeLessThanOrEqual(2);
    expect(sample.changedPixelRatio, `opening frame ${index}`).toBeLessThan(0.001);
  }
  await page.screenshot({ path: `__screenshots__/flower-permission-stable-${theme}.png` });
  await userEvent.keyboard('{Escape}');
  await waitFor(() => !document.querySelector('.flower-permission-menu'));
  await page.screenshot({ element: host.querySelector<HTMLElement>('.flower-composer')!, path: `__screenshots__/flower-composer-aligned-${theme}.png` });
  await page.viewport(390, 850);
  for (let i = 0; i < 5; i++) await frame();
  await page.screenshot({ element: host.querySelector<HTMLElement>('.flower-composer')!, path: `__screenshots__/flower-composer-compact-${theme}.png` });
});

it('keeps the composer border stable across thread focus handoffs and restores each draft', async () => {
  const host = await mount();
  const editor = host.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  await userEvent.fill(editor, 'Thread one draft 中文');
  const border = () => getComputedStyle(host.querySelector<HTMLElement>('.flower-composer')!).borderColor;
  const before = border();
  for (const id of ['thread-2', 'thread-1']) {
    host.querySelector<HTMLButtonElement>(`[data-thread-id="${id}"] button`)!.click();
    for (let i = 0; i < 16; i++) { await frame(); expect(border()).toBe(before); }
  }
  expect(host.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!.value).toBe('Thread one draft 中文');
});

it.each([400, 600])('does not pan the page when the last permission receives focus in a %ipx viewport', async height => {
  const host = await mount();
  await page.viewport(1280, height);
  host.style.height = `${height}px`;
  for (let i = 0; i < 8; i++) await frame();
  const trigger = host.querySelector<HTMLButtonElement>('button.flower-permission-trigger')!;
  const before = [window.scrollX, window.scrollY, document.documentElement.scrollTop, document.body.scrollTop];
  trigger.click();
  for (let i = 0; i < 20; i++) {
    await frame();
    expect([window.scrollX, window.scrollY, document.documentElement.scrollTop, document.body.scrollTop]).toEqual(before);
  }
  expect((document.activeElement as HTMLElement)?.dataset.permissionType).toBe('full_access');
});

it.each([1280, 390])('keeps mode icons synchronized through keyboard selection at %ipx', async width => {
  const host = await mount(width);
  const editor = host.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  await userEvent.fill(editor, 'Retain draft and permission context 中文');
  const more = host.querySelector<HTMLButtonElement>('.flower-composer-more-button');
  if (width < 768) await userEvent.click(more!);
  const trigger = document.querySelector<HTMLButtonElement>('button.flower-permission-trigger')!;
  for (const [key, mode] of [['Home', 'readonly'], ['ArrowDown', 'approval_required'], ['End', 'full_access']] as const) {
    await userEvent.click(trigger);
    await waitFor(() => document.querySelector('.flower-permission-menu')?.contains(document.activeElement) === true);
    await userEvent.keyboard(`{${key}}`);
    await waitFor(() => (document.activeElement as HTMLElement)?.dataset.permissionType === mode);
    const icon = document.activeElement!.querySelector('.flower-permission-menu-icon')!.innerHTML;
    await userEvent.keyboard('{Enter}');
    await waitFor(() => !document.querySelector('.flower-permission-menu'));
    expect(trigger.dataset.permissionType).toBe(mode);
    expect(trigger.querySelector('.flower-permission-icon')!.innerHTML).toBe(icon);
    expect(host.querySelector('.flower-composer textarea')).toBe(editor);
    expect(editor.value).toBe('Retain draft and permission context 中文');
  }
});
