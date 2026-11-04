import '../index.css';
import './flower-feature.css';
import { afterEach, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { expectSingleInputFocus } from '../styles/inputFocus.test-support';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { adapter, renderSurfaceWithAdapterProps, waitFor } from './FlowerSurface.navigation.testHarness';

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const media = commands as unknown as { emulateMediaPreferences: (value: { reducedMotion?: 'reduce' | 'no-preference'; forcedColors?: 'active' | 'none' }) => Promise<void> };
afterEach(async () => {
  document.documentElement.removeAttribute('data-floe-surface-style');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark', 'light');
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' });
});

async function mount(width = 1200) {
  await page.viewport(width, 850);
  document.documentElement.dataset.floeSurfaceStyle = 'soft-neumorphic';
  const host = renderSurfaceWithAdapterProps(adapter(), { layout: true });
  host.style.cssText = 'height:800px;width:100%';
  await waitFor(() => Boolean(host.querySelector('.flower-composer textarea')));
  await frame(); await frame(); await frame();
  return host;
}

it('retains horizontal composer geometry while a cached Flower page is hidden and restored', async () => {
  const host = await mount();
  const surface = host.querySelector<HTMLElement>('.flower-surface')!;
  const transcript = host.querySelector<HTMLElement>('.flower-chat-transcript')!;
  const composer = host.querySelector<HTMLElement>('.flower-composer')!;
  transcript.style.overflowY = 'scroll';
  await frame(); await frame(); await frame();
  const gutter = transcript.offsetWidth - transcript.clientWidth;
  expect(gutter).toBeGreaterThan(0);
  const before = composer.getBoundingClientRect();
  const inlineControls = () => [...host.querySelectorAll('[data-flower-composer-inline-item]')].map(node => node.getAttribute('data-flower-composer-inline-item'));
  const beforeControls = inlineControls();
  expect(beforeControls.length).toBeGreaterThan(0);
  for (let cycle = 0; cycle < 3; cycle++) {
    host.style.display = 'none';
    await frame(); await frame(); await frame();
    expect(surface.style.getPropertyValue('--flower-transcript-gutter')).toBe(`${gutter}px`);
    expect(inlineControls()).toEqual(beforeControls);
    host.style.display = '';
    for (let sample = 0; sample < 8; sample++) {
      const rect = composer.getBoundingClientRect();
      expect(rect.x).toBeCloseTo(before.x, 1);
      expect(rect.width).toBeCloseTo(before.width, 1);
      await frame();
    }
  }
});

it('uses the published floating material and retains a noninteractive model menu during exit', async () => {
  const host = await mount();
  const trigger = host.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger')!;
  await userEvent.click(trigger);
  await waitFor(() => Boolean(document.querySelector('.flower-model-menu')));
  const menu = document.querySelector<HTMLElement>('.flower-model-menu')!;
  expect(menu.dataset.floeSurface).toBe('floating');
  await waitFor(() => menu.dataset.floatingPresence === 'open');
  await Promise.all(menu.getAnimations().map(animation => animation.finished));
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(menu.isConnected).toBe(true);
  expect(menu.inert).toBe(true);
  expect(menu.getAttribute('aria-hidden')).toBe('true');
  await waitFor(() => !menu.isConnected);
  expect(document.activeElement).toBe(trigger);
});


it.each(['paper', 'porcelain-dark'])('keeps the composer quiet, stable and readable in %s', async theme => {
  const preset = builtInShellThemePresets.find(value => value.name === theme)!;
  const root = document.documentElement;
  root.classList.add(preset.mode === 'dark' ? 'dark' : 'light');
  root.dataset.floeShellTheme = theme;
  for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) if (value) root.style.setProperty(name, value);
  const host = await mount();
  const composer = host.querySelector<HTMLElement>('.flower-composer')!;
  const editor = composer.querySelector<HTMLTextAreaElement>('textarea')!;
  const before = composer.getBoundingClientRect();
  expectSingleInputFocus(editor);
  await userEvent.fill(editor, 'Design a focused workspace. 保留输入与选择。');
  expect(composer.getBoundingClientRect().x).toBe(before.x);
  expect(composer.getBoundingClientRect().width).toBe(before.width);
  expect(Number.parseFloat(getComputedStyle(composer).borderRadius)).toBeGreaterThanOrEqual(16);
  expect(['none', 'rgba(0, 0, 0, 0) 0px 0px 0px 0px']).toContain(getComputedStyle(composer).boxShadow);
  await page.screenshot({ element: composer, path: '__screenshots__/flower-composer-polish-' + theme + '.png' });
  await page.viewport(390, 850);
  await frame(); await frame(); await frame();
  expect(host.querySelector('.flower-composer textarea')).toBe(editor);
  expect(editor.value).toContain('保留输入与选择');
  expect(composer.getBoundingClientRect().right).toBeLessThanOrEqual(390);
  await page.screenshot({ element: composer, path: '__screenshots__/flower-composer-polish-' + theme + '-390.png' });
  await media.emulateMediaPreferences({ forcedColors: 'active' });
  expectSingleInputFocus(editor);
});

it('reverses a closing menu without remounting or losing its search', async () => {
  const host = await mount();
  const trigger = host.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger')!;
  await userEvent.click(trigger);
  await waitFor(() => document.querySelector<HTMLElement>('.flower-model-menu')?.dataset.floatingPresence === 'open');
  const menu = document.querySelector<HTMLElement>('.flower-model-menu')!;
  await Promise.all(menu.getAnimations().map(animation => animation.finished));
  const search = menu.querySelector<HTMLInputElement>('input')!;
  await userEvent.fill(search, 'GPT');
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(menu.inert).toBe(true);
  trigger.click();
  expect(document.querySelector('.flower-model-menu')).toBe(menu);
  expect(menu.inert).toBe(false);
  await waitFor(() => document.activeElement === search);
  expect(menu.dataset.floatingPresence).toBe('open');
  expect(search.value).toBe('GPT');
  await Promise.all(menu.getAnimations().map(animation => animation.finished));
  expect(getComputedStyle(menu).opacity).toBe('1');
});

it('keeps nested permission focus and exits immediate with reduced motion', async () => {
  await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  const host = await mount(390);
  const more = host.querySelector<HTMLButtonElement>('.flower-composer-more-button')!;
  await userEvent.click(more);
  await waitFor(() => Boolean(document.querySelector('.flower-composer-more-panel:not([inert])')));
  const trigger = document.querySelector<HTMLButtonElement>('.flower-composer-more-panel .flower-permission-trigger')!;
  await userEvent.click(trigger);
  await waitFor(() => document.querySelector<HTMLElement>('.flower-permission-menu')?.contains(document.activeElement) === true);
  const menu = document.querySelector<HTMLElement>('.flower-permission-menu')!;
  expect(menu.dataset.floeSurface).toBe('floating');
  expect(new DOMMatrixReadOnly(getComputedStyle(menu).transform).isIdentity).toBe(true);
  expect(menu.getAnimations()).toHaveLength(0);
  const bounds = menu.getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(390);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => !menu.isConnected);
  expect(document.activeElement).toBe(trigger);
  expect(document.querySelector('.flower-composer-more-panel:not([inert])')).not.toBeNull();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => !document.querySelector('.flower-composer-more-panel'));
  await waitFor(() => document.activeElement === more);
});

it('gives the companion thread switcher the shared material and retained exit', async () => {
  await page.viewport(1280, 850);
  document.documentElement.dataset.floeSurfaceStyle = 'soft-neumorphic';
  const host = renderSurfaceWithAdapterProps(adapter(), { presentation: 'companion', companionOpen: true, engaged: true,
    companionCopy: { label: 'Switch conversation', searchPlaceholder: 'Search conversations', newConversation: 'New conversation',
      empty: 'No conversations', queued: 'Queued', threadList: DEFAULT_FLOWER_SURFACE_COPY.threadList } });
  host.style.cssText = 'width:544px;height:700px';
  await waitFor(() => Boolean(host.querySelector('.flower-companion-thread-trigger')));
  const trigger = host.querySelector<HTMLButtonElement>('.flower-companion-thread-trigger')!;
  await userEvent.click(trigger);
  await waitFor(() => Boolean(host.querySelector('[data-flower-thread-switcher]')));
  const menu = host.querySelector<HTMLElement>('[data-flower-thread-switcher]')!;
  const panel = menu.parentElement!;
  expect(menu.dataset.floeSurface).toBe('floating');
  await waitFor(() => menu.contains(document.activeElement));
  await Promise.all(panel.getAnimations().map(animation => animation.finished));
  menu.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
  expect(panel.inert).toBe(true);
  await waitFor(() => !panel.isConnected);
  expect(document.activeElement).toBe(trigger);
});


it('retains an open model search when controls move between inline and More', async () => {
  const host = await mount();
  await userEvent.click(host.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger')!);
  await waitFor(() => Boolean(document.querySelector('.flower-model-menu input')));
  const menu = document.querySelector<HTMLElement>('.flower-model-menu')!;
  const search = menu.querySelector<HTMLInputElement>('input')!;
  await userEvent.fill(search, 'GPT');
  for (const width of [320, 1200, 390]) {
    await page.viewport(width, 850);
    await frame(); await frame(); await frame();
    await waitFor(() => menu.contains(document.activeElement));
    expect(document.querySelector('.flower-model-menu')).toBe(menu);
    expect(search.value).toBe('GPT');
    await Promise.all(menu.getAnimations().map(animation => animation.finished));
    const bounds = menu.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
  }
});
