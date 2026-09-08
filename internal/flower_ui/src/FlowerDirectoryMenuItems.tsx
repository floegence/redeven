import { Show, createUniqueId, type JSX } from 'solid-js';
import { Copy, FolderOpen, Terminal } from '@floegence/floe-webapp-core/icons';
import type { FlowerThreadListCopy } from './copy';
import { normalizeAbsolutePath } from './filePicker/path';

export type FlowerDirectoryMenuAction = 'browse_workdir' | 'terminal_workdir' | 'copy_workdir';
export type FlowerDirectoryMenuAvailability = Readonly<{
  browse?: Readonly<{ enabled: boolean; reason?: string }>;
  terminal?: Readonly<{ enabled: boolean; reason?: string }>;
}>;

export function FlowerDirectoryMenuItems(props: Readonly<{
  path: string;
  copy: FlowerThreadListCopy;
  availability?: FlowerDirectoryMenuAvailability;
  onAction: (action: FlowerDirectoryMenuAction) => void;
}>): JSX.Element {
  const path = () => normalizeAbsolutePath(props.path);
  const button = (action: FlowerDirectoryMenuAction, label: string, icon: JSX.Element, reason: () => string) => {
    const reasonID = createUniqueId();
    return (
      <button
        type="button"
        role="menuitem"
        class="flower-thread-menu-item"
        aria-disabled={Boolean(reason())}
        aria-describedby={reason() ? reasonID : undefined}
        title={reason() || undefined}
        onClick={() => { if (!reason()) props.onAction(action); }}
      >
        {icon}
        <span>{label}</span>
        <Show when={reason()}><span id={reasonID} class="sr-only">{reason()}</span></Show>
      </button>
    );
  };
  const pathReason = () => path() ? '' : props.copy.workingDirectoryUnavailable;
  const disabledReason = (kind: 'browse' | 'terminal') => pathReason()
    || (props.availability?.[kind]?.enabled ? '' : props.availability?.[kind]?.reason || props.copy.workingDirectoryUnavailable);
  return (
    <>
      <Show when={props.availability?.browse || props.availability?.terminal}>
        <div class="flower-thread-menu-separator" />
        <div class="flower-directory-menu-path" title={path()}>
          <span class="sr-only">{props.copy.workingDirectoryLabel}: </span>
          {path() || pathReason()}
        </div>
      </Show>
      <Show when={props.availability?.browse}>
        {button('browse_workdir', props.copy.browseWorkingDirectory, <FolderOpen class="h-3.5 w-3.5" />, () => disabledReason('browse'))}
      </Show>
      <Show when={props.availability?.terminal}>
        {button('terminal_workdir', props.copy.openTerminalInWorkingDirectory, <Terminal class="h-3.5 w-3.5" />, () => disabledReason('terminal'))}
      </Show>
      {button('copy_workdir', props.copy.copyWorkingDirectory, <Copy class="h-3.5 w-3.5" />, pathReason)}
    </>
  );
}
