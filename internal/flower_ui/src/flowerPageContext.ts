import type { FlowerPageContextSnapshot } from './composer/createFlowerComposerDraftCoordinator';

export type FlowerPageContextState = Readonly<Record<string, unknown>>;
export type FlowerPageContextRegistrar = (read: () => FlowerPageContextState | undefined) => void;
const MAX_PAGE_CONTEXT_CHARS = 6000;

/** One bounded, readable projection for the chip preview and admitted reference. */
export function flowerPageContextSnapshot(input: {
  environmentID: string;
  environmentName: string;
  pageID: string;
  pageName: string;
  state?: FlowerPageContextState;
  capturedAtMs: number;
}): FlowerPageContextSnapshot {
  const identity = (name: string, id: string) => name === id || !id ? name : `${name} (${id})`;
  const lines = [identity(input.pageName, input.pageID), identity(input.environmentName, input.environmentID)].filter(Boolean);
  const facts: string[] = [];
  const append = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => append(`${key}[${index + 1}]`, entry));
    } else if (typeof value === 'object') {
      Object.entries(value).forEach(([child, entry]) => append(`${key}.${child}`, entry));
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      facts.push(`${key}: ${value}`);
    }
  };
  // Explicit text selection and resource identity take priority over view metadata.
  const state = input.state ?? {};
  const priority = ['kind', 'subject', 'surface', 'selection', 'session', 'path', 'directory', 'repository'];
  for (const key of [...priority.filter(key => key in state), ...Object.keys(state).filter(key => !priority.includes(key) && key !== 'screen_text')]) append(key, state[key]);
  const base = [...lines, ...(facts.length ? ['', ...facts] : [])].join('\n');
  const screen = typeof state.screen_text === 'string' ? state.screen_text : '';
  let content = base;
  if (screen) {
    const prefix = `${base}\n\nscreen_text:\n`;
    const available = Math.max(0, MAX_PAGE_CONTEXT_CHARS - Array.from(prefix).length);
    const chars = Array.from(screen);
    const tail = available > 2 ? chars.slice(-(available - 2)).join('') : '';
    content = prefix + (chars.length <= available ? screen : `…\n${tail}`);
  }
  const chars = Array.from(content);
  if (chars.length > MAX_PAGE_CONTEXT_CHARS) content = chars.slice(0, MAX_PAGE_CONTEXT_CHARS - 2).join('') + '\n…';
  return { label: input.pageName, title: input.pageName, content };
}
