import { useEnvContext } from './EnvContext';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { RemoteFileBrowser } from '../widgets/RemoteFileBrowser';
import { useI18n } from '../i18n';

export function EnvFileBrowserPage() {
  const env = useEnvContext();
  const i18n = useI18n();

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <RemoteFileBrowser />
      <RedevenLoadingCurtain
        visible={env.connectionOverlayVisible()}
        surface="page"
        eyebrow={i18n.t('uiCopy.runtime.eyebrow')}
        message={env.connectionOverlayMessage()}
      />
    </div>
  );
}
