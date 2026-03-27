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
}>;

function DebugConsoleSwitch(props: Readonly<{ checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }>) {
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
      <span class="sr-only">{props.checked ? 'Disable debug console' : 'Enable debug console'}</span>
    </button>
  );
}

export function EnvDebugConsoleSettingsPanel(props: EnvDebugConsoleSettingsPanelProps) {
  return (
    <div class="space-y-4">
      <SubSectionHeader
        title="Debug Console"
        description="Control the floating diagnostics window for this browser session. Logging stays independent, and diagnostics collection starts only while the floating console is open."
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
              <div class="flex items-center">
                <DebugConsoleSwitch
                  checked={props.enabled}
                  onChange={(value) => props.onEnabledChange(value)}
                  disabled={!props.canInteract}
                />
              </div>
            </SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">
              This switch is local to the current UI session. It does not change <code>log_level</code>, <code>log_format</code>, or any persisted agent setting.
            </SettingsTableCell>
          </SettingsTableRow>
        </SettingsTableBody>
      </SettingsTable>
    </div>
  );
}
