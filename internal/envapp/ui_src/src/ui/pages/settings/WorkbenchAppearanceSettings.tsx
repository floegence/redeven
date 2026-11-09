import { useSettingsPresentation } from '../../../../../../settings_ui/src/SettingsPanelHost';
import { SettingsSelect as Select } from './SettingsSelect';
import { WORKBENCH_THEMES } from '@floegence/floe-webapp-core/workbench';
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { useI18n } from '../../i18n';
import { useEnvContext } from '../EnvContext';
import { resolveEnvAppStorageBinding } from '../../services/uiPersistence';
import { isDesktopStateStorageAvailable } from '../../services/uiStorage';
import { readWorkbenchLocalPreferences, subscribeWorkbenchLocalPreferences, writeWorkbenchTheme } from '../../services/workbenchLocalPreferences';
import { SettingsList, SettingRow } from './SettingsPrimitives';

export function WorkbenchAppearanceSettings() {
  const env = useEnvContext(), i18n = useI18n();
  const presented = useSettingsPresentation('appearance');
  const key = createMemo(() => resolveEnvAppStorageBinding({
    envID: env.env_id(), desktopStateStorageAvailable: isDesktopStateStorageAvailable(),
  }).workbenchLocalPreferencesKey);
  const [theme, setTheme] = createSignal(readWorkbenchLocalPreferences(key()).theme);
  createEffect(() => {
    const storageKey = key();
    setTheme(readWorkbenchLocalPreferences(storageKey).theme);
    onCleanup(subscribeWorkbenchLocalPreferences(storageKey, state => setTheme(state.theme)));
  });
  return <section data-testid="workbench-appearance-settings"><SettingsList>
    <SettingRow title={i18n.t('settings.workbench.canvasTheme')} control={<Select section="appearance" ariaLabel={i18n.t('settings.workbench.canvasTheme')} value={theme()}
        options={WORKBENCH_THEMES.map(option => ({ value: option.id, label: i18n.t(`settings.workbench.themes.${option.id}`) }))}
        onChange={value => { if (presented()) writeWorkbenchTheme(key(), value); }} />} />
  </SettingsList></section>;
}
