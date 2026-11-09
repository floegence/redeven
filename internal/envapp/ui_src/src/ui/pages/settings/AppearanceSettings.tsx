import { useSettingsPresentation } from '../../../../../../settings_ui/src/SettingsPanelHost';
import { SettingsSelect as Select } from './SettingsSelect';
import type { FloeShellThemeMode, ThemeType } from '@floegence/floe-webapp-core';
import { Input } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../../i18n';
import { LOCALE_OPTIONS, SYSTEM_LOCALE_PREFERENCE, localeDisplayName, normalizeLocalePreference } from '../../i18n/localeMeta';
import { EnvAppThemePicker } from '../../EnvAppThemePicker';
import { useMarkdownPreviewPreferences, MIN_MARKDOWN_PREVIEW_TEXT_SCALE_PERCENT, MAX_MARKDOWN_PREVIEW_TEXT_SCALE_PERCENT, MARKDOWN_PREVIEW_TEXT_SCALE_STEP_PERCENT } from '../../services/markdownPreviewPreferences';
import { SettingsSection, SettingsList, SettingRow } from './SettingsPrimitives';
import { WorkbenchAppearanceSettings } from './WorkbenchAppearanceSettings';

export function AppearanceSettings(props: {
  onThemeSourceChange: (value: ThemeType) => boolean | Promise<boolean>;
  onShellThemeChange: (mode: FloeShellThemeMode, preset: string) => boolean | Promise<boolean>;
}) {
  const i18n = useI18n();
  const presented = useSettingsPresentation('appearance');
  const markdown = useMarkdownPreviewPreferences();
  // IMPORTANT: These controls call the existing preference owners. Settings
  // never creates a competing persistence layer or changes Desktop ownership.
  return <div class="redeven-settings-stack" data-testid="appearance-settings">
    <SettingsList>
      <SettingRow title={i18n.t('language.label')} control={<Select section="appearance" ariaLabel={i18n.t('language.label')}
        value={i18n.localePreference()} options={[
          { value: SYSTEM_LOCALE_PREFERENCE, label: i18n.t('language.systemDefault') },
          ...LOCALE_OPTIONS.map(locale => ({ value: locale.id, label: localeDisplayName(locale.id) })),
        ]} onChange={value => void i18n.setLocalePreference(normalizeLocalePreference(value))} />} />
    </SettingsList>
    <SettingsSection title={i18n.t('shell.themePicker.title')}>
      <EnvAppThemePicker active={presented()} onSourceChange={value => presented() ? props.onThemeSourceChange(value) : false} onShellThemeChange={(mode, preset) => presented() ? props.onShellThemeChange(mode, preset) : false} />
    </SettingsSection>
    <WorkbenchAppearanceSettings />
    <SettingsSection title={i18n.t('uiCopy.preview.markdownControls')}><SettingsList>
      <SettingRow title={i18n.t('uiCopy.preview.textSize')} control={<div class="redeven-settings-number-unit">
        <Input type="number" aria-label={i18n.t('uiCopy.preview.textSize')} min={MIN_MARKDOWN_PREVIEW_TEXT_SCALE_PERCENT}
          max={MAX_MARKDOWN_PREVIEW_TEXT_SCALE_PERCENT} step={MARKDOWN_PREVIEW_TEXT_SCALE_STEP_PERCENT} value={markdown.textScalePercent()}
          disabled={!presented()} onChange={event => { if (presented()) markdown.setTextScalePercent(Number(event.currentTarget.value)); }} /><span aria-hidden="true">%</span>
      </div>} />
    </SettingsList></SettingsSection>
  </div>;
}
