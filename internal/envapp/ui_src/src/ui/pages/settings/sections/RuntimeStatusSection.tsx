import { Show, createMemo } from 'solid-js';
import { Zap, RefreshIcon, FileCode, Globe, Key, Link } from '@floegence/floe-webapp-core/icons';
import { Button, Input } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import {
  SettingsCard, SettingsTable, SettingsTableHead, SettingsTableHeaderRow, SettingsTableHeaderCell,
  SettingsTableBody, SettingsTableRow, SettingsTableCell, SettingsPill, CopyButton, InfoRow,
} from '../SettingsPrimitives';
import { formatRuntimeServiceOwner, runtimeServiceCompatibilityTone, formatRuntimeServiceCompatibility } from './helpers';

function formatDesktopModelSourceBindingState(value: unknown): string {
  switch (String(value ?? '').trim()) {
    case 'bound': return 'Bound';
    case 'unbound': return 'Unbound';
    case 'unsupported': return 'Unsupported';
    case 'expired': return 'Expired';
    case 'error': return 'Error';
    default: return 'Unknown';
  }
}

function desktopModelSourceBindingTone(value: unknown): 'default' | 'warning' | 'success' {
  switch (String(value ?? '').trim()) {
    case 'bound': return 'success';
    case 'unsupported': case 'expired': case 'error': return 'warning';
    default: return 'default';
  }
}

export function RuntimeStatusSection() {
  const ctx = useEnvSettingsPage();

  return (
    <SettingsCard
      icon={Zap}
      title="Runtime Status"
      description="Version, health, and maintenance controls for this runtime."
      badge={ctx.statusLabel()}
      badgeVariant={ctx.displayedStatus() === 'online' ? 'success' : ctx.displayedStatus() === 'offline' ? 'warning' : 'default'}
      error={ctx.maintenanceError()}
      actions={
        <>
          <Button size="sm" variant="outline" class="gap-1.5" onClick={() => void ctx.startRestart()}
            loading={ctx.isRestarting()} disabled={!ctx.canStartRestart()}>
            <RefreshIcon class="w-3.5 h-3.5" />Restart
          </Button>
          <Show when={ctx.upgradeState().allowsUpgradeAction}>
            <Button size="sm" variant="default" onClick={() => void ctx.startUpgrade()}
              loading={ctx.isUpgrading()} disabled={!ctx.canStartUpgrade()}>
              {ctx.upgradeState().actionLabel}
            </Button>
          </Show>
        </>
      }
    >
      <SettingsTable minWidthClass="min-w-[44rem]">
        <SettingsTableHead>
          <SettingsTableHeaderRow>
            <SettingsTableHeaderCell class="w-48">Metric</SettingsTableHeaderCell>
            <SettingsTableHeaderCell>Value</SettingsTableHeaderCell>
            <SettingsTableHeaderCell class="w-72">Notes</SettingsTableHeaderCell>
          </SettingsTableHeaderRow>
        </SettingsTableHead>
        <SettingsTableBody>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">Current version</SettingsTableCell>
            <SettingsTableCell class="font-mono text-[11px]">{ctx.runtimeUpdate.version.currentVersion() || '—'}</SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">Version currently running on this endpoint.</SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">Latest version</SettingsTableCell>
            <SettingsTableCell class="font-mono text-[11px]">
              {ctx.latestVersion()?.latest_version ? String(ctx.latestVersion()!.latest_version) : ctx.latestVersionLoading() ? 'Loading...' : '—'}
            </SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">Latest release metadata resolved by the updater.</SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">Status</SettingsTableCell>
            <SettingsTableCell>
              <SettingsPill tone={ctx.displayedStatus() === 'online' ? 'success' : ctx.displayedStatus() === 'offline' ? 'warning' : 'default'}>
                {ctx.statusLabel()}
              </SettingsPill>
            </SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">Current status as observed by the maintenance controller.</SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">Service owner</SettingsTableCell>
            <SettingsTableCell>{formatRuntimeServiceOwner(ctx.runtimeService())}</SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">Lifecycle owner for this persistent Runtime Service.</SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">Maintenance authority</SettingsTableCell>
            <SettingsTableCell>{ctx.maintenanceContext()?.authority ? String(ctx.maintenanceContext()!.authority).replace(/_/g, ' ') : 'Runtime RPC'}</SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">Current owner for restart and update actions in this session.</SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">Compatibility</SettingsTableCell>
            <SettingsTableCell>
              <SettingsPill tone={runtimeServiceCompatibilityTone(ctx.runtimeService())}>
                {formatRuntimeServiceCompatibility(ctx.runtimeService())}
              </SettingsPill>
            </SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">
              {ctx.runtimeService()?.compatibilityMessage || 'Desktop and Runtime Service compatibility state.'}
            </SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">Active work</SettingsTableCell>
            <SettingsTableCell>{ctx.activeWorkSummary()}</SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">Live work that may be interrupted by maintenance.</SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">Runtime protocol</SettingsTableCell>
            <SettingsTableCell class="font-mono text-[11px]">{ctx.runtimeService()?.protocolVersion || '—'}</SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">Service identity protocol reported by the runtime.</SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">Desktop model source</SettingsTableCell>
            <SettingsTableCell>
              <SettingsPill tone={desktopModelSourceBindingTone(ctx.runtimeDesktopModelSourceBinding()?.state)}>
                {formatDesktopModelSourceBindingState(ctx.runtimeDesktopModelSourceBinding()?.state)}
              </SettingsPill>
            </SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">
              {ctx.runtimeDesktopModelSourceBinding()?.lastError || 'Session binding state for Desktop-provided Flower models.'}
            </SettingsTableCell>
          </SettingsTableRow>
          <Show when={ctx.upgradeState().allowsUpgradeAction && ctx.upgradeState().requiresTargetVersion}>
            <SettingsTableRow>
              <SettingsTableCell class="font-medium text-muted-foreground">Target version</SettingsTableCell>
              <SettingsTableCell>
                <Input value={ctx.targetVersionInput()} onInput={(e) => ctx.setTargetVersionInput(e.currentTarget.value)}
                  placeholder="v1.2.3" size="sm" class="w-full" disabled={ctx.maintaining()} />
              </SettingsTableCell>
              <SettingsTableCell class="text-[11px] text-muted-foreground">Release tag used when the update action is triggered.</SettingsTableCell>
            </SettingsTableRow>
          </Show>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">Manifest ETag</SettingsTableCell>
            <SettingsTableCell class="font-mono text-[11px]">{ctx.latestVersion()?.manifest_etag ? String(ctx.latestVersion()!.manifest_etag) : '—'}</SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">Cache validator for the latest version manifest.</SettingsTableCell>
          </SettingsTableRow>
        </SettingsTableBody>
      </SettingsTable>

      <div class="mt-3 space-y-2">
        <Show when={ctx.upgradeState().requiresTargetVersion && ctx.targetUpgradeVersion() && !ctx.targetUpgradeVersionValid()}>
          <div class="text-xs text-destructive">Use a valid release tag, for example: v1.2.3.</div>
        </Show>
        <Show when={ctx.upgradeState().message}>
          <div class="text-xs text-muted-foreground">{ctx.upgradeState().message}</div>
        </Show>
        <Show when={ctx.upgradeState().policy === 'desktop_release' && ctx.upgradeState().releasePageURL}>
          <div class="text-xs text-muted-foreground">Desktop can open the matching release page if the installed app needs to be updated first.</div>
        </Show>
        <Show when={ctx.latestVersionError()}>
          <div class="text-xs text-destructive">Latest version metadata is unavailable: {ctx.latestVersionError()}</div>
        </Show>
        <Show when={ctx.latestVersion()?.stale}>
          <div class="text-xs text-muted-foreground">Using stale version metadata from cache. Please retry refresh if possible.</div>
        </Show>
        <Show when={!ctx.canAdmin()}>
          <div class="text-xs text-muted-foreground">Admin permission required.</div>
        </Show>
        <Show when={ctx.maintenanceStage()}>
          <div class="text-xs text-muted-foreground">{ctx.maintenanceStage()}</div>
        </Show>
      </div>
    </SettingsCard>
  );
}
