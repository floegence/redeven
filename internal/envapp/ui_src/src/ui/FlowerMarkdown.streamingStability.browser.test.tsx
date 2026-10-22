import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowerMarkdownBlock } from '../../../../flower_ui/src/chat/markdown/FlowerMarkdownBlock';
import { flowerMarkdownCodeTextForCopyButton } from '../../../../flower_ui/src/chat/markdown/codeBlockCopy';

let dispose: (() => void) | undefined;
let root: HTMLDivElement;
afterEach(() => { dispose?.(); root?.remove(); vi.restoreAllMocks(); window.getSelection()?.removeAllRanges(); });
function mount(view: () => JSX.Element) {
  root = document.createElement('div');
  document.body.appendChild(root);
  dispose = render(view, root);
}
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe('streaming markdown DOM', () => {
  it.each([1, 3, 11])('keeps the billing list through %i-character deltas and completion', async size => {
    const answer = 'Added `api/internal/billing/limits_test.go`:\n\n'
      + '- **Under the limit** — 80 units are recorded normally.\n'
      + '- **Over the limit** — the next 30 units return `ErrLimitExceeded`.\n'
      + '- **No partial writes** — the bucket stays at 80 after a rejection.\n\n'
      + 'One follow-up: `NewMeter` never initializes `limits`, so limits only apply when set explicitly. Want me to load them from config next?';
    const [content, setContent] = createSignal('');
    const [streaming, setStreaming] = createSignal(true);
    const [revision, setRevision] = createSignal(0);
    const chunks: string[] = [];
    const textSource = { get length() { return chunks.length; }, get revision() { return revision(); }, read: (from: number) => chunks.slice(from) };
    mount(() => <FlowerMarkdownBlock content={content()} textSource={textSource} streaming={streaming()} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
    for (let at = 0; at < answer.length; at += size) {
      const delta = answer.slice(at, at + size);
      chunks.push(delta);
      setContent(value => value + delta);
      setRevision(value => value + 1);
      await Promise.resolve();
    }
    expect(root.querySelectorAll('ul > li')).toHaveLength(3);
    setStreaming(false); await frame();
    expect([...root.querySelectorAll('ul > li strong')].map(node => node.textContent)).toEqual(['Under the limit', 'Over the limit', 'No partial writes']);
    expect(root.querySelector('ul')?.textContent).toContain('ErrLimitExceeded');
    expect(root.querySelectorAll('p')).toHaveLength(2);
  });
  it('keeps word spaces and code tab stops in the surrounding line context', async () => {
    const prose = ('alpha beta 中文 words ').repeat(2000);
    const code = 'x'.repeat(32769) + '\tcolumn\nabc\tvalue';
    mount(() => <FlowerMarkdownBlock content={prose + '\n\n```text\n' + code} streaming copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
    await frame();
    const paragraph = root.querySelector('p')!;
    expect(paragraph.innerText).toBe(prose.trimEnd());
    const literal = root.querySelector('code')!;
    expect(literal.textContent).toBe(code);
    expect([...literal.querySelectorAll('.flower-chat-md-code-chunk')].every(node => !/[\t\n]/.test(node.textContent!))).toBe(true);
    const range = document.createRange(); range.selectNodeContents(paragraph);
    window.getSelection()!.addRange(range);
    expect(window.getSelection()!.toString()).toBe(prose.trimEnd());
  });

  it('keeps extended graphemes together at long-text shaping boundaries', async () => {
    const sequence = 'e\u0301👩‍💻🇨🇳';
    const text = 'x'.repeat(2047) + sequence + 'x'.repeat(32769);
    mount(() => <FlowerMarkdownBlock content={text} streaming copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
    await frame();
    expect(root.querySelector('p')!.textContent).toBe(text);
    const chunks = [...root.querySelectorAll('.flower-chat-md-text-chunk')];
    const containing = chunks.find(node => node.textContent!.includes(sequence));
    expect(containing).toBeDefined();
    expect(chunks.every(node => !/^\p{Mark}|^\u200d/u.test(node.textContent!))).toBe(true);
  });

  it('extends a full shaping box when the next update continues its grapheme', async () => {
    const [content, setContent] = createSignal('```text\n' + 'x'.repeat(34815) + 'e');
    mount(() => <FlowerMarkdownBlock content={content()} streaming copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
    await frame();
    setContent(value => value + '\u0301next'); await frame();
    const chunks = [...root.querySelectorAll('.flower-chat-md-code-chunk')];
    expect(chunks.some(node => node.textContent!.includes('e\u0301'))).toBe(true);
    expect(chunks.every(node => !/^\p{Mark}/u.test(node.textContent!))).toBe(true);
    expect(root.querySelector('code')!.textContent).toBe('x'.repeat(34815) + 'e\u0301next');
  });

  it('bounds a browser-split one-megabyte paragraph without losing any text', async () => {
    const initial = 'x'.repeat(1048576);
    const [content, setContent] = createSignal(initial);
    mount(() => <FlowerMarkdownBlock content={content()} streaming copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
    await frame();
    const first = root.querySelector('.flower-chat-md-text-chunk')!;
    expect(first).not.toBeNull();
    setContent(value => value + ' continued 中文😀'); await frame();
    expect(root.querySelector('.flower-chat-md-text-chunk')).toBe(first);
    expect(root.querySelector('p')!.textContent).toBe(content());
  });

  it('bounds live code shaping while preserving Unicode, selection and complete copy', async () => {
    const initial = 'x'.repeat(1048576) + '世界😀';
    const [content, setContent] = createSignal('```text\n' + initial);
    mount(() => <FlowerMarkdownBlock content={content()} streaming copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
    await frame();
    const code = root.querySelector('code')!;
    const first = code.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(first); window.getSelection()!.addRange(range);
    const selected = window.getSelection()!.toString();
    setContent(value => value + '\nNew line\t追加😀'); await frame();
    expect(code.firstChild).toBe(first);
    expect(window.getSelection()!.toString()).toBe(selected);
    expect(code.textContent).toBe(initial + '\nNew line\t追加😀');
    expect([...code.querySelectorAll('.flower-chat-md-code-chunk')].every(node => node.textContent!.length <= 2048)).toBe(true);
    expect(flowerMarkdownCodeTextForCopyButton(root.querySelector('button')!)).toBe(code.textContent);
  });

  it('keeps authored source cards after the footer and mounts newly appended media', async () => {
    const [content, setContent] = createSignal('Body');
    mount(() => <FlowerMarkdownBlock content={content()} streaming mediaEnabled footer={<div data-footer>Footer</div>} citationLabels={{ sources: 'Sources', unavailable: 'Unavailable' }} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
    setContent(value => value + ' ![Image](https://example.com/image.png)'); await frame();
    expect(root.querySelector('[data-floe-markdown-media]')?.childElementCount).toBeGreaterThan(0);
    setContent(value => value + '\n\n```text\n[1] Reference\nhttps://example.com/reference\n```'); await frame();
    const footer = root.querySelector('[data-footer]')!;
    const sources = root.querySelector('.flower-chat-source-list')!;
    expect(footer.compareDocumentPosition(sources) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('keeps the complete appended code when generation ends without a closing fence', async () => {
    const [content, setContent] = createSignal('```js\nconst initial = 1;');
    const [streaming, setStreaming] = createSignal(true);
    mount(() => <FlowerMarkdownBlock content={content()} streaming={streaming()} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
    setContent(value => value + '\nconst appended = 2;');
    setStreaming(false); await frame();
    await expect.poll(() => root.querySelector('code')?.textContent).toBe('const initial = 1;\nconst appended = 2;');
    expect(flowerMarkdownCodeTextForCopyButton(root.querySelector('button')!)).toBe('const initial = 1;\nconst appended = 2;');
  });
  it('uses one Text node through 10,000 separately flushed appends and detects early replacements', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextID = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callbacks.set(++nextID, callback); return nextID; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { callbacks.delete(id); });
    const flush = () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach((callback) => callback(0)); };
    const [text, setText] = createSignal('initial text');
    mount(() => <FlowerMarkdownBlock content={text()} streaming copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
    flush();
    const node = root.querySelector('p span')!.firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 7); selection.addRange(range);
    for (let index = 0; index < 10_000; index += 1) { setText((value) => `${value}x`); flush(); }
    expect(root.querySelector('p span')!.childNodes.length).toBe(1);
    expect(root.querySelector('p span')!.firstChild).toBe(node);
    expect(root.querySelector('p')!.textContent).toBe(text());
    expect(selection.toString()).toBe('initial');
    setText(`changed text${'x'.repeat(10_000)}`); flush();
    expect(root.querySelector('p')!.textContent).toBe(text());
    setText(''); flush(); expect(root.textContent).toBe('');
    setText('pending'); dispose?.(); dispose = undefined;
    expect(callbacks.size).toBe(0);
  });

  it('keeps completed code controls mounted and renders open fences as Markdown', async () => {
    const prefix = '```js\nconst stable = 1;\n```\n\n';
    const [content, setContent] = createSignal(`${prefix}Tail`);
    const [streaming, setStreaming] = createSignal(true);
    mount(() => <FlowerMarkdownBlock content={content()} streaming={streaming()} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
    await frame();
    root.querySelector('code')!.scrollIntoView();
    await expect.poll(() => root.querySelector('code')?.hasAttribute('data-floe-code-highlighted')).toBe(true);
    const button = root.querySelector<HTMLButtonElement>('button')!;
    const segment = button.closest('.flower-chat-md-committed-segment')!;
    button.focus();
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records)); observer.observe(segment, { childList: true, subtree: true });
    for (let index = 0; index < 300; index += 1) { setContent(value => value + 'x'); await Promise.resolve(); }
    await frame(); observer.disconnect();
    expect(root.querySelector('button')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(mutations).toHaveLength(0);
    expect(flowerMarkdownCodeTextForCopyButton(button)).toBe('const stable = 1;');
    setContent(`${prefix}### Heading\n\n\`\`\`ts\nconst next = 2;`); await frame();
    expect(root.querySelectorAll('pre')).toHaveLength(2);
    expect(root.querySelectorAll('pre')[1].textContent).toContain('const next = 2;');
    setContent(`${content()}\n\`\`\``); await frame();
    expect(root.querySelector('.flower-chat-md-raw-tail')).toBeNull();
    expect(root.querySelectorAll('pre')).toHaveLength(2);
    setStreaming(false); await frame();
    expect(root.querySelector('.flower-chat-md-tail-frame')).toBeNull();
    expect(root.querySelectorAll('button')).toHaveLength(2);
    setContent(''); await frame(); expect(root.textContent).toBe('');
  });
});
