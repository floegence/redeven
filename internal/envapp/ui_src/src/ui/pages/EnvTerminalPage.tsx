import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { useEnvContext } from './EnvContext';
import { TerminalPanel } from '../widgets/TerminalPanel';

export function EnvTerminalPage() {
  const env = useEnvContext();

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <TerminalPanel
        variant="deck"
        openSessionRequest={env.openTerminalInDirectoryRequest()}
        onOpenSessionRequestHandled={env.consumeOpenTerminalInDirectoryRequest}
      />
      <LoadingOverlay visible={env.connectionOverlayVisible()} message={env.connectionOverlayMessage()} />
    </div>
  );
}
