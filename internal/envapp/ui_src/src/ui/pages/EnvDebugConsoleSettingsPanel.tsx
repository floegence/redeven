import { Button, Checkbox } from '@floegence/floe-webapp-core/ui';

import {
  AutoSaveIndicator,
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
  collectUIMetrics: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  savedAt: number | null;
  canInteract: boolean;
  onEnabledChange: (value: boolean) => void;
  onCollectUIMetricsChange: (value: boolean) => void;
  onOpenConsole: () => void;
}>;

export function EnvDebugConsoleSettingsPanel(props: EnvDebugConsoleSettingsPanelProps) {
  return (
    <div class="border-t border-border/70 pt-4">
      <SubSectionHeader
        title="Debug Console"
        description="Enable a floating operator console for live request traces, runtime status, and local UI rendering metrics."
        actions={(
          <div class="flex items-center gap-2">
            <SettingsPill tone="success">Live apply</SettingsPill>
            <AutoSaveIndicator
              dirty={props.dirty}
              saving={props.saving}
              error={props.error}
              savedAt={props.savedAt}
              enabled={props.canInteract}
            />
          </div>
        )}
      />

      <div class="mt-3 space-y-4">
        <SettingsTable minWidthClass="min-w-[44rem]">
          <SettingsTableHead>
            <SettingsTableHeaderRow>
              <SettingsTableHeaderCell class="w-48">Setting</SettingsTableHeaderCell>
              <SettingsTableHeaderCell>Value</SettingsTableHeaderCell>
              <SettingsTableHeaderCell class="w-72">Notes</SettingsTableHeaderCell>
            </SettingsTableHeaderRow>
          </SettingsTableHead>
          <SettingsTableBody>
            <SettingsTableRow>
              <SettingsTableCell class="font-medium text-muted-foreground">enabled</SettingsTableCell>
              <SettingsTableCell>
                <label class="flex items-center gap-3 text-sm text-foreground">
                  <Checkbox
                    checked={props.enabled}
                    onChange={(value) => props.onEnabledChange(value)}
                    disabled={!props.canInteract}
                  />
                  <span>Show the floating debug console across the Env App shell.</span>
                </label>
              </SettingsTableCell>
              <SettingsTableCell class="text-[11px] text-muted-foreground">
                Independent from <code>log_level</code>. When enabled, the window stays above page-local loading overlays and can be minimized to a small pill.
              </SettingsTableCell>
            </SettingsTableRow>
            <SettingsTableRow>
              <SettingsTableCell class="font-medium text-muted-foreground">collect_ui_metrics</SettingsTableCell>
              <SettingsTableCell>
                <label class="flex items-center gap-3 text-sm text-foreground">
                  <Checkbox
                    checked={props.collectUIMetrics}
                    onChange={(value) => props.onCollectUIMetricsChange(value)}
                    disabled={!props.canInteract}
                  />
                  <span>Sample browser rendering metrics such as FPS, long tasks, layout shifts, and memory.</span>
                </label>
              </SettingsTableCell>
              <SettingsTableCell class="text-[11px] text-muted-foreground">
                UI performance data stays local to this browser session and is appended to the exported debug bundle only when this option is enabled.
              </SettingsTableCell>
            </SettingsTableRow>
          </SettingsTableBody>
        </SettingsTable>

        <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/16 px-4 py-3">
          <div class="space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <SettingsPill tone={props.enabled ? 'success' : 'default'}>
                {props.enabled ? 'Console enabled' : 'Console disabled'}
              </SettingsPill>
              <SettingsPill tone={props.collectUIMetrics ? 'success' : 'default'}>
                {props.collectUIMetrics ? 'UI metrics enabled' : 'UI metrics optional'}
              </SettingsPill>
            </div>
            <div class="text-[11px] leading-5 text-muted-foreground">
              Request tracing starts and stops at runtime from this setting, so there is no restart-only diagnostics mode to maintain here anymore.
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={props.onOpenConsole} disabled={!props.enabled}>
            Open floating console
          </Button>
        </div>
      </div>
    </div>
  );
}
