import { createMemo, createSignal, onCleanup } from 'solid-js';
import { builtInShellThemePresets, getShellThemePresetsForMode, deferAfterPaint, type FloeShellThemeMode, type FloeThemePreset } from '@floegence/floe-webapp-core';
import { ThemePicker } from '@floegence/floe-webapp-core/ui';
import type { DesktopI18n, DesktopTranslationKey } from '../shared/i18n';
import type { DesktopThemeSource } from '../shared/desktopTheme';

export type DesktopThemePickerSnapshot = Readonly<{
  source: DesktopThemeSource;
  resolvedTheme: FloeShellThemeMode;
  shellThemes: Readonly<Record<FloeShellThemeMode, string>>;
}>;

export type DesktopThemePickerProps = Readonly<{
  active?: boolean;
  snapshot: DesktopThemePickerSnapshot;
  i18n: DesktopI18n;
  onSourceChange: (source: DesktopThemeSource) => DesktopThemePickerSnapshot | Promise<DesktopThemePickerSnapshot>;
  onShellThemeChange: (mode: FloeShellThemeMode, presetName: string) => DesktopThemePickerSnapshot | Promise<DesktopThemePickerSnapshot>;
}>;

const THEME_SOURCE_OPTIONS = ['system', 'light', 'dark'] as const satisfies readonly DesktopThemeSource[];

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
} as const satisfies Readonly<Record<string, string>>;

function translationKey(value: string): DesktopTranslationKey {
  return value as DesktopTranslationKey;
}

function sourceLabelKey(source: DesktopThemeSource): DesktopTranslationKey {
  return translationKey(`shell.themePicker.mode.${source}`);
}

export function desktopThemePresetLabel(i18n: DesktopI18n, preset: FloeThemePreset): string {
  const key = PRESET_TRANSLATION_KEYS[preset.name as keyof typeof PRESET_TRANSLATION_KEYS];
  return key ? i18n.t(translationKey(key)) : preset.displayName;
}

export function desktopThemePresetsForMode(mode: FloeShellThemeMode): readonly FloeThemePreset[] {
  return getShellThemePresetsForMode(builtInShellThemePresets, mode);
}

export function DesktopThemePicker(props: DesktopThemePickerProps) {
  // IMPORTANT: A deferred choice belongs to one presentation lifetime. Hiding
  // and immediately returning must not revive an unadmitted preference write.
  const presentation = createMemo(() => props.active !== false ? {} : null);
  const [error, setError] = createSignal('');
  const [pending, setPending] = createSignal('');
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const activeMode = createMemo<FloeShellThemeMode>(() => (
    props.snapshot.source === 'system' ? props.snapshot.resolvedTheme : props.snapshot.source
  ));
  const presets = createMemo(() => desktopThemePresetsForMode(activeMode()));
  const selectedPresetName = createMemo(() => props.snapshot.shellThemes[activeMode()]);

  const showUpdateFailure = () => {
    setError(props.i18n.t(translationKey('shell.themePicker.changeFailed')));
  };

  const selectSource = async (source: DesktopThemeSource) => {
    const admission = presentation();
    if (!admission || pending()) return;
    if (source === props.snapshot.source) {
      setError('');
      return;
    }
    setError('');
    setPending(`mode-${source}`);
    try {
      await new Promise<void>(deferAfterPaint);
      if (disposed || presentation() !== admission) return;
      const result = await props.onSourceChange(source);
      if (result.source !== source) {
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
    const mode = activeMode();
    if (preset.name === props.snapshot.shellThemes[mode]) {
      setError('');
      return;
    }
    setError('');
    setPending(preset.name);
    try {
      await new Promise<void>(deferAfterPaint);
      if (disposed || presentation() !== admission) return;
      const result = await props.onShellThemeChange(mode, preset.name);
      if (result.shellThemes[mode] !== preset.name) {
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

  // IMPORTANT: Welcome and Env consume the same published appearance surface.
  // This adapter owns only native theme persistence and pending validation.
  return <ThemePicker mode={props.snapshot.source}
    modes={THEME_SOURCE_OPTIONS.map(value => ({ value, label: props.i18n.t(sourceLabelKey(value)) }))}
    modeLabel={props.i18n.t('shell.themePicker.modeLabel')} presets={presets()} selectedPreset={selectedPresetName()}
    presetLabel={preset => desktopThemePresetLabel(props.i18n, preset)} presetsLabel={props.i18n.t('shell.themePicker.themesLabel')}
    pending={pending()} pendingLabel={props.i18n.t('shell.themePicker.switching')} error={error()}
    onModeChange={value => void selectSource(value as DesktopThemeSource)} onPresetChange={preset => void selectPreset(preset)} />;

}
