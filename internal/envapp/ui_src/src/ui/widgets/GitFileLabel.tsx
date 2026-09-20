import { Show } from 'solid-js';
import { FileItemIcon } from '@floegence/floe-webapp-core/file-browser';
import { extNoDot } from './FileBrowserShared';

/** One-line identity shared by Git inventories; exact paths remain available to assistive technology. */
export function GitFileLabel(props: { path: string; secondaryPath?: string; directory?: boolean }) {
  const name = () => props.path.replace(/\/$/, '').split('/').at(-1) || props.path;
  const parent = () => props.path.slice(0, Math.max(0, props.path.lastIndexOf('/')));
  const description = () => props.secondaryPath || props.path;
  return (
    <span class="git-file-label" title={description()}>
      <FileItemIcon size={14} item={{ name: name(), type: props.directory ? 'folder' : 'file', extension: extNoDot(name()) }} class="size-3.5 shrink-0" />
      <span class="git-file-label__name">{name()}</span>
      <Show when={parent()}><span aria-hidden="true" class="git-file-label__directory">{parent()}</span></Show>
      <Show when={description() !== name()}><span class="sr-only">{description()}</span></Show>
    </span>
  );
}
