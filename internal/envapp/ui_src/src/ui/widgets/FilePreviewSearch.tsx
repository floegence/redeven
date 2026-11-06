import { createContext, createEffect, createSignal, onCleanup, useContext, type Accessor, type ParentProps } from 'solid-js';
import { TextSearchBar, type TextSearchController, type TextSearchLabels } from '@floegence/floe-webapp-core/ui';
import './FilePreviewSearch.css';

export interface FilePreviewSearchAction {
  show: (trigger?: HTMLElement) => void;
  enabled: Accessor<boolean>;
  expanded?: Accessor<boolean>;
}

const FilePreviewSearchContext = createContext<{
  action: Accessor<FilePreviewSearchAction | undefined>;
  register: (action: FilePreviewSearchAction) => () => void;
}>();

/** One document owns its Find action, including portaled window-header controls. */
export function FilePreviewSearchScope(props: ParentProps<{ inherit?: boolean; enabled?: boolean }>) {
  const parent = useContext(FilePreviewSearchContext);
  const [action, setAction] = createSignal<FilePreviewSearchAction>();
  const own = {
    action,
    register: (next: FilePreviewSearchAction) => {
      setAction(next);
      return () => setAction(current => current === next ? undefined : current);
    },
  };
  const value = (props.inherit ? parent : undefined) ?? (props.enabled === false ? undefined : own);
  return <FilePreviewSearchContext.Provider value={value}>{props.children}</FilePreviewSearchContext.Provider>;
}

export const useFilePreviewSearch = () => useContext(FilePreviewSearchContext);

export function registerFilePreviewSearch(action: FilePreviewSearchAction, available: Accessor<boolean> = () => true): boolean {
  const host = useFilePreviewSearch();
  if (!host) return false;
  createEffect(() => {
    if (!available()) return;
    onCleanup(host.register(action));
  });
  return true;
}

/** Product placement only; Floe owns matching, keyboard behavior and highlights. */
export function FilePreviewSearchOverlay(props: { search: TextSearchController; labels: TextSearchLabels }) {
  return <div class="redeven-preview-search-overlay" hidden={!props.search.open()}>
    <TextSearchBar search={props.search} labels={props.labels} />
  </div>;
}
