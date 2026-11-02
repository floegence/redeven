import '../index.css';
import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowerMarkdownBlock } from '../../../../flower_ui/src/chat/markdown/FlowerMarkdownBlock';
import { diagramEnUS } from '../../../../flower_ui/src/chat/markdown/diagramCopy';

let dispose: (() => void) | undefined;
let root: HTMLDivElement;
const fence = String.fromCharCode(96).repeat(3);
const source = 'flowchart LR\n A[Source] --> B[Result]';
const markdown = (text: string) => fence + 'mermaid\n' + text + '\n' + fence;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const mount = (component: () => JSX.Element) => { root = document.createElement('div'); root.style.width = '600px'; document.body.append(root); dispose = render(component, root); };
const ready = () => vi.waitFor(() => expect(root.querySelector('.floe-diagram-svg > svg')).toBeTruthy(), {timeout:15000});
afterEach(() => { dispose?.(); dispose=undefined; document.body.replaceChildren(); window.getSelection()?.removeAllRanges(); document.documentElement.classList.remove('dark','light'); document.documentElement.removeAttribute('data-floe-shell-theme'); });

it('renders only a closed fence and retains the diagram across growth, completion and snapshots', async () => {
  const [content,setContent] = createSignal(fence + 'mermaid\n' + source);
  const [streaming,setStreaming] = createSignal(true);
  mount(() => <FlowerMarkdownBlock content={content()} streaming={streaming()} diagramLabels={diagramEnUS} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
  await frame(); expect(root.querySelector('.floe-diagram')).toBeNull();
  expect(root.querySelector('code')?.textContent).toBe(source);
  setContent(markdown(source)+'\n\nTail'); await ready();
  const svg = root.querySelector('.floe-diagram-svg > svg')!;
  const selection = window.getSelection()!; const range=document.createRange();range.selectNodeContents(svg.querySelector('text')!);selection.addRange(range);
  const selected=selection.toString(); expect(selected.length).toBeGreaterThan(0);
  for(let i=0;i<30;i++) { setContent(markdown(source)+'\n\nTail '+i); await frame(); }
  setStreaming(false); await frame();
  expect(root.querySelector('.floe-diagram-svg > svg')).toBe(svg);
  expect(selection.toString()).toBe(selected);
  selection.removeAllRanges(); setContent(markdown(source)+'\n\nReconnected'); await frame();
  expect(root.querySelector('.floe-diagram-svg > svg')).toBe(svg);
});

it('keeps interrupted fences as source and recovers from an invalid closed diagram', async () => {
  const [content,setContent] = createSignal(fence+'mermaid\n'+source);
  mount(() => <FlowerMarkdownBlock content={content()} diagramLabels={diagramEnUS} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
  await frame(); expect(root.querySelector('.floe-diagram')).toBeNull();
  setContent(markdown('flowchart LR\n A[invalid'));
  await vi.waitFor(() => expect(root.querySelector('[role=alert]')).toBeTruthy(), {timeout:15000});
  expect(root.querySelector('[role=alert]')?.textContent).toContain('A[invalid');
  setContent(markdown(source)); await ready(); expect(root.querySelector('[role=alert]')).toBeNull();
  setContent('Replaced'); await frame(); expect(root.querySelector('.floe-diagram')).toBeNull();
});

it('applies every product palette through CSS without replacing selected SVG or source', async () => {
  mount(() => <FlowerMarkdownBlock content={markdown(source)} diagramLabels={diagramEnUS} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />);
  await ready(); const svg=root.querySelector('.floe-diagram-svg > svg')!;
  const range=document.createRange();range.selectNodeContents(svg.querySelector('text')!);window.getSelection()!.addRange(range);
  const selected=window.getSelection()!.toString();
  const palette=new Set<string>();
  for(const theme of builtInShellThemePresets) {
    document.documentElement.classList.toggle('dark',theme.mode==='dark');document.documentElement.classList.toggle('light',theme.mode==='light');
    document.documentElement.dataset.floeShellTheme=theme.name; await frame();
    expect(root.querySelector('.floe-diagram-svg > svg')).toBe(svg);
    expect(window.getSelection()!.toString()).toBe(selected);
    const style=getComputedStyle(svg);palette.add(style.getPropertyValue('--pele-fg'));
    expect(style.getPropertyValue('--pele-series-1').trim()).not.toBe('');
  }
  expect(palette.size).toBeGreaterThan(1);
});
