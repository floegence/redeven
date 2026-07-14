import { useEnvContext } from './EnvContext';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { useI18n } from '../i18n';
import { RuntimeMonitorPanel } from '../widgets/RuntimeMonitorPanel';

export function EnvMonitorPage() {
  const env = useEnvContext();
  const i18n = useI18n();

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <RuntimeMonitorPanel variant="page" />
      <RedevenLoadingCurtain
        visible={env.connectionOverlayVisible()}
        surface="page"
        eyebrow={i18n.t('uiCopy.runtime.eyebrow')}
        message={env.connectionOverlayMessage()}
      />
    </div>
  );
}
