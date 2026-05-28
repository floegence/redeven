import { createMemo } from 'solid-js';
import { Globe } from '@floegence/floe-webapp-core/icons';
import { Select } from '@floegence/floe-webapp-core/ui';

import {
  LOCALE_OPTIONS,
  SYSTEM_LOCALE_PREFERENCE,
  localeDisplayName,
  normalizeLocalePreference,
  useI18n,
  type RedevenLocalePreference,
} from '../../../i18n';
import { SettingsSection, PropertyRow } from '../SettingsPrimitives';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';

export function InterfaceSection() {
  const i18n = useI18n();
  const ctx = useEnvSettingsPage();

  const languagePreferenceOptions = createMemo(() => [
    { value: SYSTEM_LOCALE_PREFERENCE, label: i18n.t('language.systemDefault') },
    ...LOCALE_OPTIONS.map((meta) => ({ value: meta.id, label: localeDisplayName(meta.id) })),
  ]);
  const languageSourceLabel = createMemo(() => {
    switch (i18n.snapshot().source) {
      case 'explicit':
        return i18n.t('language.source.explicit');
      case 'system':
        return i18n.t('language.source.system');
      case 'fallback':
      default:
        return i18n.t('language.source.fallback');
    }
  });

  const updateLanguagePreference = (value: string | null | undefined) => {
    const preference = normalizeLocalePreference(value) as RedevenLocalePreference;
    i18n.setLocalePreference(preference);
    const language = preference === SYSTEM_LOCALE_PREFERENCE
      ? i18n.t('language.systemDefault')
      : localeDisplayName(preference);
    ctx.notify.success(i18n.t('language.updatedTitle'), i18n.t('language.updatedMessage', { language }));
  };

  return (
    <div data-settings-section="interface">
      <SettingsSection
        icon={Globe}
        title={i18n.t('settings.interfaceTitle')}
        description={`${i18n.t('settings.interfaceDescription')} ${i18n.tn('language.availableCount', LOCALE_OPTIONS.length)}`}
      >
        <div class="space-y-5">
          <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            <div class="sm:max-w-[55%]">
              <label class="text-xs font-medium text-foreground">{i18n.t('language.preferenceLabel')}</label>
              <p class="mt-0.5 text-[11px] text-muted-foreground">{i18n.t('settings.languageDescription')}</p>
            </div>
            <Select
              value={i18n.localePreference()}
              onChange={(value) => updateLanguagePreference(value)}
              options={languagePreferenceOptions()}
              class="sm:w-48 cursor-pointer"
            />
          </div>

          <div class="border-t border-border/20 pt-4">
            <PropertyRow label={i18n.t('language.label')}>
              {i18n.t('language.currentResolved', { language: localeDisplayName(i18n.locale()) })}
            </PropertyRow>
            <PropertyRow label={i18n.t('language.sourceLabel')}>
              {languageSourceLabel()}
            </PropertyRow>
            <p class="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {i18n.source() === 'desktop'
                ? i18n.t('settings.desktopBridgeNote')
                : i18n.t('settings.standaloneNote')}
            </p>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
