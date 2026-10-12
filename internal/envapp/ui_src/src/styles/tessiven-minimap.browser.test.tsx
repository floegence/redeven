import { toRenderVersion } from '../../../../tessiven_ui/src/presentation';
import '../index.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { render } from 'solid-js/web';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, expect, it } from 'vitest';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { TessivenGraph } from '../../../../tessiven_ui/src/TessivenGraph';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import { sharedHostsVersion } from './tessiven-shared-hosts.fixture';

const media = commands as unknown as { emulateMediaPreferences: (value: { forcedColors: 'active' | 'none' }) => Promise<void> };
let host: HTMLDivElement;
let dispose: (() => void) | undefined;
afterEach(async () => {
  dispose?.(); host?.remove();
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  await media.emulateMediaPreferences({ forcedColors: 'none' });
});
const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const painted = (color: string) => {
  const context = document.createElement('canvas').getContext('2d')!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
};

it('matches main canvas colors in every theme with bounded paths and visible-only geometry', async () => {
  await page.viewport(1380, 860);
  const version = sharedHostsVersion('mixed');
  version.document.resources = [
    { id: 'network', name: 'External gateway', kind: 'load_balancer', endpoint: 'https://example.test' },
    { id: 'storage', name: 'Object storage', kind: 'object_store', endpoint: 's3://example' },
  ];
  host = document.createElement('div');
  host.className = 'tessiven';
  host.style.cssText = 'width:1320px;height:790px;position:relative';
  document.body.append(host);
  dispose = render(() => <TessivenGraph version={toRenderVersion(version)} historical={false} t={tessivenText('en-US')} onAsk={() => {}} onInspect={() => {}} />, host);
  await expect.poll(() => host.querySelectorAll('.tessiven-group').length, { timeout: 20000 }).toBe(5);
  await expect.poll(() => host.querySelector('[aria-label="Arranging canvas"]'), { timeout: 20000 }).toBeNull();
  const minimap = host.querySelector<SVGSVGElement>('.floe-graph__minimap')!;
  expect(getComputedStyle(minimap.querySelector('.floe-graph__minimap-viewport')!).fill).toBe('rgba(0, 0, 0, 0)');
  for (const preset of builtInShellThemePresets) {
    document.documentElement.removeAttribute('style');
    document.documentElement.classList.toggle('dark', preset.mode === 'dark');
    document.documentElement.dataset.theme = preset.mode;
    for (const [key, value] of Object.entries(preset.semanticTokens ?? {})) if (value) document.documentElement.style.setProperty(key, value);
    await frames();
    const groups = [...minimap.querySelectorAll('.floe-graph__minimap-groups')];
    expect(groups).toHaveLength(4);
    expect(new Set(groups.map(group => getComputedStyle(group).fill)).size).toBe(4);
    for (let tone = 0; tone < groups.length; tone++) {
      const card = host.querySelector(`.tessiven-group[data-tone="${tone}"]`)!;
      expect(painted(getComputedStyle(groups[tone]).fill), preset.name).toEqual(painted(getComputedStyle(card).backgroundColor));
      expect(painted(getComputedStyle(groups[tone]).stroke), preset.name).toEqual(painted(getComputedStyle(card).borderTopColor));
    }
    const nodes = [...minimap.querySelectorAll('.floe-graph__minimap-nodes')];
    expect(nodes).toHaveLength(3);
    await expect.poll(() => painted(getComputedStyle(host.querySelector('.tessiven-node')!).backgroundColor))
      .toEqual(painted(getComputedStyle(nodes[0]).fill));
    for (const [index, kind] of ['network', 'storage'].entries()) {
      const card = host.querySelector(`.tessiven-resource[data-resource="${kind}"]`)!;
      expect(painted(getComputedStyle(nodes[index + 1]).fill)).toEqual(painted(getComputedStyle(card.querySelector('footer')!).backgroundColor));
    }
    expect(minimap.querySelectorAll('path')).toHaveLength(8);
    await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
    await page.screenshot({ element: host, path: `../../.vitest-attachments/minimap-${preset.name}.png` });
  }
  // Native hosts may use only the root theme attribute.
  document.documentElement.classList.add('dark');
  document.documentElement.dataset.theme = 'dark';
  const darkFill = getComputedStyle(minimap.querySelectorAll('.floe-graph__minimap-groups')[1]).fill;
  document.documentElement.classList.remove('dark');
  document.documentElement.dataset.theme = 'dark';
  expect(getComputedStyle(minimap.querySelectorAll('.floe-graph__minimap-groups')[1]).fill).toBe(darkFill);
  const viewport = minimap.querySelector('.floe-graph__minimap-viewport')!;
  const before = viewport.getAttribute('x');
  minimap.focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(viewport.getAttribute('x')).not.toBe(before);
  await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Collapse all', exact: true }).click();
  await expect.poll(() => host.querySelectorAll('.tessiven-node').length, { timeout: 20000 }).toBe(1);
  await expect.poll(() => host.querySelector('[aria-label="Arranging canvas"]'), { timeout: 20000 }).toBeNull();
  expect(minimap.querySelectorAll('.floe-graph__minimap-groups')).toHaveLength(0);
  expect([...minimap.querySelectorAll('.floe-graph__minimap-nodes')].reduce((sum, path) => sum + (path.getAttribute('d')!.match(/M/g)?.length ?? 0), 0)).toBe(8);
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await media.emulateMediaPreferences({ forcedColors: 'active' });
  await frames();
  for (const node of minimap.querySelectorAll('.floe-graph__minimap-nodes')) {
    expect(painted(getComputedStyle(node).fill)).toEqual(painted(getComputedStyle(host).color));
    expect(getComputedStyle(node).opacity).toBe('1');
  }
  await page.screenshot({ element: host, path: '../../.vitest-attachments/minimap-high-contrast.png' });
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0);
});
