import { Select } from '@floegence/floe-webapp-core/ui';
import { WORKBENCH_THEMES } from '@floegence/floe-webapp-core/workbench';
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { useI18n } from '../../i18n';
import { useEnvContext } from '../EnvContext';
import { resolveEnvAppStorageBinding } from '../../services/uiPersistence';
import { isDesktopStateStorageAvailable } from '../../services/uiStorage';
import { readWorkbenchLocalPreferences, subscribeWorkbenchLocalPreferences, writeWorkbenchTheme } from '../../services/workbenchLocalPreferences';

export function WorkbenchAppearanceSettings() {
  const env = useEnvContext(), i18n = useI18n();
  const key = createMemo(() => resolveEnvAppStorageBinding({
    envID: env.env_id(), desktopStateStorageAvailable: isDesktopStateStorageAvailable(),
  }).workbenchLocalPreferencesKey);
  const [theme, setTheme] = createSignal(readWorkbenchLocalPreferences(key()).theme);
  createEffect(() => {
    const storageKey = key();
    setTheme(readWorkbenchLocalPreferences(storageKey).theme);
    onCleanup(subscribeWorkbenchLocalPreferences(storageKey, state => setTheme(state.theme)));
  });
  return <section data-testid="workbench-appearance-settings">
    <label class="flex flex-wrap items-center justify-between gap-3">
      <span class="font-medium">{i18n.t('settings.workbench.canvasTheme')}</span>
      <Select ariaLabel={i18n.t('settings.workbench.canvasTheme')} value={theme()}
        options={WORKBENCH_THEMES.map(option => ({ value: option.id, label: i18n.t(`settings.workbench.themes.${option.id}`) }))}
        onChange={value => writeWorkbenchTheme(key(), value)} />
    </label>
  </section>;
}
