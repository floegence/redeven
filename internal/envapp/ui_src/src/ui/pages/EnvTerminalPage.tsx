import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useEnvContext } from './EnvContext';
import { TerminalPanel } from '../widgets/TerminalPanel';

export function EnvTerminalPage() {
  const protocol = useProtocol();
  const env = useEnvContext();

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <TerminalPanel
        variant="deck"
        openSessionRequest={env.openTerminalInDirectoryRequest()}
        onOpenSessionRequestHandled={env.consumeOpenTerminalInDirectoryRequest}
      />
      <LoadingOverlay visible={protocol.status() !== 'connected'} message="Connecting to agent..." />
    </div>
  );
}
