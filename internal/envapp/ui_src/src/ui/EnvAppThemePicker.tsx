import { createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { getShellThemePresetsForMode, deferAfterPaint, useTheme, type FloeShellThemeMode, type FloeThemePreset, type ThemeType } from '@floegence/floe-webapp-core';
import { ThemePicker } from '@floegence/floe-webapp-core/ui';
import { useI18n, type EnvAppTranslationKey } from './i18n';

export type EnvAppThemePickerProps = Readonly<{
  active?: boolean;
  onSourceChange: (source: ThemeType) => boolean | Promise<boolean>;
  onShellThemeChange: (mode: FloeShellThemeMode, presetName: string) => boolean | Promise<boolean>;
}>;

const THEME_SOURCE_OPTIONS = ['system', 'light', 'dark'] as const satisfies readonly ThemeType[];

const PRESET_TRANSLATION_KEYS = {
  'classic-light': 'shell.themePicker.presets.classic-light',
  paper: 'shell.themePicker.presets.paper',
  mist: 'shell.themePicker.presets.mist',
  meadow: 'shell.themePicker.presets.meadow',
  citrus: 'shell.themePicker.presets.citrus',
  lilac: 'shell.themePicker.presets.lilac',
  'light-plus': 'shell.themePicker.presets.light-plus',
  'quiet-light': 'shell.themePicker.presets.quiet-light',
  'solarized-light': 'shell.themePicker.presets.solarized-light',
  'github-light': 'shell.themePicker.presets.github-light',
  'hc-light': 'shell.themePicker.presets.hc-light',
  'classic-dark': 'shell.themePicker.presets.classic-dark',
  ink: 'shell.themePicker.presets.ink',
  slate: 'shell.themePicker.presets.slate',
  forest: 'shell.themePicker.presets.forest',
  ember: 'shell.themePicker.presets.ember',
  ocean: 'shell.themePicker.presets.ocean',
  'dark-plus': 'shell.themePicker.presets.dark-plus',
  monokai: 'shell.themePicker.presets.monokai',
  nord: 'shell.themePicker.presets.nord',
  dracula: 'shell.themePicker.presets.dracula',
  abyss: 'shell.themePicker.presets.abyss',
  'cloud-white': 'shell.themePicker.presets.cloud-white',
  'soft-black': 'shell.themePicker.presets.soft-black',
  'porcelain-light': 'shell.themePicker.presets.porcelain-light',
  'porcelain-dark': 'shell.themePicker.presets.porcelain-dark',
} as const satisfies Readonly<Record<string, EnvAppTranslationKey>>;

function presetLabel(i18n: ReturnType<typeof useI18n>, preset: FloeThemePreset): string {
  const key = PRESET_TRANSLATION_KEYS[preset.name as keyof typeof PRESET_TRANSLATION_KEYS];
  return key ? i18n.t(key) : preset.displayName;
}

export function EnvAppThemePicker(props: EnvAppThemePickerProps): JSX.Element {
  const theme = useTheme();
  const i18n = useI18n();
  // IMPORTANT: A deferred choice belongs to one presentation lifetime. Hiding
  // and immediately returning must not revive an unadmitted preference write.
  const presentation = createMemo(() => props.active !== false ? {} : null);
  const [error, setError] = createSignal('');
  const [pending, setPending] = createSignal('');
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const activeMode = createMemo<FloeShellThemeMode>(() => theme.resolvedTheme());
  const presets = createMemo(() => getShellThemePresetsForMode(theme.shellPresets(), activeMode()));
  const selectedPresetName = createMemo(() => theme.shellPresetForMode(activeMode())?.name);

  const showUpdateFailure = () => setError(i18n.t('shell.themePicker.changeFailed'));
  const selectSource = async (source: ThemeType) => {
    const admission = presentation();
    if (!admission || pending()) return;
    if (source === theme.theme()) {
      setError('');
      return;
    }
    setError('');
    setPending(`mode-${source}`);
    try {
      await new Promise<void>(deferAfterPaint);
      if (disposed || presentation() !== admission) return;
      if (!await props.onSourceChange(source)) {
        showUpdateFailure();
        return;
      }
      setError('');
    } catch {
      if (!disposed) showUpdateFailure();
    } finally {
      if (!disposed) setPending('');
    }
  };
  const selectPreset = async (preset: FloeThemePreset) => {
    const admission = presentation();
    if (!admission || pending()) return;
    if (preset.name === selectedPresetName()) {
      setError('');
      return;
    }
    const mode = activeMode();
    setError('');
    setPending(preset.name);
    try {
      await new Promise<void>(deferAfterPaint);
      if (disposed || presentation() !== admission) return;
      if (!await props.onShellThemeChange(mode, preset.name)) {
        showUpdateFailure();
        return;
      }
      setError('');
    } catch {
      if (!disposed) showUpdateFailure();
    } finally {
      if (!disposed) setPending('');
    }
  };
  // IMPORTANT: Published Floe owns the only appearance view and keyboard mechanics.
  // This adapter preserves the preference owner and rejects hidden admission.
  return (
    <div data-envapp-theme-menu="inline" role="region" aria-label={i18n.t('shell.themePicker.title')}>
      <ThemePicker mode={theme.theme()} modes={THEME_SOURCE_OPTIONS.map(value => ({ value, label: i18n.t(`shell.themePicker.mode.${value}` as EnvAppTranslationKey) }))}
        modeLabel={i18n.t('shell.themePicker.modeLabel')} presets={presets()} selectedPreset={selectedPresetName()} presetLabel={preset => presetLabel(i18n, preset)}
        presetsLabel={i18n.t('shell.themePicker.themesLabel')} pending={pending()} pendingLabel={i18n.t('shell.themePicker.switching')} error={error()}
        onModeChange={value => void selectSource(value as ThemeType)} onPresetChange={preset => void selectPreset(preset)} />
    </div>
  );
}
