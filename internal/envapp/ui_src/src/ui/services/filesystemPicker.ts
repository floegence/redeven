import { createMemo } from 'solid-js';
import type { PickerPanelProps } from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { formatFilesystemPickerError, mapFilesystemPickerContext, mapFilesystemPickerEntries } from '../../../../../flower_ui/src/filePicker/filesystemPicker';
import { createLocalizedFilesystemPickerCopy } from '../../../../../flower_ui/src/i18n/filesystemPickerMessages';
import { useI18n, type EnvAppTranslationKey } from '../i18n';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';

/** Runtime wiring only: upstream owns each mounted picker's navigation and request lifetime. */
export function useEnvFilesystemPicker(): PickerPanelProps {
  const rpc = useRedevenRpc();
  const protocol = useProtocol();
  const i18n = useI18n();
  const copy = () => createLocalizedFilesystemPickerCopy({ t: (key, params) => i18n.t(key as EnvAppTranslationKey, params) });
  let revision = 0;
  const scopeKey = createMemo(() => {
    protocol.session?.();
    return String(++revision);
  });
  return {
    get scopeKey() { return scopeKey(); },
    get copy() { return copy(); },
    loadPathContext: async () => mapFilesystemPickerContext(await rpc.fs.getPathContext(), copy()),
    loadDirectory: async (path, options) => mapFilesystemPickerEntries((await rpc.fs.list({ path, showHidden: options.showHidden })).entries),
    formatError: (error) => formatFilesystemPickerError(error, copy()),
    scrollViewportProps: { ...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS, class: 'overscroll-contain' },
  };
}
