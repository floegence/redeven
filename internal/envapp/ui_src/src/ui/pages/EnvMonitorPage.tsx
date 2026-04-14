import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';

import { useEnvContext } from './EnvContext';
import { RuntimeMonitorPanel } from '../widgets/RuntimeMonitorPanel';

export function EnvMonitorPage() {
  const env = useEnvContext();

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <RuntimeMonitorPanel variant="page" />
      <LoadingOverlay visible={env.connectionOverlayVisible()} message={env.connectionOverlayMessage()} />
    </div>
  );
}
