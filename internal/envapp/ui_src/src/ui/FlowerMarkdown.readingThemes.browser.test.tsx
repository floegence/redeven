import '../index.css';
import './flower-feature.css';

import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { FlowerAnswerActions } from '../../../../flower_ui/src/FlowerAnswerActions';
import { FlowerMarkdownBlock } from '../../../../flower_ui/src/chat/markdown/FlowerMarkdownBlock';
import { flowerMessageTextForCopy } from '../../../../flower_ui/src/chat/markdown/flowerCitations';

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

function applyTheme(preset: typeof builtInShellThemePresets[number], material = 'standard') {
  const root = document.documentElement;
  root.classList.toggle('dark', preset.mode === 'dark');
  root.classList.toggle('light', preset.mode === 'light');
  root.dataset.floeShellTheme = preset.name;
  root.dataset.floeSurfaceStyle = material;
}

function colors() {
  const context = document.createElement('canvas').getContext('2d')!;
  const rgb = (value: string) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const luminance = (value: number[]) => value.map(channel => {
    const n = channel / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, n, index) => sum + n * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (first: string, second: string) => {
    const a = luminance(rgb(first)), b = luminance(rgb(second));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  return { rgb, contrast };
}

// Unicode, bold metadata and long identifiers must remain authored Markdown.
const tick = String.fromCharCode(96);
const identifier = 'wake_on_agent_messages_' + 'long_identifier_'.repeat(12);
const content = [
  '# Release analysis',
  '### Execution changes',
  '**October 18 · PR #54961**',
  'Review **the exact boundary** and ' + tick + identifier + tick + ' before enabling [the documented behavior](https://example.com/docs).',
  '> Preserve the complete explanation.',
  '**注意：**保留原始强调与引用。',
].join('\n\n');

function mount() {
  const host = document.createElement('div');
  host.style.width = '100%';
  document.body.append(host);
  dispose = render(() => <div class="flower-chat-shell" style={{ height: 'auto', padding: '16px' }}>
    <div class="flower-transcript-stack">
      <div class="flower-message-bubble flower-message-bubble-assistant flower-message-bubble-plain">
        <FlowerMarkdownBlock content={content} copyCodeLabel="Copy" codeCopiedLabel="Copied" footer={
          <FlowerAnswerActions copyButton={<button type="button" class="flower-message-copy-button" aria-label="Copy answer" />}
            timestamp={Date.parse('2026-10-18T10:18:00Z')} exportLabel="Export HTML" exportedLabel="Export started"
            forkLabel="Fork" forkBusyLabel="Forking" settled forkBusy={false} onExport={() => true} />
        } />
      </div>
      <div class="flower-message-bubble flower-message-bubble-user flower-message-bubble-framed">
        <FlowerMarkdownBlock content={'User ' + tick + 'reference' + tick + ' and [link](https://example.com/user).'} copyCodeLabel="Copy" codeCopiedLabel="Copied" />
      </div>
    </div>
  </div>, host);
  return host;
}

it('uses a roomier assistant reading scale without enlarging user bubbles', async () => {
  await page.viewport(1100, 1000);
  const host = mount();
  const assistant = host.querySelector<HTMLElement>('.flower-message-bubble-assistant .flower-chat-md-block')!;
  const user = host.querySelector<HTMLElement>('.flower-message-bubble-user .flower-chat-md-block')!;
  expect(parseFloat(getComputedStyle(assistant).fontSize)).toBe(15);
  expect(parseFloat(getComputedStyle(assistant).lineHeight)).toBeCloseTo(28.2);
  expect(assistant.getBoundingClientRect().width).toBeLessThanOrEqual(700);
  expect(parseFloat(getComputedStyle(user).fontSize)).toBe(14);
  expect(parseFloat(getComputedStyle(user).lineHeight)).toBeCloseTo(24.5);
  const code = assistant.querySelector<HTMLElement>('.flower-chat-md-inline-code')!;
  expect(parseFloat(getComputedStyle(code).fontSize) / 15).toBeCloseTo(0.91);
  expect(getComputedStyle(code).fontWeight).toBe('400');
  expect(getComputedStyle(host.querySelector('.flower-answer-time')!).fontSize).toBe('12px');
  expect(assistant.querySelector('strong')!.textContent).toBe('October 18 · PR #54961');
  expect(getComputedStyle(assistant.querySelector('strong')!).fontWeight).toBe('600');
  expect(flowerMessageTextForCopy(content)).toBe(content);
});

it.each(['standard', 'soft-neumorphic'])('keeps assistant text readable in every published theme with %s material', async material => {
  await page.viewport(1000, 1000);
  const host = mount();
  const { rgb, contrast } = colors();
  const assistant = host.querySelector<HTMLElement>('.flower-message-bubble-assistant')!;
  const link = assistant.querySelector<HTMLAnchorElement>('a')!;
  const code = assistant.querySelector<HTMLElement>('code')!;
  const timestamp = assistant.querySelector<HTMLElement>('time')!;
  const probe = document.createElement('span');
  assistant.append(probe);
  for (const preset of builtInShellThemePresets) {
    applyTheme(preset, material);
    const label = preset.name + '/' + material;
    const background = getComputedStyle(host.querySelector('.flower-chat-shell')!).backgroundColor;
    for (const node of [assistant, timestamp, assistant.querySelector('blockquote')!, link]) {
      expect.soft(contrast(getComputedStyle(node).color, background), label + ': ' + node.tagName).toBeGreaterThanOrEqual(4.5);
    }
    probe.style.color = preset.name === 'hc-light' ? 'var(--info)' : 'color-mix(in srgb, var(--info) 78%, var(--foreground) 22%)';
    expect.soft(rgb(getComputedStyle(link).color), label + ': semantic link').toEqual(rgb(getComputedStyle(probe).color));
    probe.style.color = preset.name === 'hc-light' ? 'var(--inline-code-foreground)' : 'color-mix(in srgb, var(--inline-code-foreground) 82%, var(--foreground) 18%)';
    expect.soft(rgb(getComputedStyle(code).color), label + ': semantic code').toEqual(rgb(getComputedStyle(probe).color));
    expect.soft(contrast(getComputedStyle(code).color, getComputedStyle(code).backgroundColor), label + ': code').toBeGreaterThanOrEqual(4.5);
    const selected = getComputedStyle(code, '::selection');
    expect.soft(contrast(selected.color, selected.backgroundColor), label + ': selected code').toBeGreaterThanOrEqual(4.5);
    expect.soft(getComputedStyle(link).textDecorationLine, label).toContain('underline');
    expect.soft(getComputedStyle(link).cursor, label).toBe('pointer');
    await userEvent.hover(link);
    expect.soft(contrast(getComputedStyle(link).color, background), label + ': hovered link').toBeGreaterThanOrEqual(4.5);
    link.focus();
    expect.soft(getComputedStyle(link).outlineStyle, label + ': keyboard focus').toBe('solid');
    expect.soft(contrast(getComputedStyle(link).color, background), label + ': focused link').toBeGreaterThanOrEqual(4.5);
    link.blur();
    await userEvent.unhover(link);
  }
}, 30_000);

it('preserves text, focus, geometry and native selection when the theme changes', async () => {
  await page.viewport(900, 1000);
  const host = mount();
  const article = host.querySelector<HTMLElement>('.flower-message-bubble-assistant .flower-chat-md-block')!;
  const code = article.querySelector('code')!;
  const link = article.querySelector<HTMLAnchorElement>('a')!;
  const geometry = article.getBoundingClientRect().toJSON();
  const codeGeometry = [...code.getClientRects()].map(rect => rect.toJSON());
  const text = article.textContent;
  link.focus();
  const range = document.createRange();
  range.selectNodeContents(code);
  window.getSelection()!.addRange(range);
  for (const preset of builtInShellThemePresets) {
    applyTheme(preset);
    expect(article.querySelector('code')).toBe(code);
    expect(article.textContent).toBe(text);
    expect(article.getBoundingClientRect().toJSON()).toEqual(geometry);
    expect([...code.getClientRects()].map(rect => rect.toJSON())).toEqual(codeGeometry);
    expect(document.activeElement).toBe(link);
    expect(window.getSelection()!.toString()).toBe(identifier);
  }
});

it.each([320, 390])('wraps long identifiers at %i px and with doubled text size', async width => {
  await page.viewport(width, 1000);
  const host = mount();
  const article = host.querySelector<HTMLElement>('.flower-message-bubble-assistant .flower-chat-md-block')!;
  for (const scale of [1, 2]) {
    document.documentElement.style.fontSize = String(16 * scale) + 'px';
    expect(host.scrollWidth).toBeLessThanOrEqual(width);
    expect([...article.querySelector('code')!.getClientRects()].every(rect => rect.left >= 0 && rect.right <= width)).toBe(true);
  }
});

it('uses explicit high contrast and native forced-color reading roles', async () => {
  const host = mount();
  applyTheme(builtInShellThemePresets.find(preset => preset.name === 'hc-light')!);
  const code = host.querySelector<HTMLElement>('.flower-message-bubble-assistant code')!;
  const link = host.querySelector<HTMLElement>('.flower-message-bubble-assistant a')!;
  expect(getComputedStyle(code).outlineWidth).toBe('1px');
  expect(getComputedStyle(code).outlineStyle).toBe('solid');
  expect(getComputedStyle(code).borderTopWidth).toBe('0px');
  expect(parseFloat(getComputedStyle(link).textDecorationThickness)).toBeGreaterThanOrEqual(2);
  await media.emulateMediaPreferences({ forcedColors: 'active' });
  const probe = document.createElement('span'); host.append(probe);
  probe.style.color = 'CanvasText';
  expect(getComputedStyle(code).color).toBe(getComputedStyle(probe).color);
  probe.style.color = 'LinkText';
  expect(getComputedStyle(link).color).toBe(getComputedStyle(probe).color);
});
