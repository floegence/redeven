import { createWorkspaceEffectRpc } from './workspaceEffects';
import { createMemo } from 'solid-js';
import { useEnvDirectoryFavorites } from './directoryFavorites';
import type { PickerPanelProps } from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { createFilesystemPickerDirectory, formatFilesystemPickerError, mapFilesystemPickerContext, mapFilesystemPickerEntries } from '../../../../../flower_ui/src/filePicker/filesystemPicker';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';

/** Runtime wiring only: upstream owns each mounted picker's navigation and request lifetime. */
export function useEnvFilesystemPicker(): PickerPanelProps {
  const rpc = useRedevenRpc();
  const protocol = useProtocol();
  const favorites = useEnvDirectoryFavorites();
  const copy = () => favorites.copy;
  let revision = 0;
  const scopeKey = createMemo(() => {
    protocol.session?.();
    return String(++revision);
  });
  return {
    get directoryFavorites() { return favorites.directoryFavorites; },
    get scopeKey() { return scopeKey(); },
    get copy() { return copy(); },
    loadPathContext: async () => mapFilesystemPickerContext(await rpc.fs.getPathContext(), copy),
    loadDirectory: async (path, options) => mapFilesystemPickerEntries((await rpc.fs.list({ path, showHidden: options.showHidden })).entries),
    onCreateFolder: (parent, name) => createFilesystemPickerDirectory(parent, name, async path => {
      const session = protocol.session?.();
      if (!session) throw new Error('Filesystem connection unavailable');
      await createWorkspaceEffectRpc(session, rpc).fs.mkdir({ path, createParents: false });
    }),
    formatError: (error) => formatFilesystemPickerError(error, copy()),
    scrollViewportProps: { ...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS, class: 'overscroll-contain' },
  };
}
