import { useEnvContext } from './EnvContext';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { TerminalPanel } from '../widgets/TerminalPanel';

export function EnvTerminalPage() {
  const env = useEnvContext();

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <TerminalPanel
        variant="panel"
        openSessionRequest={env.openTerminalInDirectoryRequest()}
        onOpenSessionRequestHandled={env.consumeOpenTerminalInDirectoryRequest}
      />
      <RedevenLoadingCurtain
        visible={env.connectionOverlayVisible()}
        surface="page"
        eyebrow="Runtime"
        message={env.connectionOverlayMessage()}
      />
    </div>
  );
}
