import { createEffect, createMemo, createSignal, type Accessor } from 'solid-js';
import { DEFAULT_TERMINAL_FONT_FAMILY_ID } from './terminalGeometry';

export type TerminalFontOption = Readonly<{
  id: string;
  label: string;
  kind: 'bundled' | 'local';
  family: string;
}>;

const font = (id: string, label: string, kind: TerminalFontOption['kind']): TerminalFontOption => ({
  id, label, kind, family: `"Redeven Terminal ${id}", monospace`,
});

export const TERMINAL_FONT_OPTIONS: readonly TerminalFontOption[] = [
  font('jetbrains', 'JetBrains Mono', 'bundled'),
  font('iosevka', 'Iosevka', 'bundled'),
  font('cascadia-mono', 'Cascadia Mono', 'local'),
  font('consolas', 'Consolas', 'local'),
  font('dejavu-sans-mono', 'DejaVu Sans Mono', 'local'),
  font('liberation-mono', 'Liberation Mono', 'local'),
  font('ubuntu-mono', 'Ubuntu Mono', 'local'),
  font('sfmono', 'SF Mono', 'local'),
  font('menlo', 'Menlo', 'local'),
  font('monaco', 'Monaco', 'local'),
];

// This literal intentionally mixes code and Chinese to preview wide-cell fallback.
export const TERMINAL_FONT_PREVIEW_SAMPLE = '0O 1lI [] {} -> !=\n$ ls -la ~/src  文件 中文';
type LoadState = 'idle' | 'loading' | 'ready' | 'unavailable';
export type ResolvedTerminalFont = Readonly<{
  requestedID: string;
  requestedLabel: string;
  effectiveID: string | null;
  effectiveLabel: string | null;
  family: string;
  status: 'loading' | 'ready' | 'fallback' | 'failed';
}>;

async function loadTerminalFont(option: TerminalFontOption): Promise<void> {
  if (typeof FontFace === 'undefined' || !globalThis.document?.fonts) {
    throw new Error('Font loading is unavailable');
  }
  const sources = option.kind === 'bundled'
    ? (await import('./terminalFontAssets')).terminalBundledFontSources[option.id]!
    : [{ source: `local("${option.label}")`, unicodeRange: undefined }];
  // A private family prevents same-named system fonts from replacing bundled files.
  // Explicit local() loading detects availability without trusting fallback metrics
  // or requesting permission to enumerate the user's entire font collection.
  const faces = await Promise.all(sources.map(({ source, unicodeRange }) => new FontFace(
    `Redeven Terminal ${option.id}`, source, { weight: '400', style: 'normal', ...(unicodeRange ? { unicodeRange } : {}) },
  ).load()));
  for (const face of faces) document.fonts.add(face);
}

/** One document-local owner for font loading and resolution; never persists preferences. */
export function createTerminalFontCatalog(load: (option: TerminalFontOption) => Promise<void> = loadTerminalFont) {
  const [states, setStates] = createSignal<Readonly<Record<string, LoadState>>>({});
  const pending = new Map<string, Promise<void>>();
  const state = (id: string): LoadState => states()[id] ?? 'idle';
  const ensure = (id: string, retry = false): Promise<void> => {
    const option = TERMINAL_FONT_OPTIONS.find((candidate) => candidate.id === id);
    if (!option) return Promise.resolve();
    const existing = pending.get(id);
    if (existing) return existing;
    if (state(id) === 'ready' || (state(id) === 'unavailable' && !retry)) return Promise.resolve();
    setStates((current) => ({ ...current, [id]: 'loading' }));
    const work = Promise.resolve().then(() => load(option)).then(
      () => setStates((current) => ({ ...current, [id]: 'ready' })),
      () => setStates((current) => ({ ...current, [id]: 'unavailable' })),
    ).then(() => { pending.delete(id); });
    pending.set(id, work);
    return work;
  };
  const resolve = (requestedID: string): ResolvedTerminalFont => {
    const requested = TERMINAL_FONT_OPTIONS.find((option) => option.id === requestedID);
    const fallback = TERMINAL_FONT_OPTIONS.find((option) => option.id === DEFAULT_TERMINAL_FONT_FAMILY_ID)!;
    const effective = requested && state(requested.id) === 'ready' ? requested
      : state(fallback.id) === 'ready' ? fallback : null;
    const loading = (requested && ['idle', 'loading'].includes(state(requested.id)))
      || (!effective && ['idle', 'loading'].includes(state(fallback.id)));
    return {
      requestedID,
      requestedLabel: requested?.label ?? requestedID,
      effectiveID: effective?.id ?? null,
      effectiveLabel: effective?.label ?? null,
      family: effective?.family ?? 'monospace',
      status: loading ? 'loading' : !effective ? 'failed' : effective.id === requestedID ? 'ready' : 'fallback',
    };
  };
  const prepare = async (id: string, retry = false) => {
    await Promise.all([ensure(id, retry), ensure(DEFAULT_TERMINAL_FONT_FAMILY_ID, retry)]);
  };
  return { state, ensure, prepare, resolve };
}

export const terminalFontCatalog = createTerminalFontCatalog();

export function createResolvedTerminalFont(id: Accessor<string>): Accessor<ResolvedTerminalFont> {
  createEffect(() => { void terminalFontCatalog.prepare(id()); });
  // Resolve from the current preference, not from an async completion callback.
  // A slower previous selection therefore cannot replace the latest selection.
  return createMemo(() => terminalFontCatalog.resolve(id()));
}
