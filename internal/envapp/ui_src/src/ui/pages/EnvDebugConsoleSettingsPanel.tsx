import { SettingsPill } from './settings/SettingsPrimitives';
import { useI18n } from '../i18n';

export type EnvDebugConsoleSettingsPanelProps = Readonly<{
  enabled?: boolean;
  canInteract: boolean;
  onEnabledChange?: (value: boolean) => void;
}>;

function DebugConsoleSwitch(props: Readonly<{ checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }>) {
  const i18n = useI18n();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      data-state={props.checked ? 'checked' : 'unchecked'}
      disabled={props.disabled}
      class="env-debug-console-switch inline-flex h-6 w-11 shrink-0 flex-none cursor-pointer items-center rounded-full border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      onClick={() => props.onChange(!props.checked)}
    >
      <span class="env-debug-console-switch__thumb h-4 w-4 rounded-full transition-transform duration-150" />
      <span class="sr-only">{props.checked ? i18n.t('debugConsoleSettings.disableSwitch') : i18n.t('debugConsoleSettings.enableSwitch')}</span>
    </button>
  );
}

export function EnvDebugConsoleSettingsPanel(props: EnvDebugConsoleSettingsPanelProps) {
  const i18n = useI18n();
  return (
    <div class="space-y-2">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-3">
          <DebugConsoleSwitch
            checked={Boolean(props.enabled)}
            onChange={(value) => props.onEnabledChange?.(value)}
            disabled={!props.canInteract}
          />
          <div>
            <div class="text-sm font-medium text-foreground">
              {props.enabled ? i18n.t('debugConsoleSettings.enabled') : i18n.t('debugConsoleSettings.disabled')}
            </div>
            <p class="text-xs text-muted-foreground">
              {i18n.t('debugConsoleSettings.localOnlyDescription')}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <SettingsPill tone="success">{i18n.t('debugConsoleSettings.frontendOnly')}</SettingsPill>
        </div>
      </div>
    </div>
  );
}
