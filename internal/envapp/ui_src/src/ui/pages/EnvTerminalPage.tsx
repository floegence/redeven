import { useEnvContext } from './EnvContext';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { useI18n } from '../i18n';
import { TerminalPanel } from '../widgets/TerminalPanel';

export function EnvTerminalPage() {
  const env = useEnvContext();
  const i18n = useI18n();

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
        eyebrow={i18n.t('uiCopy.runtime.eyebrow')}
        message={env.connectionOverlayMessage()}
      />
    </div>
  );
}
