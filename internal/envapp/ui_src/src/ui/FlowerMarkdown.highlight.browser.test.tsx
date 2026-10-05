import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowerMarkdownBlock } from '../../../../flower_ui/src/chat/markdown/FlowerMarkdownBlock';
import { flowerMarkdownCodeTextForCopyButton } from '../../../../flower_ui/src/chat/markdown/codeBlockCopy';
import '../../../../flower_ui/src/styles/flower.css';

let dispose: (() => void) | undefined;
let root: HTMLDivElement;
afterEach(() => { dispose?.(); dispose = undefined; root?.remove(); vi.restoreAllMocks(); window.getSelection()?.removeAllRanges(); });
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
function mount(view: () => JSX.Element, width = 720) {
  root = document.createElement('div');
  root.style.cssText = `width:${width}px;max-width:100%;color-scheme:light`;
  document.body.append(root);
  dispose = render(view, root);
}
const highlighted = (count = 1) => expect.poll(() => root.querySelectorAll('code[data-floe-code-highlighted]').length, { timeout: 10_000 }).toBe(count);
const markdown = (text: string, language = 'python') => `\`\`\`${language}\n${text}\n\`\`\``;
const weather = 'def weather(city):\n    return "sunny"';

it('automatically colors completed Python and Bash fences with the published highlighter', async () => {
  mount(() => <FlowerMarkdownBlock content={`${markdown(weather)}\n\n${markdown('python weather.py --city London', 'bash')}`} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
  await highlighted(2);
  expect(new Set(Array.from(root.querySelectorAll('code span'), (node) => getComputedStyle(node).color)).size).toBeGreaterThan(1);
  expect(root.querySelector('code')?.textContent).toBe(weather);
});

it('retains colored code, selection, focus and copy controls across 300 alternating stream updates', async () => {
  const prefix = `${markdown(weather)}\n\n`;
  const [content, setContent] = createSignal(`${prefix}Tail`);
  const [streaming, setStreaming] = createSignal(true);
  mount(() => <FlowerMarkdownBlock content={content()} streaming={streaming()} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
  await highlighted();
  const code = root.querySelector('code')!;
  const button = root.querySelector<HTMLButtonElement>('button')!;
  const firstToken = code.querySelector('span')!;
  const selection = window.getSelection()!;
  const range = document.createRange(); range.selectNodeContents(code); selection.addRange(range);
  button.focus();
  const mutations: MutationRecord[] = [];
  const observer = new MutationObserver((records) => mutations.push(...records));
  observer.observe(button.parentElement!, { childList: true, subtree: true, characterData: true });
  const post = vi.spyOn(Worker.prototype, 'postMessage');
  for (let index = 0; index < 300; index++) {
    setContent(`${prefix}${index % 2 ? '**More**' : 'Tail'} ${index}`);
    if (index % 10 === 0) await frame();
  }
  setStreaming(false); await frame(); observer.disconnect();
  expect(root.querySelector('code')).toBe(code);
  expect(code.querySelector('span')).toBe(firstToken);
  expect(root.querySelector('button')).toBe(button);
  expect(document.activeElement).toBe(button);
  expect(selection.toString()).toBe(weather);
  expect(flowerMarkdownCodeTextForCopyButton(button)).toBe(weather);
  expect(mutations).toHaveLength(0);
  expect(post).not.toHaveBeenCalled();
});

it('leaves growing and nested HTML tails uncolored, then colors finalized interrupted output', async () => {
  const [content, setContent] = createSignal('```python\ndef weather');
  const [streaming, setStreaming] = createSignal(true);
  mount(() => <FlowerMarkdownBlock content={content()} streaming={streaming()} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
  await frame();
  const raw = root.querySelector('.flower-chat-md-raw-tail')!;
  const node = raw.firstChild;
  for (let index = 0; index < 50; index++) { setContent((value) => `${value}x`); await frame(); }
  expect(raw.firstChild).toBe(node);
  expect(root.querySelector('code span')).toBeNull();
  setContent('> ```python\n> def quoted():\n>     return True'); await frame();
  expect(root.querySelector('.flower-chat-md-tail-frame code')?.textContent).toContain('def quoted');
  expect(root.querySelector('code span')).toBeNull();
  setStreaming(false);
  await highlighted();
  expect(root.querySelector('code')?.textContent).toBe('def quoted():\n    return True');
});

it('discards pending results across replacement, retry, clear and unmount', async () => {
  const [content, setContent] = createSignal(markdown(weather));
  mount(() => <FlowerMarkdownBlock content={content()} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
  for (let index = 0; index < 24; index++) {
    setContent(index % 3 === 0 ? '' : markdown(`const attempt = ${index};`, 'ts'));
    await frame();
  }
  setContent(markdown('echo "latest"', 'sh'));
  await highlighted();
  expect(root.querySelector('code')?.textContent).toBe('echo "latest"');
  expect(root.querySelectorAll('pre')).toHaveLength(1);
  setContent(markdown('const removed = 1;', 'js')); await Promise.resolve();
  dispose?.(); dispose = undefined; await frame();
  expect(root.textContent).toBe('');
});

it('colors fence aliases and metadata while leaving inline, unknown and oversized code readable', async () => {
  const blocks = [markdown('print("weather")', 'Python title=weather.py'), markdown('int main() { return 0; }', 'c++'), markdown('public class Weather {}', 'c#'), markdown('literal <script> text', 'unknown-language'), markdown('plain text', ''), markdown('x'.repeat(32_769), 'python')];
  mount(() => <FlowerMarkdownBlock content={`Inline \`const n = 1\`\n\n${blocks.join('\n\n')}`} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
  await highlighted(3);
  const codes = root.querySelectorAll('pre > code');
  expect([...codes].slice(3).map((code) => code.children.length)).toEqual([0, 0, 0]);
  expect(root.querySelector('.flower-chat-md-inline-code')?.children.length).toBe(0);
  expect(codes[3].textContent).toBe('literal <script> text');
  expect(codes[5].textContent).toHaveLength(32_769);
});

it.each([360, 1000])('preserves geometry, scroll and selection through delayed colors and themes at %i px', async (width) => {
  // Unicode is intentional: verify exact code and clipboard content across scripts.
  const source = '# Forecast\nprint("<script>世界</script>")\n' + ' '.repeat(60) + 'print(True)';
  mount(() => <FlowerMarkdownBlock content={markdown(source)} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />, width);
  await Promise.resolve();
  const code = root.querySelector('code')!;
  const pre = root.querySelector('pre')!;
  const button = root.querySelector<HTMLButtonElement>('button')!;
  const range = document.createRange(); range.selectNodeContents(code); window.getSelection()!.addRange(range);
  pre.scrollLeft = 100;
  const geometry = () => { const bounds = pre.getBoundingClientRect(); return [bounds.width, bounds.height, pre.scrollWidth, pre.scrollLeft, button.getBoundingClientRect().top]; };
  const before = geometry();
  for (let index = 0; index < 6; index++) await frame();
  expect(code.children).toHaveLength(0);
  expect(window.getSelection()!.toString()).toBe(source);
  window.getSelection()!.removeAllRanges();
  await highlighted();
  expect(geometry()).toEqual(before);
  expect(code.textContent).toBe(source);
  const first = code.querySelector('span')!;
  const colors = () => [...code.querySelectorAll('span')].map((node) => getComputedStyle(node).color);
  const lightColors = colors();
  range.selectNodeContents(code); window.getSelection()!.addRange(range);
  root.style.colorScheme = 'dark'; await frame();
  expect(code.querySelector('span')).toBe(first);
  expect(colors()).not.toEqual(lightColors);
  expect(window.getSelection()!.toString()).toBe(source);
  expect(geometry()).toEqual(before);
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  button.click();
  await expect.poll(() => write.mock.calls.length).toBe(1);
  expect(write).toHaveBeenCalledWith(source);
  expect(button.getAttribute('aria-label')).toBe('Copied');
});

it('defers offscreen history until it enters the scroll viewport', async () => {
  const post = vi.spyOn(Worker.prototype, 'postMessage');
  mount(() => <div style="height:120px;overflow:auto"><div style="height:1500px" /><FlowerMarkdownBlock content={markdown(weather)} copyCodeLabel="Copy code" codeCopiedLabel="Copied" /></div>);
  for (let index = 0; index < 5; index++) await frame();
  expect(post).not.toHaveBeenCalled();
  expect(root.querySelector('code span')).toBeNull();
  root.querySelector('code')!.scrollIntoView();
  await highlighted();
  expect(post).toHaveBeenCalledTimes(1);
});
