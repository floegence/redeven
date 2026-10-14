import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../index.css';
import { FlowerMarkdownBlock } from '../../../../flower_ui/src/chat/markdown/FlowerMarkdownBlock';
import type { FlowerCitationSource } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import '../../../../flower_ui/src/styles/flower.css';

let dispose: (() => void) | undefined;
let root: HTMLDivElement;
afterEach(async () => {
  dispose?.(); root?.remove(); vi.restoreAllMocks();
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  await page.viewport(1280, 720);
});
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const marker = '\uE200cite\uE202turn1view5\uE201';
const prefix = '你好😀 ';
const source = { title: 'Official source', url: 'https://example.com/docs', start_index: 4, end_index: 4 + [...marker].length };

describe('Flower canonical citations in Chromium', () => {
  it('hides streamed markers, binds late sources and fits narrow reading surfaces', async () => {
    const [content, setContent] = createSignal(prefix);
    const [sources, setSources] = createSignal<readonly FlowerCitationSource[]>([]);
    const [streaming, setStreaming] = createSignal(true);
    root = document.createElement('div'); root.style.width = '320px'; document.body.appendChild(root);
    dispose = render(() => <FlowerMarkdownBlock content={content()} sources={sources()} streaming={streaming()} citationLabels={{ sources: 'Sources', unavailable: '来源不可用' }} copyCodeLabel="Copy" codeCopiedLabel="Copied" />, root);
    for (let end = 1; end <= marker.length; end += 1) {
      setContent(prefix + marker.slice(0, end)); await frame();
      expect(root.textContent).not.toMatch(/[\uE200\uE201\uE202]/);
    }
    setSources([source]); await frame();
    await expect.poll(() => root.querySelector('a')?.getAttribute('href')).toBe(source.url);
    expect(root.querySelector('a')?.textContent).toBe(source.title);
    setStreaming(false); await frame();
    expect(root.querySelector('.flower-chat-source-list')).toBeNull();
    expect(root.scrollWidth).toBeLessThanOrEqual(321);
    root.style.width = '960px'; await frame(); expect(root.scrollWidth).toBeLessThanOrEqual(961);
    setSources([{ ...source, start_index: 5 }]); await frame();
    expect(root.querySelector('.flower-chat-citation')).toBeNull();
    expect(root.querySelector('.flower-chat-source-list a')?.getAttribute('href')).toBe(source.url);
    setSources([]); await frame(); expect(root.textContent).toContain('来源不可用');
  });

  it('preserves fenced citation examples and committed code controls', async () => {
    const code = `\`\`\`text\n${marker}\n\`\`\`\n\n`;
    const [sources, setSources] = createSignal<readonly FlowerCitationSource[]>([]);
    root = document.createElement('div'); document.body.appendChild(root);
    dispose = render(() => <FlowerMarkdownBlock content={code + prefix + marker} sources={sources()} citationLabels={{ sources: 'Sources', unavailable: 'Unavailable' }} copyCodeLabel="Copy" codeCopiedLabel="Copied" />, root);
    await frame();
    expect(root.querySelector('code')?.textContent).toBe(marker);
    const button = root.querySelector('button');
    const start = [...code + prefix].length;
    setSources([{ ...source, start_index: start, end_index: start + [...marker].length }]); await frame();
    expect(root.querySelector('button')).toBe(button);
    expect(root.querySelectorAll('a.flower-chat-citation')).toHaveLength(1);
  });

  it.each(['classic-light', 'classic-dark'])('renders readable source cards, exact copy and narrow layouts in %s', async theme => {
    await page.viewport(1060, 900);
    document.documentElement.classList.toggle('dark', theme === 'classic-dark');
    document.documentElement.dataset.floeShellTheme = theme;
    // Unicode deliberately exercises multilingual source titles and exact copying.
    const bibliography = `[1] Hermes v0.22.0\nhttps://github.com/NousResearch/hermes-agent/releases/tag/v0.22.0\n\n[14] 原始来源 — a long title that wraps without hiding its destination\nhttps://example.com/${'long-source-path-'.repeat(24)}`;
    const [content, setContent] = createSignal(`# Report\n\nFirst paragraph.\n\nSecond paragraph.\n\n## Findings\n\n- First finding\n- Second finding\n\n### References\n\n\`\`\`text\n${bibliography}`);
    root = document.createElement('div'); root.style.width = '960px'; document.body.appendChild(root);
    const [copyLabel, setCopyLabel] = createSignal('Copy sources');
    dispose = render(() => <div class="flower-chat-shell" style={{ padding: '24px' }}>
      <div class="flower-message-bubble flower-message-bubble-assistant"><FlowerMarkdownBlock content={content()} streaming={true} citationLabels={{ sources: 'Sources', unavailable: 'Unavailable', copy: copyLabel() }} copyCodeLabel="Copy code" codeCopiedLabel="Copied" /></div>
      <div class="flower-composer">
        <textarea aria-label="Message" />
        <div style={{ display: 'flex' }}>
          <button class="flower-permission-trigger">Approval required</button>
          <div class="flower-model-reasoning-control"><button class="flower-model-reasoning-model-trigger">Model</button><button class="flower-reasoning-segment-button">Medium</button></div>
        </div>
      </div>
    </div>, root);
    await frame();
    expect(root.querySelector('.flower-chat-source-list')).toBeNull();
    setContent(content() + '\n```\n\n');
    await expect.poll(() => root.querySelectorAll('.flower-chat-source-card').length).toBe(2);
    const block = root.querySelector<HTMLElement>('.flower-chat-md-block')!;
    expect(parseFloat(getComputedStyle(block).fontSize)).toBe(14);
    expect(parseFloat(getComputedStyle(block).lineHeight)).toBeCloseTo(24.5);
    for (const control of root.querySelectorAll('.flower-permission-trigger, .flower-model-reasoning-model-trigger, .flower-reasoning-segment-button')) {
      expect(getComputedStyle(control).fontSize).toBe('10px');
    }
    expect(getComputedStyle(root.querySelector('textarea')!).fontSize).toBe('14px');
    const paragraphs = root.querySelectorAll('p');
    expect(parseFloat(getComputedStyle(paragraphs[1]).marginTop)).toBeGreaterThanOrEqual(11);
    expect(root.querySelectorAll('.flower-chat-source-number')[1].textContent).toBe('14');
    expect(root.querySelectorAll('.flower-chat-source-card')[1].getAttribute('href')).toBe(bibliography.split('\n').at(-1));
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const button = root.querySelector<HTMLButtonElement>('.flower-chat-source-copy')!;
    button.click();
    await expect.poll(() => write.mock.calls[0]?.[0]).toBe(bibliography);
    expect(button.getAttribute('aria-label')).toBe('Copied');
    expect(root.querySelector('.flower-chat-md-code-block')).toBeNull();
    await page.screenshot({ element: root, path: `__screenshots__/flower-source-cards-${theme}.png` });
    root.style.width = '320px'; await frame();
    expect(root.scrollWidth).toBeLessThanOrEqual(321);
    const first = root.querySelector<HTMLElement>('.flower-chat-source-card')!;
    const second = root.querySelectorAll<HTMLElement>('.flower-chat-source-card')[1];
    expect(second.getBoundingClientRect().top).toBeGreaterThan(first.getBoundingClientRect().top);
    first.focus();
    expect(getComputedStyle(first).outlineStyle).toBe('solid');
    setCopyLabel('複製來源'); await frame();
    expect(root.querySelector('.flower-chat-source-copy')?.getAttribute('aria-label')).toBe('複製來源');
  });
});
