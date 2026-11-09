import { Select } from '@floegence/floe-webapp-core/ui';
import { createSignal, onCleanup } from 'solid-js';
import { COMPUTER_FRAME_RATES } from '../../../../../../flower_ui/src/computerViewer';
import { useI18n } from '../../i18n';
import { envComputerViewerFrameRate } from '../../services/computerViewerPreferences';

export function BrowserDisplaySettings() {
  const i18n = useI18n();
  const [fps, setFPS] = createSignal(envComputerViewerFrameRate.read());
  onCleanup(envComputerViewerFrameRate.subscribe(setFPS));
  return <section class="space-y-2" data-testid="browser-display-settings">
    <label class="flex flex-wrap items-center justify-between gap-3">
      <span class="font-medium">{i18n.t('flowerSurface.chat.computerFrameRate')}</span>
      <Select ariaLabel={i18n.t('flowerSurface.chat.computerFrameRate')} value={String(fps())}
        options={COMPUTER_FRAME_RATES.map(value => ({ value: String(value), label: `${value} FPS` }))}
        onChange={value => envComputerViewerFrameRate.write(Number(value))} />
    </label>
    <p class="text-xs text-muted-foreground">{i18n.t('flowerSurface.chat.computerFrameRateHint')}</p>
  </section>;
}
