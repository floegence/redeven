import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { FlowerMarkdownBlock } from '../../../../flower_ui/src/chat/markdown/FlowerMarkdownBlock';
import type { FlowerCitationSource } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import '../../../../flower_ui/src/styles/flower.css';

let dispose: (() => void) | undefined;
let root: HTMLDivElement;
afterEach(() => { dispose?.(); root?.remove(); });
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
});
