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
import { SettingsSection } from '../SettingsPrimitives';
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
      case 'explicit': return i18n.t('language.source.explicit');
      case 'system': return i18n.t('language.source.system');
      case 'fallback':
      default: return i18n.t('language.source.fallback');
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
    <SettingsSection
      icon={Globe}
      title={i18n.t('settings.interfaceTitle')}
      description={i18n.t('settings.interfaceDescription')}
      badge={i18n.tn('language.availableCount', LOCALE_OPTIONS.length)}
    >
      {/* Current language card */}
      <div class="rounded-xl border border-border/50 bg-background p-6 text-center">
        <div class="text-[11px] text-muted-foreground mb-3 uppercase tracking-wider">
          {i18n.t('language.preferenceLabel')}
        </div>
        <div class="text-lg font-semibold text-foreground mb-1">
          {localeDisplayName(i18n.locale())}
        </div>
        <div class="text-[11px] text-muted-foreground mb-4">
          {i18n.t('language.sourceLabel')}: {languageSourceLabel()}
        </div>
        <div class="inline-flex items-center gap-2">
          <span class="text-xs text-muted-foreground">{i18n.t('language.updatedTitle')}</span>
          <Select
            value={i18n.localePreference()}
            onChange={(value) => updateLanguagePreference(value)}
            options={languagePreferenceOptions()}
            class="w-48 cursor-pointer"
          />
        </div>
      </div>

      <p class="mt-3 text-[11px] text-muted-foreground">
        {i18n.t('settings.languageDescription')}
      </p>
      <p class="text-[11px] text-muted-foreground">
        {i18n.source() === 'desktop' ? i18n.t('settings.desktopBridgeNote') : i18n.t('settings.standaloneNote')}
      </p>
    </SettingsSection>
  );
}
