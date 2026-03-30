import { Show } from 'solid-js';
import {
  DirectoryPicker,
  FileSavePicker,
  type DirectoryPickerProps,
  type FileSavePickerProps,
} from '@floegence/floe-webapp-core/ui';

export function LazyMountedDirectoryPicker(props: DirectoryPickerProps) {
  return (
    <Show
      when={props.open}
      // Keep the shared picker unmounted while closed so stale initialPath/homePath
      // snapshots from older floe-webapp-core releases cannot leak into open state.
      fallback={null}
    >
      <DirectoryPicker {...props} />
    </Show>
  );
}

export function LazyMountedFileSavePicker(props: FileSavePickerProps) {
  return (
    <Show
      when={props.open}
      // Mirror the directory picker compatibility behavior for save dialogs that
      // also keep picker state alive across open/close cycles in downstream surfaces.
      fallback={null}
    >
      <FileSavePicker {...props} />
    </Show>
  );
}
