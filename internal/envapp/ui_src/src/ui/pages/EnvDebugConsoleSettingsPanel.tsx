import { Button } from '@floegence/floe-webapp-core/ui';

import {
  SettingsPill,
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableHead,
  SettingsTableHeaderCell,
  SettingsTableHeaderRow,
  SettingsTableRow,
  SubSectionHeader,
} from './settings/SettingsPrimitives';

export type EnvDebugConsoleSettingsPanelProps = Readonly<{
  enabled: boolean;
  canInteract: boolean;
  onEnabledChange: (value: boolean) => void;
  onOpenConsole: () => void;
}>;

function DebugConsoleSwitch(props: Readonly<{ checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled}
      class={`inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
        props.checked
          ? 'border-primary/30 bg-primary/15 text-primary'
          : 'border-border bg-muted/60 text-muted-foreground'
      } disabled:cursor-not-allowed disabled:opacity-50`}
      onClick={() => props.onChange(!props.checked)}
    >
      <span
        class={`h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${
          props.checked ? 'translate-x-[1.3rem]' : 'translate-x-1'
        }`}
      />
      <span class="sr-only">{props.checked ? 'Disable debug console' : 'Enable debug console'}</span>
    </button>
  );
}

export function EnvDebugConsoleSettingsPanel(props: EnvDebugConsoleSettingsPanelProps) {
  return (
    <div class="space-y-4">
      <SubSectionHeader
        title="Debug Console"
        description="Control the floating diagnostics window for this browser session. Logging stays independent, and local UI metrics start automatically while the console is visible."
        actions={(
          <div class="flex flex-wrap items-center gap-2">
            <SettingsPill tone="success">Frontend only</SettingsPill>
            <SettingsPill tone="default">No agent config writes</SettingsPill>
          </div>
        )}
      />

      <SettingsTable minWidthClass="min-w-[44rem]">
        <SettingsTableHead>
          <SettingsTableHeaderRow>
            <SettingsTableHeaderCell class="w-48">Setting</SettingsTableHeaderCell>
            <SettingsTableHeaderCell>Value</SettingsTableHeaderCell>
            <SettingsTableHeaderCell class="w-80">Notes</SettingsTableHeaderCell>
          </SettingsTableHeaderRow>
        </SettingsTableHead>
        <SettingsTableBody>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">visible</SettingsTableCell>
            <SettingsTableCell>
              <label class="flex items-center gap-3 text-sm text-foreground">
                <DebugConsoleSwitch
                  checked={props.enabled}
                  onChange={(value) => props.onEnabledChange(value)}
                  disabled={!props.canInteract}
                />
                <span>Show the floating debug console in this Env App session.</span>
              </label>
            </SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">
              This switch is local to the current UI session. It does not change <code>log_level</code>, <code>log_format</code>, or any persisted agent setting.
            </SettingsTableCell>
          </SettingsTableRow>
        </SettingsTableBody>
      </SettingsTable>

      <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/16 px-4 py-3">
        <div class="space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <SettingsPill tone={props.enabled ? 'success' : 'default'}>
              {props.enabled ? 'Console visible' : 'Console hidden'}
            </SettingsPill>
            <SettingsPill tone={props.enabled ? 'success' : 'default'}>
              {props.enabled ? 'UI metrics active' : 'UI metrics start on open'}
            </SettingsPill>
          </div>
          <div class="text-[11px] leading-5 text-muted-foreground">
            Backend diagnostics stay available independently. This section only controls the frontend console surface and browser-local instrumentation.
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={props.onOpenConsole} disabled={!props.enabled}>
          Open floating console
        </Button>
      </div>
    </div>
  );
}
