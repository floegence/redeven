import { useEnvContext } from './EnvContext';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { RemoteFileBrowser } from '../widgets/RemoteFileBrowser';

export function EnvFileBrowserPage() {
  const env = useEnvContext();

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <RemoteFileBrowser />
      <RedevenLoadingCurtain
        visible={env.connectionOverlayVisible()}
        surface="page"
        eyebrow="Runtime"
        message={env.connectionOverlayMessage()}
      />
    </div>
  );
}
