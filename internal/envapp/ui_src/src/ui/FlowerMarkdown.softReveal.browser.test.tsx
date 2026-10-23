import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { FlowerMarkdownBlock } from '../../../../flower_ui/src/chat/markdown/FlowerMarkdownBlock';
import { createStreamingTextReveal } from '../../../../flower_ui/src/chat/markdown/streamingTextReveal';
import '../../../../flower_ui/src/styles/flower.css';

const media = commands as unknown as { emulateMediaPreferences(value: { reducedMotion?: 'reduce' | 'no-preference'; forcedColors?: 'active' | 'none' }): Promise<void> };
let dispose: (() => void) | undefined;
let root: HTMLDivElement;
const highlights = () => [...CSS.highlights].filter(([name]) => name.startsWith('flower-stream-'));
const revealed = () => highlights().flatMap(([, highlight]) => [...highlight].map(range => (range as Range).toString())).join('');
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
function mount(initial = '') {
  const [content, setContent] = createSignal(initial);
  const [streaming, setStreaming] = createSignal(true);
  root = document.createElement('div');
  root.style.cssText = 'width:320px;color:rgb(35,65,48)';
  document.body.append(root);
  dispose = render(() => <FlowerMarkdownBlock content={content()} streaming={streaming()} copyCodeLabel="Copy" codeCopiedLabel="Copied" />, root);
  return { setContent, setStreaming };
}
afterEach(async () => {
  dispose?.(); dispose = undefined; root?.remove();
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' });
});

it('reveals appended text while retaining selection and exact Unicode content', async () => {
  const { setContent, setStreaming } = mount('Already read');
  expect(highlights()).toHaveLength(0);
  const paragraph = root.querySelector('p')!;
  const text = paragraph.firstElementChild!.firstChild!;
  const selected = new Range(); selected.selectNodeContents(text);
  window.getSelection()!.addRange(selected);
  const selectedText = window.getSelection()!.toString();
  setContent(value => value + ' — 新内容 é👩‍💻');
  await frame();
  expect(revealed()).toBe(' — 新内容 é👩‍💻');
  expect(paragraph.firstElementChild!.firstChild).toBe(text);
  expect(window.getSelection()!.toString()).toBe(selectedText);
  expect(paragraph.textContent).toBe('Already read — 新内容 é👩‍💻');
  expect(root.scrollWidth).toBeLessThanOrEqual(320);
  setStreaming(false);
  await expect.poll(() => highlights().length).toBe(0);
  expect(root.querySelector('p')!.textContent).toBe('Already read — 新内容 é👩‍💻');
});

it('reveals new headings and list text without reanimating their prefix or corrected snapshots', async () => {
  const { setContent } = mount('Intro\n\n');
  setContent('Intro\n\n## Heading\n\n- First');
  await frame();
  expect(revealed()).toContain('Heading');
  await expect.poll(() => highlights().length).toBe(0);
  setContent('Intro\n\n## Heading\n\n- First\n- **Second**');
  await frame();
  expect(revealed()).toContain('Second');
  expect(revealed()).not.toContain('First');
  setContent('A corrected snapshot');
  await frame();
  expect(highlights()).toHaveLength(0);
  expect(root.querySelector('p')!.textContent).toBe('A corrected snapshot');
});

it('bounds transient effects during rapid appends and removes them on unmount', async () => {
  const { setContent } = mount();
  for (let i = 0; i < 120; i++) { setContent(value => value + 'word '); await Promise.resolve(); }
  await frame();
  expect(highlights().length).toBeGreaterThan(0);
  expect(highlights().length).toBeLessThanOrEqual(32);
  dispose?.(); dispose = undefined;
  expect(highlights()).toHaveLength(0);
  expect(root.querySelector('.flower-chat-md-content')?.getAttribute('style') ?? '').not.toContain('--flower-stream-ink');
});

it('settles immediately when motion or high contrast preferences change', async () => {
  const { setContent } = mount();
  setContent('New text'); await frame();
  expect(highlights().length).toBeGreaterThan(0);
  await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  await expect.poll(() => highlights().length).toBe(0);
  setContent(value => value + ' immediately readable'); await frame();
  expect(highlights()).toHaveLength(0);
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'active' });
  setContent(value => value + ' high contrast'); await frame();
  expect(highlights()).toHaveLength(0);
});

it('fades smoothly in place, leaves earlier ranges fixed and releases paint state after completion', async () => {
  root = document.createElement('div'); root.className = 'flower-chat-md-content'; root.style.color = 'rgb(35,65,48)'; document.body.append(root);
  root.textContent = 'Stable';
  const text = root.firstChild as Text;
  const reveal = createStreamingTextReveal(root); dispose = reveal.dispose;
  reveal.begin(true, false); reveal.begin(true, false);
  const selected = new Range(); selected.selectNodeContents(text); window.getSelection()!.addRange(selected);
  reveal.append(root, 6, () => text.appendData(' first'));
  const first = [...highlights()[0][1]][0] as Range;
  const color = () => getComputedStyle(root, '::highlight(' + highlights()[0][0] + ')').color;
  const initial = color();
  for (let i = 0; i < 4; i++) await frame();
  expect(color()).not.toBe(initial);
  reveal.append(root, 7, () => text.appendData(' second'));
  expect(first.toString()).toBe(' first');
  expect(window.getSelection()!.toString()).toBe('Stable');
  expect(root.childNodes).toHaveLength(1);
  reveal.begin(false, false);
  expect(highlights().length).toBeGreaterThan(0);
  await expect.poll(() => highlights().length).toBe(0);
  expect(root.querySelector('.flower-chat-md-content')?.getAttribute('style') ?? '').not.toContain('--flower-stream-ink');
  expect(root.textContent).toBe('Stable first second');
});

it('follows text color changes without synchronously reading styles during animation', async () => {
  root = document.createElement('div'); root.className = 'flower-chat-md-content';
  root.style.color = 'rgb(35,65,48)'; document.body.append(root);
  const reveal = createStreamingTextReveal(root); dispose = reveal.dispose;
  reveal.begin(true, false); reveal.begin(true, false);
  const readStyle = window.getComputedStyle.bind(window);
  const styleReads = vi.spyOn(window, 'getComputedStyle');
  reveal.append(root, 5, () => root.append('Hello'));
  await frame();
  const first = readStyle(root, '::highlight(' + highlights()[0][0] + ')').color;
  root.style.color = 'rgb(180,30,90)';
  await frame();
  expect(readStyle(root, '::highlight(' + highlights()[0][0] + ')').color).not.toBe(first);
  expect(styleReads).not.toHaveBeenCalled();
  expect(root.textContent).toBe('Hello');
});

it('keeps link colors, code and media controls outside the prose effect', async () => {
  const { setContent } = mount('Intro\n\n');
  const fence = String.fromCharCode(96).repeat(3);
  setContent('Intro\n\nBody [link](https://example.com)\n\n' + fence + 'text\ncode\n' + fence);
  await frame();
  expect(revealed()).toContain('Body');
  expect(revealed()).not.toContain('link');
  expect(revealed()).not.toContain('code');
  expect(revealed()).not.toContain('Copy');
  expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  expect(root.querySelector('code')?.textContent).toBe('code');
});

it('keeps another active answer animated when one owner unmounts and skips oversized bursts', async () => {
  root = document.createElement('div'); document.body.append(root);
  const first = document.createElement('div'), second = document.createElement('div');
  first.className = second.className = 'flower-chat-md-content'; root.append(first, second);
  const a = createStreamingTextReveal(first), b = createStreamingTextReveal(second);
  dispose = () => { a.dispose(); b.dispose(); };
  for (const owner of [a, b]) { owner.begin(true, false); owner.begin(true, false); }
  a.append(first, 5, () => first.append('First'));
  b.append(second, 6, () => second.append('Second'));
  a.dispose();
  expect(revealed()).toBe('Second');
  await expect.poll(() => highlights().length).toBe(0);
  const large = '字'.repeat(8193);
  b.append(second, large.length, () => second.append(large));
  expect(highlights()).toHaveLength(0);
  expect(second.textContent).toBe('Second' + large);
});

it('keeps the first paint phase when the frame timestamp precedes the append', () => {
  root = document.createElement('div'); root.className = 'flower-chat-md-content'; document.body.append(root);
  let callback: FrameRequestCallback | undefined;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(next => { callback = next; return 1; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const reveal = createStreamingTextReveal(root); dispose = reveal.dispose;
  reveal.begin(true, false); reveal.begin(true, false);
  const frameTime = performance.now() - 16;
  reveal.append(root, 5, () => root.append('Hello'));
  callback!(frameTime);
  expect(highlights().map(([name]) => name)).toEqual(['flower-stream-0']);
  expect(getComputedStyle(root, '::highlight(flower-stream-0)').color).toContain('/ 0.12');
});
