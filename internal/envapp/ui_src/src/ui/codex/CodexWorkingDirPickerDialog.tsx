import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { LazyMountedDirectoryPicker } from '../primitives/LazyMountedPickers';

export function CodexWorkingDirPickerDialog(props: {
  open: boolean;
  files: readonly FileItem[];
  initialPath: string;
  homePath?: string;
  onOpenChange: (open: boolean) => void;
  onExpand: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <LazyMountedDirectoryPicker
      open={props.open}
      onOpenChange={props.onOpenChange}
      files={[...props.files]}
      initialPath={props.initialPath}
      homeLabel="Home"
      homePath={props.homePath}
      title="Select Working Directory"
      confirmText="Select"
      onExpand={props.onExpand}
      onSelect={props.onSelect}
    />
  );
}
