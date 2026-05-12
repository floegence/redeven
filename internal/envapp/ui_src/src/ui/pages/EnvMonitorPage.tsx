import { useEnvContext } from './EnvContext';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { RuntimeMonitorPanel } from '../widgets/RuntimeMonitorPanel';

export function EnvMonitorPage() {
  const env = useEnvContext();

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <RuntimeMonitorPanel variant="page" />
      <RedevenLoadingCurtain
        visible={env.connectionOverlayVisible()}
        surface="page"
        eyebrow="Runtime"
        message={env.connectionOverlayMessage()}
      />
    </div>
  );
}
