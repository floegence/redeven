import { Show } from 'solid-js';
import { RefreshIcon, Code } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, PropertyRow, DotIndicator } from '../SettingsPrimitives';
import type { CodexHostStatus } from '../types';
import { useI18n } from '../../../i18n';

export function CodexSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();

  const codexStatus = () => ctx.codexStatus() as CodexHostStatus | null;
  const loaded = () => codexStatus() !== null;

  return (
    <SettingsSection
      icon={RefreshIcon}
      title={i18n.t('codexSettings.title')}
      description={i18n.t('codexSettings.description')}
      badge={codexStatus()?.available ? i18n.t('codexSettings.hostDetected') : i18n.t('codexSettings.needsHostInstall')}
      badgeVariant={codexStatus()?.available ? 'success' : 'default'}
      error={ctx.codexStatus.error ? String(ctx.codexStatus.error) : null}
      actions={
        <Button size="sm" variant="outline" onClick={() => ctx.refreshCodexStatus()} disabled={ctx.codexStatus.loading}>
          <RefreshIcon class="mr-2 h-4 w-4" />
          {ctx.codexStatus.loading ? i18n.t('codexSettings.refreshing') : i18n.t('common.actions.refresh')}
        </Button>
      }
    >
      <div class="flex flex-wrap items-center gap-4 mb-4">
        <DotIndicator active={Boolean(codexStatus()?.available)} label={i18n.t('codexSettings.pills.hostBinaryDetected')} />
        <DotIndicator active={Boolean(codexStatus()?.ready)} label={i18n.t('codexSettings.pills.bridgeConnected')} />
      </div>

      <Show when={loaded() && !codexStatus()?.available}>
        <div class="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 p-3 mb-4">
          <Code class="h-4 w-4 text-muted-foreground" />
          <div class="text-xs text-muted-foreground">{i18n.t('codexSettings.installNotice')}</div>
        </div>
      </Show>

      <PropertyRow label={i18n.t('codexSettings.rows.binary')} mono>
        {loaded() ? (codexStatus()!.available ? i18n.t('codexSettings.status.detected') : i18n.t('codexSettings.status.notFound')) : i18n.t('codexSettings.status.notAvailable')}
      </PropertyRow>
      <PropertyRow label={i18n.t('codexSettings.rows.binaryPath')} mono>
        {codexStatus()?.binary_path || '—'}
      </PropertyRow>
      <PropertyRow label={i18n.t('codexSettings.rows.agentHomeDir')} mono>
        {codexStatus()?.agent_home_dir || '—'}
      </PropertyRow>
      <PropertyRow label={i18n.t('codexSettings.rows.bridge')}>
        <DotIndicator active={Boolean(codexStatus()?.ready)} label={codexStatus()?.ready ? i18n.t('codexSettings.status.connected') : i18n.t('codexSettings.status.startsOnDemand')} />
      </PropertyRow>
      <PropertyRow label={i18n.t('codexSettings.rows.error')} mono>
        {codexStatus()?.error || '—'}
      </PropertyRow>

      <div class="mt-4 pt-4 border-t border-border/20">
        <div class="text-xs leading-6 text-muted-foreground">
          {i18n.t('codexSettings.notesHostRuntimeDefaults')}
        </div>
        <div class="text-xs leading-6 text-muted-foreground">
          {i18n.t('codexSettings.notesActivityIsolation')}
        </div>
      </div>
    </SettingsSection>
  );
}
