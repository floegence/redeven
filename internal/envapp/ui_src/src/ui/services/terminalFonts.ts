import { createEffect, createMemo, createSignal, type Accessor } from 'solid-js';
import { DEFAULT_TERMINAL_FONT_FAMILY_ID } from './terminalGeometry';

export type TerminalFontOption = Readonly<{
  id: string;
  label: string;
  kind: 'bundled' | 'local';
  family: string;
  localNames?: readonly string[];
}>;

const font = (id: string, label: string, kind: TerminalFontOption['kind'], localNames?: readonly string[]): TerminalFontOption => ({
  id, label, kind, family: `"Redeven Terminal ${id}", monospace`, ...(localNames ? { localNames } : {}),
});

export const TERMINAL_FONT_OPTIONS: readonly TerminalFontOption[] = [
  font('jetbrains', 'JetBrains Mono', 'bundled'),
  font('iosevka', 'Iosevka', 'bundled'),
  font('source-code-pro', 'Source Code Pro', 'bundled'),
  font('ibm-plex-mono', 'IBM Plex Mono', 'bundled'),
  font('cascadia-mono', 'Cascadia Mono', 'local', ['Cascadia Mono', 'Cascadia Mono Regular', 'CascadiaMono-Regular']),
  font('consolas', 'Consolas', 'local'),
  font('dejavu-sans-mono', 'DejaVu Sans Mono', 'local', ['DejaVu Sans Mono', 'DejaVuSansMono']),
  font('liberation-mono', 'Liberation Mono', 'local', ['Liberation Mono', 'LiberationMono', 'LiberationMono-Regular']),
  font('ubuntu-mono', 'Ubuntu Mono', 'local', ['Ubuntu Mono', 'Ubuntu Mono Regular', 'UbuntuMono-Regular']),
  font('sfmono', 'SF Mono', 'local', ['SF Mono', 'SF Mono Regular', 'SFMono-Regular']),
  font('menlo', 'Menlo', 'local', ['Menlo', 'Menlo Regular', 'Menlo-Regular']),
  font('monaco', 'Monaco', 'local'),
  font('cascadia-code', 'Cascadia Code', 'local', ['Cascadia Code', 'Cascadia Code Regular', 'CascadiaCode-Regular']),
  font('fira-code', 'Fira Code', 'local', ['Fira Code', 'Fira Code Regular', 'FiraCode-Regular']),
  font('fira-mono', 'Fira Mono', 'local', ['Fira Mono', 'Fira Mono Regular', 'FiraMono-Regular']),
  font('hack', 'Hack', 'local', ['Hack', 'Hack Regular', 'Hack-Regular']),
  font('inconsolata', 'Inconsolata', 'local', ['Inconsolata', 'Inconsolata Regular', 'Inconsolata-Regular']),
  font('roboto-mono', 'Roboto Mono', 'local', ['Roboto Mono', 'Roboto Mono Regular', 'RobotoMono-Regular']),
  font('noto-sans-mono', 'Noto Sans Mono', 'local', ['Noto Sans Mono', 'Noto Sans Mono Regular', 'NotoSansMono-Regular']),
  font('ubuntu-sans-mono', 'Ubuntu Sans Mono', 'local', ['Ubuntu Sans Mono', 'Ubuntu Sans Mono Regular', 'UbuntuSansMono-Regular']),
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

async function loadTerminalFont(option: TerminalFontOption, signal: AbortSignal): Promise<void> {
  if (typeof FontFace === 'undefined' || !globalThis.document?.fonts) {
    throw new Error('Font loading is unavailable');
  }
  const family = `Redeven Terminal ${option.id}`;
  // Reading bundled bytes explicitly makes requests abortable and avoids stalled
  // URL-backed FontFace loads observed across Chromium client documents.
  const faces = option.kind === 'bundled'
    ? await Promise.all((await import('./terminalFontAssets')).terminalBundledFontSources[option.id]!.map(async ({ url, unicodeRange }) => {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`Font resource returned ${response.status}`);
      return new FontFace(family, await response.arrayBuffer(), {
        weight: '400', style: 'normal', ...(unicodeRange ? { unicodeRange } : {}),
      }).load();
    }))
    : [await new FontFace(family,
      (option.localNames ?? [option.label]).map((name) => `local("${name}")`).join(', '),
      { weight: '400', style: 'normal' },
    ).load()];
  // Private families keep bundled files authoritative. Explicit local() probes
  // do not trust fallback metrics or request full font enumeration permission.
  if (signal.aborted) throw new Error('Font loading timed out');
  for (const face of faces) document.fonts.add(face);
}

/** One document-local owner for font loading and resolution; never persists preferences. */
export function createTerminalFontCatalog(load: (option: TerminalFontOption, signal: AbortSignal) => Promise<void> = loadTerminalFont) {
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
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Font loading timed out'));
      }, 10_000);
    });
    const work = Promise.race([Promise.resolve().then(() => load(option, controller.signal)), deadline]).then(
      () => setStates((current) => ({ ...current, [id]: 'ready' })),
      () => setStates((current) => ({ ...current, [id]: 'unavailable' })),
    ).then(() => { clearTimeout(timer); pending.delete(id); });
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
