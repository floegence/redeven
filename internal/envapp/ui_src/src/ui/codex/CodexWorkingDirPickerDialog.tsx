import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { PickerEnsurePath } from '@floegence/floe-webapp-core/ui';
import { LazyMountedDirectoryPicker } from '../primitives/LazyMountedPickers';
import { useI18n } from '../i18n';

export function CodexWorkingDirPickerDialog(props: {
  open: boolean;
  files: readonly FileItem[];
  initialPath: string;
  homePath?: string;
  onOpenChange: (open: boolean) => void;
  onExpand: (path: string) => void | Promise<void>;
  ensurePath: PickerEnsurePath;
  onSelect: (path: string) => void;
}) {
  const i18n = useI18n();
  return (
    <LazyMountedDirectoryPicker
      open={props.open}
      onOpenChange={props.onOpenChange}
      files={[...props.files]}
      initialPath={props.initialPath}
      homeLabel={i18n.t('codex.workingDirPicker.home')}
      homePath={props.homePath}
      title={i18n.t('codex.workingDirPicker.title')}
      confirmText={i18n.t('codex.workingDirPicker.confirm')}
      onExpand={props.onExpand}
      ensurePath={props.ensurePath}
      onSelect={props.onSelect}
    />
  );
}
