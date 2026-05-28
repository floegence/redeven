import { Show, createMemo } from 'solid-js';
import { RefreshIcon, Code } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, SettingsPill, SettingsKeyValueTable } from '../SettingsPrimitives';
import type { CodexHostStatus } from '../types';
import { useI18n } from '../../../i18n';

export function CodexSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();

  const codexStatus = () => ctx.codexStatus() as CodexHostStatus | null;

  const codexStatusRows = createMemo(() => {
    const s: CodexHostStatus | null = codexStatus();
    if (!s) return [
      { label: i18n.t('codexSettings.rows.binary'), value: i18n.t('codexSettings.status.notAvailable'), note: i18n.t('codexSettings.status.statusNotLoaded') },
      { label: i18n.t('codexSettings.rows.binaryPath'), value: '—' },
      { label: i18n.t('codexSettings.rows.agentHomeDir'), value: '—' },
      { label: i18n.t('codexSettings.rows.bridge'), value: '—' },
      { label: i18n.t('codexSettings.rows.error'), value: '—' },
    ];
    return [
      { label: i18n.t('codexSettings.rows.binary'), value: s.available ? i18n.t('codexSettings.status.detected') : i18n.t('codexSettings.status.notFound'), mono: true },
      { label: i18n.t('codexSettings.rows.binaryPath'), value: s.binary_path || '—', mono: true },
      { label: i18n.t('codexSettings.rows.agentHomeDir'), value: s.agent_home_dir || '—', mono: true },
      { label: i18n.t('codexSettings.rows.bridge'), value: s.ready ? i18n.t('codexSettings.status.connected') : i18n.t('codexSettings.status.startsOnDemand'), mono: true },
      { label: i18n.t('codexSettings.rows.error'), value: s.error || i18n.t('codexSettings.status.none'), mono: true },
    ];
  });

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
      <div class="space-y-6">
        <div class="flex flex-wrap gap-2">
          <SettingsPill tone={codexStatus()?.available ? 'success' : 'default'}>
            {codexStatus()?.available ? i18n.t('codexSettings.pills.hostBinaryDetected') : i18n.t('codexSettings.pills.installCodexOnHost')}
          </SettingsPill>
          <SettingsPill tone={codexStatus()?.ready ? 'success' : 'default'}>
            {codexStatus()?.ready ? i18n.t('codexSettings.pills.bridgeConnected') : i18n.t('codexSettings.pills.bridgeStartsOnDemand')}
          </SettingsPill>
        </div>

        <Show when={!codexStatus()?.available}>
          <div class="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <Code class="h-5 w-5 text-muted-foreground" />
            <div class="text-sm text-muted-foreground">
              {i18n.t('codexSettings.installNotice')}
            </div>
          </div>
        </Show>

        <SettingsKeyValueTable rows={codexStatusRows()} minWidthClass="min-w-[40rem]" />

        <div class="rounded-lg border border-border bg-muted/20 p-4">
          <div class="text-sm font-semibold text-foreground">{i18n.t('codexSettings.notesTitle')}</div>
          <div class="mt-2 space-y-1 text-xs leading-6 text-muted-foreground">
            <div>{i18n.t('codexSettings.notesHostRuntimeDefaults')}</div>
            <div>{i18n.t('codexSettings.notesActivityIsolation')}</div>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
