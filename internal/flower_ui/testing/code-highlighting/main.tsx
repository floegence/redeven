import { FloeProvider, useTheme } from '@floegence/floe-webapp-core';
import '../../src/styles/flower.css';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { FlowerMarkdownBlock } from '../../src/chat/markdown/FlowerMarkdownBlock';

const source = 'def weather(city):\n    return "sunny"  # forecast';
const prefix = `\`\`\`python\n${source}\n\`\`\`\n\n`;
const [content, setContent] = createSignal(`${prefix}Streaming response`);
const [history, setHistory] = createSignal<string[]>([]);
let requests = 0;
const originalPost = Worker.prototype.postMessage;
Worker.prototype.postMessage = function (...args: Parameters<Worker['postMessage']>) { requests++; return originalPost.apply(this, args); };
let setTheme!: (theme: 'light' | 'dark') => void;
function Content() {
  const theme = useTheme();
  setTheme = theme.setTheme;
  setTheme('light');
  return <main class="flower-chat-shell" style="display:block;padding:16px;max-width:900px;margin:auto;height:auto">
  <div id="current"><FlowerMarkdownBlock content={content()} streaming copyCodeLabel="Copy code" codeCopiedLabel="Copied" /></div>
  <div id="history"><For each={history()}>{(text) => <FlowerMarkdownBlock content={text} copyCodeLabel="Copy code" codeCopiedLabel="Copied" />}</For></div>
</main>;
}
const dispose = render(() => <FloeProvider><Content /></FloeProvider>, document.getElementById('root')!);
const code = document.querySelector('code')!;
const range = document.createRange(); range.selectNodeContents(code); window.getSelection()!.addRange(range);
const tasks: number[] = [];
const observer = new PerformanceObserver((entries) => tasks.push(...entries.getEntries().map((entry) => entry.duration)));
observer.observe({ type: 'longtask' });
const api = {
  source,
  theme: (mode: 'light' | 'dark') => setTheme(mode),
  requests: () => requests,
  append: (index: number) => setContent(`${prefix}Streaming response ${index}`),
  history: () => setHistory(Array.from({ length: 200 }, (_, index) => `\`\`\`js\nconst history = ${index};\n\`\`\``)),
  large: () => setHistory([`\`\`\`js\n${'const value = true;\n'.repeat(300)}\`\`\``]),
  clearTasks: () => { tasks.length = 0; },
  tasks: () => [...tasks],
  dispose: () => { observer.disconnect(); dispose(); Worker.prototype.postMessage = originalPost; },
};
Object.assign(window, { flowerHighlight: api });
