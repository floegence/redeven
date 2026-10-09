import '../index.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { For, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { commands, page } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { TessivenIcon } from '../../../../tessiven_ui/src/TessivenIcon';
import { TessivenGraph } from '../../../../tessiven_ui/src/TessivenGraph';
import { TessivenLibraryCard } from '../../../../tessiven_ui/src/TessivenLibraryCard';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import type { Canvas, TessivenTransport, Version } from '../../../../tessiven_ui/src/types';
import schema from '../../../../../spec/tessiven/v1.schema.json';

const serviceKinds = schema.$defs.service.properties.kind.enum;
const kinds = [...new Set([...serviceKinds, ...schema.$defs.resource.properties.kind.enum])];
const catalogs = import.meta.glob('../../../../tessiven_ui/src/locales/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, string>>;
const t = tessivenText('en-US');
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
function mount(style: string) {
  host = document.createElement('div'); host.className = 'tessiven'; host.style.cssText = style;
  document.body.append(host);
}
function theme(preset: (typeof builtInShellThemePresets)[number], attributeOnly = false) {
  const root = document.documentElement;
  root.removeAttribute('style');
  root.classList.toggle('dark', !attributeOnly && preset.mode === 'dark');
  root.dataset.theme = preset.mode;
  for (const [key, value] of Object.entries(preset.semanticTokens ?? {})) if (value) root.style.setProperty(key, value);
}
function luminance(color: string) {
  const context = document.createElement('canvas').getContext('2d')!;
  context.fillStyle = color; context.fillRect(0, 0, 1, 1);
  const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1] + 0.05) / (values[0] + 0.05);
}
function signature(icon: Element) { return icon.innerHTML; }

it('gives every schema kind a distinct, unframed silhouette in every theme and high contrast', async () => {
  await page.viewport(1120, 800);
  mount('width:1040px;height:auto;padding:28px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px;');
  dispose = render(() => <For each={kinds}>{kind => <div class="tessiven-service" data-kind={kind}>
    <TessivenIcon kind={kind} /><span><strong>{t(`kind.${kind}`)}</strong><small>{kind}</small></span>
  </div>}</For>, host);
  const icons = [...host.querySelectorAll<SVGSVGElement>('.tessiven-icon')];
  expect(icons).toHaveLength(kinds.length);
  expect(new Set(icons.map(signature)).size).toBe(kinds.length);
  for (const preset of builtInShellThemePresets) {
    theme(preset); await frames();
    for (const icon of icons) {
      const style = getComputedStyle(icon);
      expect(style.borderTopWidth).toBe('0px');
      expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      const foreground = getComputedStyle(icon.querySelector('.glyph-main')!).fill;
      const background = getComputedStyle(icon.parentElement!).backgroundColor;
      expect(contrast(foreground, background), `${preset.name}: ${icon.dataset.kind}`).toBeGreaterThanOrEqual(3);
    }
    await page.screenshot({ element: host, path: `../../.vitest-attachments/service-icons-${preset.name}.png` });
  }
  // The attribute-based theme owner must get the same readable dark palette.
  const dark = builtInShellThemePresets.find(preset => preset.mode === 'dark')!;
  theme(dark); await frames();
  const darkFill = getComputedStyle(icons[0].querySelector('.glyph-main')!).fill;
  theme(dark, true); await frames();
  expect(getComputedStyle(icons[0].querySelector('.glyph-main')!).fill).toBe(darkFill);
  await media.emulateMediaPreferences({ forcedColors: 'active' }); await frames();
  for (const icon of icons) {
    const ink = getComputedStyle(icon.querySelector('.glyph-main')!).fill;
    for (const cut of icon.querySelectorAll('.glyph-cut, .glyph-cut-line')) {
      const style = getComputedStyle(cut);
      expect(contrast(ink, cut.classList.contains('glyph-cut-line') ? style.stroke : style.fill)).toBeGreaterThanOrEqual(3);
    }
  }
  await page.screenshot({ element: host, path: '../../.vitest-attachments/service-icons-high-contrast.png' });
});

it('keeps each kind localized in all shipped catalogs', () => {
  expect(Object.keys(catalogs)).toHaveLength(10);
  for (const [locale, catalog] of Object.entries(catalogs)) {
    expect(Object.keys(catalog).sort(), locale).toEqual(Object.keys(catalogs['../../../../tessiven_ui/src/locales/en-US.json']).sort());
    for (const kind of kinds) expect(catalog[`kind.${kind}`], `${locale}: ${kind}`).toBeTruthy();
  }
});

it('changes the glyph when the saved responsibility changes', async () => {
  mount('width:100px;height:100px');
  const [kind, setKind] = createSignal('service');
  dispose = render(() => <TessivenIcon kind={kind()} />, host);
  const original = signature(host.querySelector('svg')!);
  setKind('scheduler'); await frames();
  expect(host.querySelector('svg')!.dataset.kind).toBe('scheduler');
  expect(signature(host.querySelector('svg')!)).not.toBe(original);
  setKind('service'); await frames();
  expect(signature(host.querySelector('svg')!)).toBe(original);
});

it('uses the same responsibility icons in real host inventories and saved library previews', async () => {
  await page.viewport(1400, 1040);
  const nodes = Array.from({ length: Math.ceil(serviceKinds.length / 4) }, (_, index) => ({
    id: `node-${index}`, name: `Platform host ${index + 1}`, runtimeRef: 'demo:platform',
  }));
  const version: Version = {
    canvas_id: 'icons', number: 1, document_yaml: '', digest: 'fixture', created_at: 1, source: 'flower', summary: '',
    document: {
      apiVersion: 'redeven.io/tessiven/v1', kind: 'ServiceCanvas', metadata: { title: 'Platform services' }, nodes,
      services: serviceKinds.map(kind => ({ id: kind, kind, name: t(`kind.${kind}`) })),
      instances: serviceKinds.map((kind, index) => ({ id: `instance-${kind}`, serviceRef: kind, nodeRef: nodes[Math.floor(index / 4)].id, role: 'standalone' })),
      groups: [{ id: 'platform', name: 'Platform services', nodeRefs: nodes.map(node => node.id) }],
      presentation: { initiallyExpanded: ['platform'] },
    },
  };
  const canvas: Canvas = { id: 'icons', title: 'Platform services', description: '', latest_version: 1, archived: false, created_at: 1, updated_at: 1 };
  mount('width:1320px;height:950px;position:relative');
  dispose = render(() => <>
    <div style="height:740px;position:relative"><TessivenGraph version={version} historical={false} t={t} onAsk={vi.fn()} onInspect={vi.fn()} /></div>
    <div style="width:340px;height:210px"><TessivenLibraryCard canvas={canvas} t={t} onOpen={vi.fn()} transport={{ request: vi.fn(async () => version) } as unknown as TessivenTransport} /></div>
  </>, host);
  await expect.poll(() => host.querySelectorAll('.tessiven-service').length).toBe(serviceKinds.length);
  await expect.poll(() => host.querySelectorAll('.tessiven-thumbnail-service').length).toBe(serviceKinds.length);
  for (const kind of serviceKinds) {
    const graph = host.querySelector(`.tessiven-service .tessiven-icon[data-kind="${kind}"]`)!;
    const preview = host.querySelector(`.tessiven-thumbnail-service .tessiven-icon[data-kind="${kind}"]`)!;
    expect(signature(preview), kind).toBe(signature(graph));
  }
  for (const preset of builtInShellThemePresets) {
    theme(preset); await frames();
    for (const row of host.querySelectorAll('.tessiven-service')) {
      expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(row.closest('.tessiven-node')!.getBoundingClientRect().bottom);
    }
    await page.screenshot({ element: host, path: `../../.vitest-attachments/service-icons-canvas-${preset.name}.png` });
  }
});
