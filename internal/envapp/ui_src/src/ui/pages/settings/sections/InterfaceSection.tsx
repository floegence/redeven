import { createMemo } from 'solid-js';
import { Globe, Zap } from '@floegence/floe-webapp-core/icons';
import { Select } from '@floegence/floe-webapp-core/ui';

import {
  LOCALE_OPTIONS,
  SYSTEM_LOCALE_PREFERENCE,
  localeDisplayName,
  normalizeLocalePreference,
  useI18n,
  type RedevenLocalePreference,
} from '../../../i18n';
import { FieldLabel, InfoRow, SettingsSection } from '../SettingsPrimitives';
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
  const languageStorageNote = createMemo(() => (
    i18n.source() === 'desktop'
      ? i18n.t('settings.desktopBridgeNote')
      : i18n.t('settings.standaloneNote')
  ));

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
        description={i18n.t('settings.interfaceDescription')}
        badge={i18n.tn('language.availableCount', LOCALE_OPTIONS.length)}
      >
        <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start">
          <div class="space-y-2">
            <FieldLabel>{i18n.t('language.preferenceLabel')}</FieldLabel>
            <Select
              value={i18n.localePreference()}
              onChange={(value) => updateLanguagePreference(value)}
              options={languagePreferenceOptions()}
              class="w-full cursor-pointer"
            />
            <p class="text-[11px] leading-relaxed text-muted-foreground">
              {i18n.t('settings.languageDescription')}
            </p>
          </div>

          <div class="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
            <InfoRow icon={Globe} label={i18n.t('language.label')}>
              {i18n.t('language.currentResolved', { language: localeDisplayName(i18n.locale()) })}
            </InfoRow>
            <InfoRow icon={Zap} label={i18n.t('language.sourceLabel')}>
              {languageSourceLabel()}
            </InfoRow>
            <p class="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {languageStorageNote()}
            </p>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
