import { useSettingsPresentation } from '../../../../../../settings_ui/src/SettingsPanelHost';
import { SettingsSelect as Select } from './SettingsSelect';
import { createSignal, onCleanup } from 'solid-js';
import { COMPUTER_FRAME_RATES } from '../../../../../../flower_ui/src/computerViewer';
import { useI18n } from '../../i18n';
import { envComputerViewerFrameRate } from '../../services/computerViewerPreferences';
import { SettingsList, SettingRow } from './SettingsPrimitives';

export function BrowserDisplaySettings() {
  const i18n = useI18n();
  const presented = useSettingsPresentation('browser');
  const [fps, setFPS] = createSignal(envComputerViewerFrameRate.read());
  onCleanup(envComputerViewerFrameRate.subscribe(setFPS));
  return <section data-testid="browser-display-settings"><SettingsList>
    <SettingRow title={i18n.t('flowerSurface.chat.computerFrameRate')}
      control={<Select section="browser" ariaLabel={i18n.t('flowerSurface.chat.computerFrameRate')} value={String(fps())}
        options={COMPUTER_FRAME_RATES.map(value => ({ value: String(value), label: `${value} FPS` }))}
        onChange={value => { if (presented()) envComputerViewerFrameRate.write(Number(value)); }} />} />
  </SettingsList></section>;
}
