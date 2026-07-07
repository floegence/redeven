import { Show, createSignal } from 'solid-js';
import { BugIcon, Code, ChevronDown, Home, Link, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { cn } from '@floegence/floe-webapp-core';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection } from '../SettingsPrimitives';
import type { CodexHostStatus } from '../types';
import { useI18n } from '../../../i18n';

export function CodexSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();

  const codexStatus = () => ctx.codexStatus() as CodexHostStatus | null;
  const loaded = () => codexStatus() !== null;
  const hostOk = () => Boolean(codexStatus()?.available);
  const bridgeOk = () => Boolean(codexStatus()?.ready);
  const [showDetails, setShowDetails] = createSignal(false);

  return (
    <SettingsSection
      icon={Code}
      title={i18n.t('codexSettings.title')}
      description={i18n.t('codexSettings.description')}
      badge={hostOk() ? i18n.t('codexSettings.hostDetected') : i18n.t('codexSettings.needsHostInstall')}
      badgeVariant={hostOk() ? 'success' : 'default'}
      error={ctx.codexStatus.error ? String(ctx.codexStatus.error) : null}
      actions={
        <Button size="sm" variant="outline" onClick={() => ctx.refreshCodexStatus()} disabled={ctx.codexStatus.loading}>
          <RefreshIcon class="mr-2 h-4 w-4" />
          {ctx.codexStatus.loading ? i18n.t('codexSettings.refreshing') : i18n.t('common.actions.refresh')}
        </Button>
      }
    >
      <Show when={!loaded() || hostOk()}>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class={cn('rounded-xl border p-4', hostOk() ? 'border-success/30 bg-success/5' : 'border-border/50 bg-background')}>
            <div class="flex items-center gap-3">
              <div class={cn('flex h-10 w-10 items-center justify-center rounded-full', hostOk() ? 'bg-success/15' : 'bg-muted')}>
                <Code class={cn('h-5 w-5', hostOk() ? 'text-success' : 'text-muted-foreground')} />
              </div>
              <div>
                <div class="text-sm font-semibold text-foreground">
                  {loaded() ? (hostOk() ? i18n.t('codexSettings.status.detected') : i18n.t('codexSettings.status.notFound')) : '—'}
                </div>
                <div class="text-[11px] text-muted-foreground">{i18n.t('codexSettings.pills.hostBinaryDetected')}</div>
              </div>
            </div>
          </div>
          <div class={cn('rounded-xl border p-4', bridgeOk() ? 'border-success/30 bg-success/5' : 'border-border/50 bg-background')}>
            <div class="flex items-center gap-3">
              <div class={cn('flex h-10 w-10 items-center justify-center rounded-full', bridgeOk() ? 'bg-success/15' : 'bg-muted')}>
                <Link class={cn('h-5 w-5', bridgeOk() ? 'text-success' : 'text-muted-foreground')} />
              </div>
              <div>
                <div class="text-sm font-semibold text-foreground">
                  {loaded() ? (bridgeOk() ? i18n.t('codexSettings.status.connected') : i18n.t('codexSettings.status.startsOnDemand')) : '—'}
                </div>
                <div class="text-[11px] text-muted-foreground">{i18n.t('codexSettings.pills.bridgeConnected')}</div>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <Show when={loaded() && !hostOk()}>
        <div class="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/20 p-4">
          <Code class="h-5 w-5 text-muted-foreground" />
          <div class="text-sm text-muted-foreground">{i18n.t('codexSettings.installNotice')}</div>
        </div>
      </Show>

      <div class="mt-4">
        <button
          type="button"
          class="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          onClick={() => setShowDetails(!showDetails())}
        >
          <ChevronDown class={`h-3 w-3 transition-transform ${showDetails() ? '' : '-rotate-90'}`} />
          技术详情
        </button>
        <Show when={showDetails()}>
          <div class="mt-2 rounded-lg border border-border/40 bg-muted/20 px-4 py-3 space-y-2.5">
            <div class="flex min-w-0 items-start gap-2">
              <Code class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <div class="min-w-0">
                <div class="text-[11px] text-muted-foreground">{i18n.t('codexSettings.rows.binaryPath')}</div>
                <code class="text-[11px] font-mono text-foreground">{codexStatus()?.binary_path || '—'}</code>
              </div>
            </div>
            <div class="flex min-w-0 items-start gap-2">
              <Home class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <div class="min-w-0">
                <div class="text-[11px] text-muted-foreground">{i18n.t('codexSettings.rows.agentHomeDir')}</div>
                <code class="text-[11px] font-mono text-foreground">{codexStatus()?.agent_home_dir || '—'}</code>
              </div>
            </div>
            <div class="flex min-w-0 items-start gap-2">
              <BugIcon class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <div class="min-w-0">
                <div class="text-[11px] text-muted-foreground">错误信息</div>
                <code class="text-[11px] font-mono text-foreground">{codexStatus()?.error || '—'}</code>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </SettingsSection>
  );
}
