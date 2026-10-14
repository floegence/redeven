import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { FlowerMarkdownBlock } from '../../../../flower_ui/src/chat/markdown/FlowerMarkdownBlock';
import { flowerMarkdownCodeTextForCopyButton } from '../../../../flower_ui/src/chat/markdown/codeBlockCopy';
import { flowerMessageTextForCopy } from '../../../../flower_ui/src/chat/markdown/flowerCitations';
import '../../../../flower_ui/src/styles/flower.css';

let dispose: (() => void) | undefined;
let root: HTMLDivElement;
afterEach(() => { dispose?.(); root?.remove(); });
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const report = '**为什么值得关注：**这不是单纯增加模型支持，而是降低“接入应用—运行任务—观察子代理—处理异常”的操作成本。\n\n**注意：**该版本汇总此前补丁周期的改动。\n\n**边界：**5.8 个百分点不是完整任务成功率。\n\n这是**“调用工具”**的例子。';

describe('Flower CJK emphasis in Chromium', () => {
  it('renders report labels with the existing strong style at narrow and desktop widths', async () => {
    root = document.createElement('div'); root.style.width = '320px'; document.body.appendChild(root);
    dispose = render(() => <FlowerMarkdownBlock content={report} copyCodeLabel="Copy" codeCopiedLabel="Copied" />, root);
    await frame();
    expect([...root.querySelectorAll('strong')].map(node => node.textContent)).toEqual(['为什么值得关注：', '注意：', '边界：', '“调用工具”']);
    expect(root.textContent).not.toContain('**');
    expect(Number(getComputedStyle(root.querySelector('strong')!).fontWeight)).toBeGreaterThanOrEqual(600);
    expect(root.scrollWidth).toBeLessThanOrEqual(321);
    root.style.width = '960px'; await frame();
    expect(root.scrollWidth).toBeLessThanOrEqual(961);
    expect(flowerMessageTextForCopy(report)).toBe(report);
  });

  it('keeps code and escaped examples literal', async () => {
    const content = '`**注意：**正文`\n\n```text\n**边界：**正文\n```\n\n\\*\\*注意：\\*\\*正文';
    root = document.createElement('div'); document.body.appendChild(root);
    dispose = render(() => <FlowerMarkdownBlock content={content} copyCodeLabel="Copy" codeCopiedLabel="Copied" />, root);
    await frame();
    expect(root.querySelector('code.flower-chat-md-inline-code')?.textContent).toBe('**注意：**正文');
    expect(root.querySelectorAll('strong')).toHaveLength(0);
    const button = root.querySelector<HTMLButtonElement>('button.flower-chat-md-code-copy')!;
    expect(flowerMarkdownCodeTextForCopyButton(button)).toBe('**边界：**正文');
    expect(root.textContent).toContain('**注意：**正文');
    expect(flowerMessageTextForCopy(content)).toBe(content);
  });

  it('combines CJK emphasis with exact Unicode citation ranges', async () => {
    const prefix = '**注意：**该版本😀';
    const marker = '\uE200cite\uE202turn1view5\uE201';
    const content = prefix + marker;
    const start = [...prefix].length;
    const sources = [{ title: 'Official source', url: 'https://example.com/docs', start_index: start, end_index: start + [...marker].length }];
    root = document.createElement('div'); document.body.appendChild(root);
    dispose = render(() => <FlowerMarkdownBlock content={content} sources={sources} citationLabels={{ sources: 'Sources', unavailable: 'Unavailable' }} copyCodeLabel="Copy" codeCopiedLabel="Copied" />, root);
    await frame();
    expect(root.querySelector('strong')?.textContent).toBe('注意：');
    expect(root.querySelector('a.flower-chat-citation')?.getAttribute('href')).toBe(sources[0].url);
    expect(root.textContent).not.toContain('turn1view5');
    expect(flowerMessageTextForCopy(content)).toBe(prefix);
  });

  it('resolves split emphasis through the same parser and preserves committed code controls', async () => {
    const prefix = '```text\n**代码：**原文\n```\n\n';
    const tail = '**注意：**该版本已发布。';
    const [content, setContent] = createSignal(prefix + tail.slice(0, 1));
    const [streaming, setStreaming] = createSignal(true);
    root = document.createElement('div'); document.body.appendChild(root);
    dispose = render(() => <FlowerMarkdownBlock content={content()} streaming={streaming()} copyCodeLabel="Copy" codeCopiedLabel="Copied" />, root);
    await frame();
    const button = root.querySelector('button');
    for (let end = 2; end <= tail.length; end += 1) {
      setContent(prefix + tail.slice(0, end)); await frame();
    }
    expect(root.querySelector('strong')?.textContent).toBe('注意：');
    expect(root.querySelector('button')).toBe(button);
    setStreaming(false); await frame();
    expect(root.querySelector('strong')?.textContent).toBe('注意：');
    expect(root.querySelector('button')).toBe(button);
    expect(content()).toBe(prefix + tail);
  });
});
