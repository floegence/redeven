import { toRenderVersion } from '../../../../tessiven_ui/src/presentation';
import '../index.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { render } from 'solid-js/web';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { TessivenGraph } from '../../../../tessiven_ui/src/TessivenGraph';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import { sharedHostsVersion } from './tessiven-shared-hosts.fixture';

const media = commands as unknown as { emulateMediaPreferences: (value: { forcedColors: 'active' | 'none' }) => Promise<void> };
let host: HTMLDivElement;
let dispose: (() => void) | undefined;
const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
afterEach(async () => {
  dispose?.(); host?.remove();
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  await media.emulateMediaPreferences({ forcedColors: 'none' });
});

it('keeps canvas controls compact and usable in every theme, small surfaces and projected menus', async () => {
  await page.viewport(1380, 860);
  host = document.createElement('div');
  host.className = 'tessiven';
  host.style.cssText = 'width:1200px;height:720px;position:relative';
  host.setAttribute('data-floe-dialog-surface-host', 'true');
  document.body.append(host);
  dispose = render(() => <TessivenGraph version={toRenderVersion(sharedHostsVersion('mixed'))} historical={false}
    t={tessivenText('zh-CN')} onAsk={() => {}} onInspect={() => {}} />, host);
  await expect.poll(() => host.querySelectorAll('.tessiven-node').length, { timeout: 20000 }).toBeGreaterThan(0);
  await expect.poll(() => host.querySelector('[aria-label="正在整理画布"]'), { timeout: 20000 }).toBeNull();
  const tools = host.querySelector<HTMLElement>('.tessiven-canvas-tools')!;
  const overview = host.querySelector<SVGSVGElement>('.floe-graph__minimap')!;
  for (const preset of builtInShellThemePresets) {
    document.documentElement.removeAttribute('style');
    document.documentElement.classList.toggle('dark', preset.mode === 'dark');
    document.documentElement.dataset.theme = preset.mode;
    for (const [key, value] of Object.entries(preset.semanticTokens ?? {})) if (value) document.documentElement.style.setProperty(key, value);
    for (const [width, height] of [[1200, 720], [390, 360], [320, 240]]) {
      host.style.width = `${width}px`; host.style.height = `${height}px`;
      await frames();
      const rect = tools.getBoundingClientRect(), parent = host.getBoundingClientRect(), minimap = overview.getBoundingClientRect();
      expect(rect.width).toBeLessThan(290);
      expect(rect.height).toBeLessThan(42);
      expect(rect.left).toBeGreaterThanOrEqual(parent.left);
      expect(rect.right).toBeLessThanOrEqual(parent.right);
      expect(rect.bottom).toBeLessThanOrEqual(parent.bottom);
      expect(rect.right <= minimap.left || rect.top >= minimap.bottom).toBe(true);
      for (const button of tools.querySelectorAll<HTMLElement>('button:not(:disabled), [role="button"]')) {
        expect(getComputedStyle(button).cursor).toBe('pointer');
        expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth);
      }
      await page.screenshot({ element: host, path: `../../.vitest-attachments/canvas-controls-${preset.name}-${width}.png` });
    }
  }
  host.style.cssText = 'width:650px;height:440px;position:relative;transform:translate(40px,20px) scale(.85);transform-origin:top left';
  await frames();
  const trigger = page.getByRole('button', { name: '视图', exact: true });
  await trigger.click();
  const menu = host.querySelector<HTMLElement>('[role="menu"]')!;
  expect(menu).not.toBeNull();
  expect(menu.getAttribute('data-floe-local-interaction-surface')).toBe('true');
  expect(menu.style.position).not.toBe('fixed');
  const bounds = host.getBoundingClientRect(), rect = menu.getBoundingClientRect();
  expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
  expect(rect.right).toBeLessThanOrEqual(bounds.right);
  expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
  await page.screenshot({ element: host, path: '../../.vitest-attachments/canvas-controls-projected-menu.png' });
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.activeElement === trigger.element()).toBe(true);
  const output = tools.querySelector('output')!;
  const before = output.textContent;
  await page.getByRole('button', { name: '放大', exact: true }).click();
  expect(output.textContent).not.toBe(before);
  await page.getByRole('button', { name: '缩小', exact: true }).click();
  expect(output.textContent).toBe(before);
  await media.emulateMediaPreferences({ forcedColors: 'active' });
  await frames();
  expect(getComputedStyle(tools).borderTopStyle).toBe('solid');
  await page.screenshot({ element: host, path: '../../.vitest-attachments/canvas-controls-forced-colors.png' });
});

it.each([{ refs: [], mode: 'display' as const }, { refs: ['exact-queue'], mode: 'display' as const }, { refs: ['exact-queue'], mode: 'source' as const }])('keeps generic selection compact and limits Flower references: %j', async ({ refs, mode }) => {
  await page.viewport(720, 640);
  const version = toRenderVersion(sharedHostsVersion());
  version.view.model = { metadata: { title: 'Queue canvas' }, objects: [{ id: 'queue', name: 'Work queue', kind: 'Queue', description: 'Background jobs', facts: [{ label: 'Region', value: 'Local' }], objectRefs: refs }] };
  host = document.createElement('div');
  host.className = 'tessiven';
  host.style.cssText = 'width:680px;height:580px;position:relative';
  document.body.append(host);
  const selection = vi.fn(), ask = vi.fn();
  dispose = render(() => <TessivenGraph version={version} historical={false} t={tessivenText('en-US')}
    onAsk={ask} onInspect={() => {}} onSelectionChange={selection} askReferenceMode={mode} />, host);
  await expect.poll(() => host.querySelectorAll('.tessiven-generic-object').length).toBe(1);
  await expect.poll(() => host.querySelector('[aria-label="Arranging canvas"]')).toBeNull();
  const card = host.querySelector<HTMLElement>('.tessiven-generic-object')!;
  expect(card.textContent).toContain('Work queue');
  expect(card.textContent).toContain('Region');
  expect(card.textContent).toContain('Local');
  await userEvent.click(card.querySelector('strong')!);
  expect(selection).toHaveBeenLastCalledWith({ canvas_id: version.canvas_id, version_id: version.number, object_refs: ['queue'] });
  expect(host.querySelector('.tessiven-popup')).toBeNull();
  expect(ask).not.toHaveBeenCalled();
  await userEvent.click(card.querySelector('button')!);
  if (refs.length) expect(ask).toHaveBeenLastCalledWith({ canvas_id: version.canvas_id, version_id: version.number, object_refs: mode === 'display' ? ['queue'] : refs });
  else expect(ask).not.toHaveBeenCalled();
  await page.screenshot({ element: host, path: `../../.vitest-attachments/presentation-generic-${refs.length ? 'mapped' : 'readonly'}.png` });
});
