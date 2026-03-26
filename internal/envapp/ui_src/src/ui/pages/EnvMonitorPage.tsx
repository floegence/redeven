import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';

import { useEnvContext } from './EnvContext';
import { AgentMonitorPanel } from '../widgets/AgentMonitorPanel';

export function EnvMonitorPage() {
  const env = useEnvContext();

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <AgentMonitorPanel variant="page" />
      <LoadingOverlay visible={env.connectionOverlayVisible()} message={env.connectionOverlayMessage()} />
    </div>
  );
}
