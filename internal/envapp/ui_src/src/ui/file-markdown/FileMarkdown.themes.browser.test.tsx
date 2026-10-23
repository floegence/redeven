import '../../index.css';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { FloeConfigProvider, LayoutProvider, ThemeProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { FileMarkdown } from './FileMarkdown';
import { FilePreviewContext } from '../widgets/FilePreviewContext';
import { FilePreviewSurface } from '../widgets/FilePreviewSurface';
import { createFilePreviewController } from '../widgets/createFilePreviewController';
import { floatingWindowStorageKey } from '../widgets/PersistentFloatingWindow';
import { removeUIStorageItem, writeUIStorageJSON } from '../services/uiStorage';

let dispose: (() => void) | undefined;
const media = commands as unknown as {
  emulateMediaPreferences: (preferences: { forcedColors: 'active' | 'none' }) => Promise<void>;
};
afterEach(async () => {
  await media.emulateMediaPreferences({ forcedColors: 'none' });
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
  window.getSelection()?.removeAllRanges();
  removeUIStorageItem(floatingWindowStorageKey('file-preview'));
});

const tick = String.fromCharCode(96);
const content = [
  '---\ntitle: Release guide\ntags: [preview, themes]\nversion: 2\nready: true\n---',
  '# Redeven Plugin Market',
  'A **public plugin catalog** with *theme-aware reading*. Review the [release guide](https://example.com/guide) and ' + tick + 'plugin.json' + tick + ' before publishing.',
  '## Development',
  '> Keep the original document, readable colors, and a clear visual hierarchy.',
  '### Local workflow',
  '- Install dependencies with ' + tick + 'npm ci' + tick + '.\n- Run the checks before publishing.',
  tick.repeat(3) + 'shell\nnpm ci\nnpm run check\nnpm test\n' + tick.repeat(3),
  '| Element | Purpose |\n| --- | --- |\n| Catalog | Public discovery |\n| Manifest | Verified metadata |',
  ...['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].map(type => '> [!' + type + ']\n> Read the **release details** and [documentation](https://example.com/guide).'),
  '#### Packaging', '##### Verification', '###### Further reading',
].join('\n\n');

function applyTheme(name: string, material = 'soft-neumorphic') {
  const preset = builtInShellThemePresets.find(theme => theme.name === name)!;
  document.documentElement.classList.toggle('dark', preset.mode === 'dark');
  document.documentElement.classList.toggle('light', preset.mode === 'light');
  document.documentElement.dataset.floeShellTheme = preset.name;
  document.documentElement.dataset.floeSurfaceStyle = material;
}

async function mount() {
  const host = document.createElement('div');
  Object.assign(host.style, { width: '100%', height: '760px' });
  document.body.append(host);
  dispose = render(() => <FileMarkdown content={content} showToc={false} filePath="/workspace/README.md" />, host);
  await vi.waitFor(() => expect(host.querySelector('pre.fm-code-block-shiki')).toBeTruthy());
  return host;
}

function colors() {
  const context = document.createElement('canvas').getContext('2d')!;
  const rgb = (value: string) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const luminance = (value: string) => rgb(value).map(channel => {
    const n = channel / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  const distance = (a: string, b: string) => Math.hypot(...rgb(a).map((channel, index) => channel - rgb(b)[index]));
  return { rgb, contrast, distance };
}

it.each(['standard', 'soft-neumorphic'])('distinguishes document roles accessibly in every shell theme with %s material', async material => {
  await page.viewport(1000, 820);
  const host = await mount();
  const body = host.querySelector<HTMLElement>('.file-markdown-body')!;
  const { rgb, contrast, distance } = colors();
  // Measure each resolved palette without sampling the previous theme mid-transition.
  body.querySelectorAll<HTMLElement>('a.fm-link').forEach(link => { link.style.transition = 'none'; });
  for (const preset of builtInShellThemePresets) {
    applyTheme(preset.name, material);
    const background = getComputedStyle(body).backgroundColor;
    const bodyColor = getComputedStyle(body).color;
    for (const selector of ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p strong', 'p em', 'a.fm-link', '.fm-frontmatter-value']) {
      const style = getComputedStyle(body.querySelector(selector)!);
      expect.soft(contrast(style.color, background), preset.name + '/' + material + ': ' + selector + ' contrast').toBeGreaterThanOrEqual(4.5);
    }
    for (const selector of ['h2', 'code.fm-inline-code']) {
      const color = getComputedStyle(body.querySelector(selector)!).color;
      const channels = rgb(color);
      expect.soft(Math.max(...channels) - Math.min(...channels), preset.name + ': ' + selector + ' chroma').toBeGreaterThan(20);
      expect.soft(distance(color, bodyColor), preset.name + ': ' + selector + ' distinction').toBeGreaterThan(25);
    }
    for (const selector of ['code.fm-inline-code', 'blockquote.fm-blockquote', 'table th', '.fm-frontmatter-key', '.fm-frontmatter-tag', '.fm-alert']) {
      for (const node of body.querySelectorAll(selector)) {
        const style = getComputedStyle(node);
        expect.soft(contrast(style.color, style.backgroundColor), preset.name + ': ' + selector + ' inset contrast').toBeGreaterThanOrEqual(4.5);
        expect.soft(distance(style.backgroundColor, background), preset.name + ': ' + selector + ' inset').toBeGreaterThan(3);
        if (node.matches('.fm-alert')) {
          for (const child of node.querySelectorAll('.fm-alert-heading, strong, a.fm-link')) {
            expect.soft(contrast(getComputedStyle(child).color, style.backgroundColor), preset.name + ': ' + node.className + ' ' + child.tagName).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
    expect.soft(new Set([...body.querySelectorAll('.fm-alert')].map(node => getComputedStyle(node).borderLeftColor)).size, preset.name + ': alert semantics').toBe(5);
    if (material === 'soft-neumorphic') {
      await page.screenshot({ element: host, path: '__screenshots__/file-markdown-' + preset.name + '.png' });
    }
  }
}, 60_000);

it('preserves reading state and keyboard links across live palette changes and reading modes', async () => {
  await page.viewport(900, 820);
  applyTheme('paper');
  const host = await mount();
  const body = host.querySelector<HTMLElement>('.file-markdown-body')!;
  const link = body.querySelector<HTMLAnchorElement>('a.fm-link')!;
  const code = body.querySelector<HTMLElement>('code.fm-inline-code')!;
  const scroller = body;
  const heading = body.querySelector('h2')!;
  const originalColor = getComputedStyle(heading).color;
  await userEvent.keyboard('{Tab}');
  link.focus();
  const selection = document.createRange();
  selection.selectNodeContents(code);
  window.getSelection()!.addRange(selection);
  scroller.scrollTop = 110;
  expect(scroller.scrollTop).toBeGreaterThan(0);
  const before = { html: body.innerHTML, width: body.clientWidth, height: body.clientHeight, scrollTop: scroller.scrollTop };
  applyTheme('dracula');
  expect(getComputedStyle(heading).color).not.toBe(originalColor);
  expect(body.querySelector('h2')).toBe(heading);
  expect(body.innerHTML).toBe(before.html);
  expect(body.clientWidth).toBe(before.width);
  expect(body.clientHeight).toBe(before.height);
  expect(scroller.scrollTop).toBe(before.scrollTop);
  expect(document.activeElement).toBe(link);
  expect(window.getSelection()!.toString()).toBe(code.textContent);
  expect(getComputedStyle(link).outlineStyle).toBe('solid');
  const { contrast } = colors();
  const selected = getComputedStyle(code, '::selection');
  expect(contrast(selected.color, selected.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  await userEvent.click(host.querySelector<HTMLButtonElement>('button[title="Reading mode"]')!);
  expect(body.classList.contains('file-markdown-reading')).toBe(false);
  expect(getComputedStyle(heading).color).not.toBe(getComputedStyle(body).color);
});

it.each(builtInShellThemePresets)('keeps the actual floating preview readable in $name', async preset => {
  await page.viewport(1280, 1040);
  writeUIStorageJSON(floatingWindowStorageKey('file-preview'), { x: 40, y: 40, width: 1000, height: 940 });
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => {
    const controller = createFilePreviewController({ client: () => undefined, rpc: () => undefined, canWrite: () => true });
    return <FloeConfigProvider config={{ theme: {
      storageKey: 'markdown-colors-' + preset.name, defaultTheme: preset.mode === 'dark' ? 'dark' : 'light', defaultSurfaceStyle: 'soft-neumorphic',
      shellPresets: builtInShellThemePresets, defaultShellPreset: { light: preset.mode === 'light' ? preset.name : 'paper', dark: preset.mode === 'dark' ? preset.name : 'classic-dark' },
    } }}><ThemeProvider><LayoutProvider>
      <FilePreviewContext.Provider value={{ controller, openPreview: controller.openPreview, closePreview: controller.closePreview }}>
        <FilePreviewSurface open onOpenChange={() => undefined} item={{ id: '/workspace/README.md', path: '/workspace/README.md', name: 'README.md', type: 'file' }} descriptor={{ mode: 'markdown' }} text={content} />
      </FilePreviewContext.Provider>
    </LayoutProvider></ThemeProvider></FloeConfigProvider>;
  }, host);
  await vi.waitFor(() => expect(document.querySelector('pre.fm-code-block-shiki')).toBeTruthy());
  const body = document.querySelector<HTMLElement>('.file-markdown-body')!;
  const background = getComputedStyle(body).backgroundColor;
  const { contrast } = colors();
  for (const selector of ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p strong', 'p em', 'a.fm-link', '.fm-frontmatter-value']) {
    expect.soft(contrast(getComputedStyle(body.querySelector(selector)!).color, background), preset.name + ': floating ' + selector).toBeGreaterThanOrEqual(4.5);
  }
  for (const selector of ['code.fm-inline-code', 'blockquote.fm-blockquote', 'table th', '.fm-frontmatter-key', '.fm-frontmatter-tag', '.fm-alert']) {
    for (const node of body.querySelectorAll(selector)) {
      const style = getComputedStyle(node);
      expect.soft(contrast(style.color, style.backgroundColor), preset.name + ': floating ' + selector).toBeGreaterThanOrEqual(4.5);
      for (const child of node.querySelectorAll('.fm-alert-heading, strong, a.fm-link')) {
        expect.soft(contrast(getComputedStyle(child).color, style.backgroundColor), preset.name + ': floating inset ' + child.tagName).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
  const window = document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]')!;
  await vi.waitFor(() => expect(getComputedStyle(window).opacity).toBe('1'));
  const surface = window.querySelector<HTMLElement>('[data-floe-floating-window-surface="true"]')!;
  await vi.waitFor(() => expect(getComputedStyle(surface).opacity).toBe('1'));
  await page.screenshot({ element: window, path: '__screenshots__/file-markdown-window-' + preset.name + '.png' });
  if (['classic-dark', 'paper', 'nord', 'hc-light'].includes(preset.name)) {
    body.scrollTop = body.scrollHeight;
    await page.screenshot({ element: window, path: '__screenshots__/file-markdown-alerts-' + preset.name + '.png' });
  }
});

it('retains document boundaries and keyboard focus in forced colors', async () => {
  await media.emulateMediaPreferences({ forcedColors: 'active' });
  const host = await mount();
  const link = host.querySelector<HTMLAnchorElement>('a.fm-link')!;
  await userEvent.keyboard('{Tab}');
  link.focus();
  expect(getComputedStyle(link).outlineStyle).toBe('solid');
  expect(getComputedStyle(link).textDecorationLine).toContain('underline');
  for (const selector of ['.fm-inline-code', '.fm-table-wrap', '.fm-blockquote', '.fm-alert', '.fm-code-block']) {
    expect(getComputedStyle(host.querySelector(selector)!).borderLeftStyle).toBe('solid');
  }
});
