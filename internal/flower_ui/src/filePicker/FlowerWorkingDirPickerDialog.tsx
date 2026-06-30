import { Show } from 'solid-js';
import { DirectoryPicker, type DirectoryPickerProps } from '@floegence/floe-webapp-core/ui';

export function FlowerWorkingDirPickerDialog(props: DirectoryPickerProps) {
  return (
    <Show when={props.open} fallback={null}>
      <DirectoryPicker {...props} />
    </Show>
  );
}
