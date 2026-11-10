import { createContext, useContext, onMount, onCleanup, createEffect, createUniqueId, type JSX } from 'solid-js';
import { createContextSourceRegistry } from '@floegence/floe-webapp-core/ui';
import type { FlowerPageContextRegistrar, FlowerPageContextState } from './flowerPageContext';

export type FlowerSourceFile = Readonly<{ path: string; name: string; selection?: string; unsaved?: boolean }>;
export type FlowerSourceFacts = Readonly<{ file?: FlowerSourceFile; kind?: 'surface' | 'navigation' | 'object' | 'shell'; screenshotElement?: HTMLElement; resourceKey?: string; pageID: string; pageName: string; mode: 'activity' | 'workbench' | 'overlay'; state?: FlowerPageContextState }>;
export const createFlowerContextSources = () => createContextSourceRegistry<FlowerSourceFacts>(document);
export const FlowerContextSources = createContext<ReturnType<typeof createFlowerContextSources>>();
type SourceReader = (read: () => FlowerPageContextState | undefined, resourceKey?: () => string | undefined) => void;
const ContextReader = createContext<SourceReader>();
const SourceOwner = createContext<() => FlowerSourceFacts>();
const copyFacts = (state: FlowerPageContextState | undefined): FlowerPageContextState | undefined => state === undefined ? undefined : JSON.parse(JSON.stringify(state)) as FlowerPageContextState;

/** Read through the owning page; never mirror its state or inspect embedded DOM. */
export function registerFlowerPageReader(read: () => FlowerPageContextState | undefined, legacy?: FlowerPageContextRegistrar, resourceKey?: () => string | undefined): void {
  legacy?.(read);
  const registrar = useContext(ContextReader);
  registrar?.(read, resourceKey);
}

export function FlowerContextSource(props: { id: string; pageID: string; pageName: string; mode: 'activity' | 'workbench' | 'overlay'; kind?: FlowerSourceFacts['kind']; file?: FlowerSourceFile; resourceKey?: string; selected?: boolean; enabled?: boolean; boundary?: (body: HTMLElement) => HTMLElement; class?: string; state?: FlowerPageContextState; children: JSX.Element }) {
  const sources = useContext(FlowerContextSources);
  let element!: HTMLElement;
  let reader: (() => FlowerPageContextState | undefined) | undefined;
  let readResourceKey: (() => string | undefined) | undefined;
  const register: SourceReader = (read, resourceKey) => {
    reader = read; readResourceKey = resourceKey;
    onCleanup(() => { if (reader === read) { reader = undefined; readResourceKey = undefined; } });
  };
  // Instance identity must not change with its current file or page data.
  const id = `${props.id}:${createUniqueId()}`;
  const activate = () => {
    const current = sources?.capture();
    // A selected page must not replace its already focused nested document.
    if (current && current.element !== element && element?.contains(current.element)) return;
    sources?.activate(id);
  };
  onMount(() => {
    element = props.boundary?.(element) ?? element;
    const remove = sources?.register({ id, element, enabled: () => props.enabled !== false, activateOnInteraction: props.kind !== 'shell' && props.kind !== 'navigation', read: () => ({
      file: props.file ? { ...props.file } : undefined, kind: props.kind ?? 'surface', resourceKey: readResourceKey?.() ?? props.resourceKey, pageID: props.pageID, pageName: props.pageName, mode: props.mode, state: copyFacts(reader?.() ?? props.state),
    }) });
    if (props.selected) activate();
    onCleanup(() => remove?.());
  });
  createEffect(() => { if (props.selected) activate(); });
  return <div ref={node => { element = node; }} class={props.class ?? "h-full min-h-0 w-full"} data-flower-context-source={id} data-flower-context-page={props.pageID} data-flower-context-mode={props.mode}>
    <SourceOwner.Provider value={() => ({ pageID: props.pageID, pageName: props.pageName, mode: props.mode })}><ContextReader.Provider value={register}>{props.children}</ContextReader.Provider></SourceOwner.Provider>
  </div>;
}


/** Attach domain-owned facts to an existing node without adding layout wrappers. */
export function createFlowerContextTarget(read: () => Readonly<{ id: string; label: string; resourceKey?: string; state?: FlowerPageContextState }>): (element: HTMLElement) => void {
  const sources = useContext(FlowerContextSources);
  const owner = useContext(SourceOwner);
  const id = `object:${createUniqueId()}`;
  let remove: (() => void) | undefined;
  onCleanup(() => remove?.());
  return element => {
    remove?.();
    remove = sources?.register({ id, element, read: () => {
      const subject = read();
      return { kind: 'object', resourceKey: subject.resourceKey ?? subject.id, mode: owner?.().mode ?? 'overlay', pageID: subject.id, pageName: subject.label,
        state: { ...copyFacts(subject.state), subject: { id: subject.id, name: subject.label }, ...(owner ? { surface: { id: owner().pageID, name: owner().pageName } } : {}) } };
    } });
  };
}
