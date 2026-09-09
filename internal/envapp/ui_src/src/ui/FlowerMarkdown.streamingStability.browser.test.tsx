import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppendOnlyText } from '../../../../flower_ui/src/chat/markdown/AppendOnlyText';
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
  it('uses one Text node through 10,000 separately flushed appends and detects early replacements', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextID = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callbacks.set(++nextID, callback); return nextID; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { callbacks.delete(id); });
    const flush = () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach((callback) => callback(0)); };
    const [text, setText] = createSignal('initial text');
    mount(() => <AppendOnlyText text={text()} />);
    flush();
    const node = root.querySelector('span')!.firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 7); selection.addRange(range);
    for (let index = 0; index < 10_000; index += 1) { setText((value) => `${value}x`); flush(); }
    expect(root.querySelector('span')!.childNodes.length).toBe(1);
    expect(root.querySelector('span')!.firstChild).toBe(node);
    expect(root.textContent).toBe(text());
    expect(selection.toString()).toBe('initial');
    setText(`changed text${'x'.repeat(10_000)}`); flush();
    expect(root.textContent).toBe(text());
    expect(root.querySelector('span')!.firstChild).toBe(node);
    setText(''); flush(); expect(root.textContent).toBe('');
    setText('pending'); dispose?.(); dispose = undefined;
    expect(callbacks.size).toBe(0);
  });

  it('keeps completed code controls mounted and switches raw, HTML and empty tails correctly', async () => {
    const prefix = '```js\nconst stable = 1;\n```\n\n';
    const [content, setContent] = createSignal(`${prefix}Tail`);
    const [streaming, setStreaming] = createSignal(true);
    mount(() => <FlowerMarkdownBlock content={content()} streaming={streaming()} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
    await frame();
    const button = root.querySelector<HTMLButtonElement>('button')!;
    const segment = button.closest('.flower-chat-md-committed-segment')!;
    button.focus();
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records)); observer.observe(segment, { childList: true, subtree: true });
    for (let index = 0; index < 300; index += 1) { setContent(`${prefix}Tail ${index}`); await Promise.resolve(); }
    await frame(); observer.disconnect();
    expect(root.querySelector('button')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(mutations).toHaveLength(0);
    expect(flowerMarkdownCodeTextForCopyButton(button)).toBe('const stable = 1;');
    setContent(`${prefix}### Heading\n\n\`\`\`ts\nconst next = 2;`); await frame();
    expect(root.querySelector('.flower-chat-md-raw-tail')?.textContent).toBe('```ts\nconst next = 2;');
    setContent(`${content()}\n\`\`\``); await frame();
    expect(root.querySelector('.flower-chat-md-raw-tail')).toBeNull();
    expect(root.querySelectorAll('pre')).toHaveLength(2);
    setStreaming(false); await frame();
    expect(root.querySelector('.flower-chat-md-tail-frame')).toBeNull();
    expect(root.querySelectorAll('button')).toHaveLength(2);
    setContent(''); await frame(); expect(root.textContent).toBe('');
  });
});
