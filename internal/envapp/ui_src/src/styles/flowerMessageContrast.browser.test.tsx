import '../index.css';
import '../ui/flower-feature.css';

import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { render } from 'solid-js/web';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, expect, it } from 'vitest';
import { FlowerMarkdownBlock } from '../../../../flower_ui/src/chat/markdown/FlowerMarkdownBlock';
import { markdownMediaEnUS } from '../../../../flower_ui/src/chat/markdown/mediaCopy';

let dispose: (() => void) | undefined;
const media = commands as unknown as {
  emulateMediaPreferences: (preferences: { forcedColors: 'active' | 'none' }) => Promise<void>;
};
afterEach(async () => {
  await media.emulateMediaPreferences({ forcedColors: 'none' });
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
  document.documentElement.classList.remove('light', 'dark');
  window.getSelection()?.removeAllRanges();
});

function applyTheme(preset: typeof builtInShellThemePresets[number], material: string) {
  const root = document.documentElement;
  root.removeAttribute('style');
  root.classList.toggle('dark', preset.mode === 'dark');
  root.classList.toggle('light', preset.mode === 'light');
  root.dataset.floeShellTheme = preset.name;
  root.dataset.floeSurfaceStyle = material;
  for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) {
    if (value) root.style.setProperty(name, value);
  }
}

function colors() {
  const context = document.createElement('canvas').getContext('2d')!;
  const rgb = (value: string): number[] => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  };
  const mix = (front: number[], back: number[]): number[] => front.slice(0, 3)
    .map((value, index) => value * front[3] / 255 + back[index] * (1 - front[3] / 255));
  const background = (node: HTMLElement | null): number[] => node
    ? mix(rgb(getComputedStyle(node).backgroundColor), background(node.parentElement))
    : [255, 255, 255];
  const luminance = (color: number[]): number => color.slice(0, 3).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (first: number[], second: number[]): number => {
    const a = luminance(first), b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  return { rgb, mix, background, contrast };
}

function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <div class="flower-chat-shell" style={{ width: 'min(760px, 100%)', padding: '24px' }}>
    <div class="flower-transcript-stack">
      <div class="flower-turn-summary">
        <button class="flower-turn-summary-button" aria-expanded="true"><span data-copy>Worked for 2 minutes 18 seconds</span></button>
      </div>
      <div class="flower-message-bubble flower-message-bubble-assistant flower-message-bubble-plain">
        <span data-copy>Review the proposed change.</span>
        <FlowerMarkdownBlock content={'[Google Cloud source](https://example.com/cloud.html)\n\n![Android Agent announcement](https://example.com/android.htm?lang=en#details)\n\n[Read `the guide`](https://example.com/guide) and [details](#details).'} mediaEnabled copyCodeLabel="Copy code" codeCopiedLabel="Copied" mediaLabels={markdownMediaEnUS} />
      </div>
      <div class="flower-message-row flower-message-row-user">
        <div class="flower-message-block-stack flower-message-block-stack-user">
          <div class="flower-message-resources">
            {['file', 'selection', 'directory', 'terminal', 'process', 'snapshot', 'environment', 'attachment'].map(tone => (
              <button class="flower-message-resource flower-chat-context-chip" data-tone={tone} data-flower-chat-context-interactive="true">
                <span class="flower-chat-context-chip-text">
                  <span class="flower-chat-context-chip-label" data-copy>{tone}</span>
                  <span class="flower-chat-context-chip-detail" data-copy>/workspace/readable-reference</span>
                </span>
              </button>
            ))}
          </div>
          <div class="flower-message-bubble flower-message-bubble-framed flower-message-bubble-user">
            <span class="flower-message-plain-text" data-copy>Make my messages easier to recognize.</span>
            <FlowerMarkdownBlock content={'**Readable text** and [a helpful link](https://example.com). Use `--theme` and [`the theme guide`](https://example.com/theme).\n\n> Keep quoted instructions clear.\n\n| Setting | Value |\n| --- | --- |\n| Theme | Auto |\n\n```\nplain code remains readable\n```'} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />
          </div>
        </div>
      </div>
      <div class="flower-message-row flower-message-row-user">
        <section class="flower-message-bubble flower-message-bubble-framed flower-message-bubble-user flower-input-response-receipt">
          <div class="flower-input-response-status" data-copy>Answered</div>
          <dl><dt class="flower-input-response-question" data-copy>Which theme?</dt><dd class="flower-input-response-answer" data-copy>Follow the system</dd><dd class="flower-input-response-answer flower-input-response-answer-redacted" data-copy>Answer hidden</dd></dl>
        </section>
      </div>
      <div class="flower-message-row flower-message-row-user">
        <div class="flower-message-bubble flower-message-bubble-framed flower-message-bubble-user flower-queued-turn-bubble"><span data-copy>Waiting to send</span></div>
      </div>
      <div class="flower-message-row flower-message-row-user">
        <div class="flower-message-bubble flower-message-bubble-framed flower-message-bubble-user flower-message-bubble-error">
          <div class="flower-message-error-kicker" data-copy>Message error</div>
          <span data-copy>Preserve the failed message for review.</span>
        </div>
      </div>
    </div>
  </div>, host);
  return host;
}

it.each(['standard', 'soft-neumorphic'])('keeps sent messages and selected text readable across every preset with %s material', async (material) => {
  await page.viewport(900, 900);
  const host = mount();
  const { rgb, mix, background, contrast } = colors();
  for (const preset of builtInShellThemePresets) {
    applyTheme(preset, material);
    const label = `${preset.name}/${material}`;
    const bubble = host.querySelector<HTMLElement>('.flower-message-bubble-user')!;
    const face = background(bubble);
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--selection-bg)';
    bubble.parentElement!.append(probe);
    expect.soft(face, `${label} uses the text-selection accent`).toEqual(background(probe));
    probe.remove();
    for (const node of host.querySelectorAll<HTMLElement>('[data-copy], .flower-chat-md-link, .flower-chat-md-inline-code, .flower-chat-md-blockquote p, th, td, pre code')) {
      const style = getComputedStyle(node);
      const nodeFace = background(node);
      const paint = rgb(style.color);
      if (node.matches('.flower-chat-md-link') && !node.closest('.flower-message-bubble-user')) {
        expect.soft(paint[2], `${label}: blue navigation text`).toBeGreaterThan(paint[0] + 40);
      }
      paint[3] *= Number(style.opacity);
      const text = mix(paint, nodeFace);
      expect.soft(contrast(text, nodeFace), `${label}: ${node.textContent}`).toBeGreaterThanOrEqual(4.5);
      if (!node.closest('.flower-message-bubble-user')) continue;
      const selected = getComputedStyle(node, '::selection');
      const selectionFace = mix(rgb(selected.backgroundColor), nodeFace);
      expect.soft(contrast(mix(rgb(selected.color), selectionFace), selectionFace), `${label}: selected ${node.textContent}`).toBeGreaterThanOrEqual(4.5);
      expect.soft(contrast(selectionFace, nodeFace), `${label}: visible selection ${node.textContent}`).toBeGreaterThanOrEqual(1.5);
    }
    const link = bubble.querySelector<HTMLAnchorElement>('.flower-chat-md-link')!;
    await userEvent.hover(link);
    expect.soft(contrast(rgb(getComputedStyle(link).color), face), `${label} hovered link`).toBeGreaterThanOrEqual(4.5);
    link.focus();
    expect.soft(contrast(rgb(getComputedStyle(link).color), face), `${label} focused link`).toBeGreaterThanOrEqual(4.5);
    await userEvent.unhover(link);
    const summary = host.querySelector<HTMLButtonElement>('.flower-turn-summary-button')!;
    const summaryStyle = getComputedStyle(summary);
    const width = summary.getBoundingClientRect().width;
    expect.soft(rgb(summaryStyle.backgroundColor)[3], `${label} summary has no surface fill`).toBe(0);
    expect.soft(parseFloat(summaryStyle.borderTopWidth), `${label} summary has no button border`).toBe(0);
    expect.soft(summaryStyle.boxShadow, `${label} summary has no button shadow`).toBe('none');
    expect.soft(summary.getBoundingClientRect().height, `${label} summary keeps a comfortable target`).toBeGreaterThanOrEqual(32);
    await userEvent.hover(summary);
    expect.soft(contrast(rgb(getComputedStyle(summary).color), background(summary)), `${label} hovered process summary`).toBeGreaterThanOrEqual(4.5);
    expect.soft(rgb(getComputedStyle(summary).backgroundColor)[3], `${label} hover remains frameless`).toBe(0);
    expect.soft(summary.getBoundingClientRect().width, `${label} hover preserves geometry`).toBe(width);
    await userEvent.unhover(summary);
  }
});

it.each(['standard', 'soft-neumorphic'])('renders saturated nonpurple references with quiet fills and %s material', async (material) => {
  const host = mount();
  const { rgb, contrast } = colors();
  const assistant = host.querySelector<HTMLElement>('.flower-message-bubble-assistant')!;
  const inlineHost = document.createElement('div');
  assistant.append(inlineHost);
  const longPath = '/workspace/project/' + 'deeply-nested-reference/'.repeat(10) + 'ThemeProvider.tsx';
  // CJK prose and bold Latin text reproduce the optical weight around a real reference.
  const disposeInline = render(() => <FlowerMarkdownBlock content={'### 这个页面是什么\n\n你截的是 **Slack 官方帮助中心（Slack Help Center）**的一篇文章页面。从面包屑看，路径是：\n\n`Slack Help Center → Using Slack → Message features & tools`\n\n文章标题是 **《Use threads to organize discussions》**（用「话题串」来整理讨论）。\n\nReview `' + longPath + '` before continuing.'} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />, inlineHost);
  const selectedInline = host.querySelector<HTMLElement>('.flower-message-bubble-user .flower-chat-md-inline-code')!;
  const retainedRange = document.createRange(); retainedRange.selectNodeContents(selectedInline);
  window.getSelection()!.addRange(retainedRange);
  try {
    for (const width of [900, 320]) {
      await page.viewport(width, 900);
      for (const preset of builtInShellThemePresets) {
        applyTheme(preset, material);
        // Exercise the published stylesheet, not inline semantic-token injection.
        document.documentElement.removeAttribute('style');
        const label = [preset.name, material, width].join('/');
        expect(window.getSelection()!.toString(), label).toBe(selectedInline.textContent);
        const tokens = preset.semanticTokens!;
        expect(tokens['--inline-code-foreground'], label).toBeTruthy();
        expect(tokens['--inline-code-background'], label).toBeTruthy();
        const nodes = [...host.querySelectorAll<HTMLElement>('.flower-chat-md-inline-code')].filter(node => !node.closest('a'));
        expect(nodes.length).toBe(3);
        for (const node of nodes) {
          const style = getComputedStyle(node);
          const [red, green, blue] = rgb(style.color).slice(0, 3).map(value => value / 255);
          const maximum = Math.max(red, green, blue), minimum = Math.min(red, green, blue);
          const delta = maximum - minimum;
          const saturation = delta / (1 - Math.abs(maximum + minimum - 1));
          const sector = maximum === red ? (green - blue) / delta
            : maximum === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
          const hue = (sector * 60 + 360) % 360;
          expect(saturation, label + ': chromatic emphasis').toBeGreaterThanOrEqual(0.55);
          expect(hue < 245 || hue > 330, label + ': avoid purple accents').toBe(true);
          expect(contrast(rgb(style.backgroundColor), rgb(getComputedStyle(document.documentElement).getPropertyValue('--background'))), label + ': quiet fill').toBeLessThan(1.2);
          expect(rgb(style.color), label).toEqual(rgb(tokens['--inline-code-foreground']!));
          expect(rgb(style.backgroundColor), label).toEqual(rgb(tokens['--inline-code-background']!));
          expect(style.borderTopWidth, label).toBe('0px');
          expect(style.fontWeight, label + ': optical emphasis').toBe('500');
          const bodySize = parseFloat(getComputedStyle(node.closest('.flower-chat-md-block')!).fontSize);
          expect(parseFloat(style.fontSize) / bodySize, label + ': reference reading size').toBeCloseTo(0.96, 2);
          expect(contrast(rgb(style.color), rgb(style.backgroundColor)), label).toBeGreaterThanOrEqual(preset.name === 'hc-light' ? 7 : 4.5);
          const range = document.createRange(); range.selectNodeContents(node);
          const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
          expect(selection.toString(), label).toBe(node.textContent);
          const selected = getComputedStyle(node, '::selection');
          expect(contrast(rgb(selected.color), rgb(selected.backgroundColor)), label).toBeGreaterThanOrEqual(4.5);
          expect(contrast(rgb(selected.backgroundColor), rgb(style.backgroundColor)), label).toBeGreaterThanOrEqual(1.5);
          expect([...node.getClientRects()].every(rect => rect.left >= 0 && rect.right <= width), label).toBe(true);
        }
        expect(host.scrollWidth, label).toBeLessThanOrEqual(width);
        if (width === 320) {
          for (const node of nodes.filter(node => node.textContent!.length > 60)) {
            expect(node.getClientRects().length, label + ': wrapped reference').toBeGreaterThan(1);
          }
        }
        if (width === 900 && material === 'standard') {
          window.getSelection()!.removeAllRanges();
          await page.screenshot({ element: host, path: '__screenshots__/flower-inline-' + preset.name + '.png' });
          window.getSelection()!.addRange(retainedRange);
        }
      }
    }
  } finally {
    disposeInline();
  }
}, 30_000);

it('keeps external pages compact, visibly navigable and keyboard accessible at mobile width', async () => {
  await page.viewport(390, 800);
  applyTheme(builtInShellThemePresets.find(preset => preset.name === 'paper')!, 'standard');
  const host = mount();
  const assistant = host.querySelector<HTMLElement>('.flower-message-bubble-assistant')!;
  await expect.element(page.getByRole('link', { name: 'Google Cloud source', exact: true })).toBeVisible();
  const links = assistant.querySelectorAll<HTMLAnchorElement>('a');
  expect(links.length).toBe(4);
  expect(assistant.querySelector('.chat-media')).toBeNull();
  expect(assistant.querySelector('iframe')).toBeNull();
  expect(assistant.textContent).not.toContain('Preview unavailable');
  for (const link of links) {
    expect(link.querySelector('svg')).toBeNull();
    expect(getComputedStyle(link).cursor).toBe('pointer');
    expect(getComputedStyle(link).textDecorationLine).toContain('underline');
  }
  const link = links[0];
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement).toBe(host.querySelector('.flower-turn-summary-button'));
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement).toBe(link);
  expect(parseFloat(getComputedStyle(link).outlineWidth)).toBeGreaterThanOrEqual(2);
  expect(link.target).toBe('_blank');
  expect(link.rel).toBe('noopener noreferrer');
  const code = assistant.querySelector<HTMLElement>('a code')!;
  expect(getComputedStyle(code).color).toBe(getComputedStyle(code.closest('a')!).color);
  expect(host.scrollWidth).toBeLessThanOrEqual(390);
  await page.screenshot({ element: assistant, path: '__screenshots__/flower-external-links-paper.png' });
});

it('preserves native selection and message geometry when changing themes at mobile width', async () => {
  await page.viewport(390, 800);
  const host = mount();
  const text = host.querySelector<HTMLElement>('.flower-message-plain-text')!;
  const range = document.createRange();
  range.selectNodeContents(text);
  const selection = window.getSelection()!;
  selection.addRange(range);
  const initial = text.getBoundingClientRect();
  for (const name of ['paper', 'porcelain-dark', 'hc-light', 'graphite']) {
    const preset = builtInShellThemePresets.find(preset => preset.name === name)!;
    applyTheme(preset, 'standard');
    expect(selection.toString()).toBe(text.textContent);
    expect(text.getBoundingClientRect().width).toBe(initial.width);
    expect(host.scrollWidth).toBeLessThanOrEqual(390);
    await page.screenshot({ element: host, path: `__screenshots__/flower-message-${name}.png` });
  }
});

it('uses system colors for sent messages, insets and native selection in forced colors', async () => {
  const host = mount();
  const { rgb, mix, background, contrast } = colors();
  await media.emulateMediaPreferences({ forcedColors: 'active' });
  for (const name of ['classic-light', 'classic-dark', 'porcelain-light', 'porcelain-dark']) {
    applyTheme(builtInShellThemePresets.find(preset => preset.name === name)!, 'soft-neumorphic');
    for (const node of host.querySelectorAll<HTMLElement>('[data-copy], .flower-chat-md-link, .flower-chat-md-inline-code, .flower-chat-md-blockquote p, th, td, pre code')) {
      const face = background(node);
      expect.soft(contrast(rgb(getComputedStyle(node).color), face), `${name}: system text ${node.textContent}`).toBeGreaterThanOrEqual(4.5);
      if (!node.closest('.flower-message-bubble-user')) continue;
      const selected = getComputedStyle(node, '::selection');
      const selectionFace = mix(rgb(selected.backgroundColor), face);
      expect.soft(contrast(rgb(selected.color), selectionFace), `${name}: system selection text ${node.textContent}`).toBeGreaterThanOrEqual(4.5);
      expect.soft(contrast(selectionFace, face), `${name}: visible system selection ${node.textContent}`).toBeGreaterThanOrEqual(1.5);
    }
  }
});
