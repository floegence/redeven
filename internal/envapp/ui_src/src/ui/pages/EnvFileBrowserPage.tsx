import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';

import { useEnvContext } from './EnvContext';
import { RemoteFileBrowser } from '../widgets/RemoteFileBrowser';

export function EnvFileBrowserPage() {
  const env = useEnvContext();

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <RemoteFileBrowser />
      <LoadingOverlay visible={env.connectionOverlayVisible()} message={env.connectionOverlayMessage()} />
    </div>
  );
}
