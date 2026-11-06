import { createContext, useContext, onMount, onCleanup, createEffect, createUniqueId, type JSX } from 'solid-js';
import { createContextSourceRegistry } from '@floegence/floe-webapp-core/ui';
import type { FlowerPageContextRegistrar, FlowerPageContextState } from './flowerPageContext';

export type FlowerSourceFacts = Readonly<{ pageID: string; pageName: string; mode: 'activity' | 'workbench' | 'overlay'; state?: FlowerPageContextState }>;
export const createFlowerContextSources = () => createContextSourceRegistry<FlowerSourceFacts>(document);
export const FlowerContextSources = createContext<ReturnType<typeof createFlowerContextSources>>();
const ContextReader = createContext<FlowerPageContextRegistrar>();

/** Read through the owning page; never mirror its state or inspect embedded DOM. */
export function registerFlowerPageReader(read: () => FlowerPageContextState | undefined, legacy?: FlowerPageContextRegistrar): void {
  legacy?.(read);
  const registrar = useContext(ContextReader);
  registrar?.(read);
}

export function FlowerContextSource(props: { id: string; pageID: string; pageName: string; mode: 'activity' | 'workbench' | 'overlay'; selected?: boolean; class?: string; state?: FlowerPageContextState; children: JSX.Element }) {
  const sources = useContext(FlowerContextSources);
  let element!: HTMLDivElement;
  let reader: (() => FlowerPageContextState | undefined) | undefined;
  const register: FlowerPageContextRegistrar = read => {
    reader = read; onCleanup(() => { if (reader === read) reader = undefined; });
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
    const remove = sources?.register({ id, element, read: () => ({
      pageID: props.pageID, pageName: props.pageName, mode: props.mode, state: reader?.() ?? props.state,
    }) });
    if (props.selected) activate();
    onCleanup(() => remove?.());
  });
  createEffect(() => { if (props.selected) activate(); });
  return <div ref={element} class={props.class ?? "h-full min-h-0 w-full"} data-flower-context-source={id} data-flower-context-page={props.pageID} data-flower-context-mode={props.mode}>
    <ContextReader.Provider value={register}>{props.children}</ContextReader.Provider>
  </div>;
}
