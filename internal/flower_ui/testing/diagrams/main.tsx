import { FloeProvider, useTheme } from '@floegence/floe-webapp-core';
import { DialogPlacementProvider } from '@floegence/floe-webapp-core/ui';
import '../../src/styles/flower.css';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { FlowerMarkdownBlock } from '../../src/chat/markdown/FlowerMarkdownBlock';
import { diagramEnUS } from '../../src/chat/markdown/diagramCopy';

const fence = String.fromCharCode(96).repeat(3);
const source = 'flowchart LR\n A[Start] -->|request| B{Decision}\n B -->|yes| C[Finish]';
const closed = fence + 'mermaid\n' + source + '\n' + fence;
const [content, setContent] = createSignal(fence + 'mermaid\n' + source);
const [streaming, setStreaming] = createSignal(true);
const [history, setHistory] = createSignal<string[]>([]);
let setTheme!: (theme: 'light' | 'dark') => void;
function Content() {
  const theme = useTheme(); setTheme = theme.setTheme; setTheme('light');
  return <main class="flower-chat-shell" style="display:block;padding:16px;max-width:900px;margin:auto;height:auto">
    <input id="draft" aria-label="Draft" value="Retain this draft" />
    <DialogPlacementProvider mode="global" globalZIndex={1234}>
      <div id="current"><FlowerMarkdownBlock content={content()} streaming={streaming()} diagramLabels={diagramEnUS} copyCodeLabel="Copy code" codeCopiedLabel="Copied" /></div>
      <div id="history"><For each={history()}>{text => <FlowerMarkdownBlock content={text} diagramLabels={diagramEnUS} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />}</For></div>
    </DialogPlacementProvider>
  </main>;
}
const dispose = render(() => <FloeProvider><Content /></FloeProvider>, document.getElementById('root')!);
const tasks: number[] = [];
const observer = new PerformanceObserver(entries => tasks.push(...entries.getEntries().map(entry => entry.duration)));
observer.observe({ type: 'longtask' });
Object.assign(window, { flowerDiagrams: {
  source,
  close: () => setContent(closed + '\n\nStreaming response'),
  append: (index: number) => setContent(closed + '\n\nStreaming response ' + index),
  finish: () => setStreaming(false),
  reset: () => { setContent(closed + '\n\nSnapshot replacement'); setStreaming(false); },
  replace: (text: string) => { setContent(fence + 'mermaid\n' + text + '\n' + fence); setStreaming(false); },
  theme: (mode: 'light' | 'dark') => setTheme(mode),
  history: () => setHistory(Array.from({length:100}, (_, i) => fence + 'mermaid\nflowchart LR\n N' + i + ' --> End\n' + fence)),
  clearTasks: () => { tasks.length = 0; }, tasks: () => [...tasks],
  dispose: () => { observer.disconnect(); dispose(); },
} });
