import { Show, createMemo } from 'solid-js';
import { RefreshIcon, Code } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsCard, SettingsPill, SettingsKeyValueTable } from '../SettingsPrimitives';
import type { CodexHostStatus } from '../types';

export function CodexSection() {
  const ctx = useEnvSettingsPage();

  const codexStatus = () => ctx.codexStatus() as CodexHostStatus | null;

  const codexStatusRows = createMemo(() => {
    const s: CodexHostStatus | null = codexStatus();
    if (!s) return [
      { label: 'Binary', value: 'Not available', note: 'Status not loaded' },
      { label: 'Binary path', value: '—' },
      { label: 'Agent home dir', value: '—' },
      { label: 'Bridge', value: '—' },
      { label: 'Error', value: '—' },
    ];
    return [
      { label: 'Binary', value: s.available ? 'Detected' : 'Not found', mono: true },
      { label: 'Binary path', value: s.binary_path || '—', mono: true },
      { label: 'Agent home dir', value: s.agent_home_dir || '—', mono: true },
      { label: 'Bridge', value: s.ready ? 'Connected' : 'Starts on demand', mono: true },
      { label: 'Error', value: s.error || 'None', mono: true },
    ];
  });

  return (
    <SettingsCard
      icon={RefreshIcon}
      title="Codex"
      description="Host-managed Codex diagnostics. Redeven reads the host codex binary status here but does not persist Codex runtime settings."
      badge={codexStatus()?.available ? 'Host detected' : 'Needs host install'}
      badgeVariant={codexStatus()?.available ? 'success' : 'default'}
      error={ctx.codexStatus.error ? String(ctx.codexStatus.error) : null}
      actions={
        <Button size="sm" variant="outline" onClick={() => ctx.refreshCodexStatus()} disabled={ctx.codexStatus.loading}>
          <RefreshIcon class="mr-2 h-4 w-4" />
          {ctx.codexStatus.loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      }
    >
      <div class="space-y-6">
        <div class="flex flex-wrap gap-2">
          <SettingsPill tone={codexStatus()?.available ? 'success' : 'default'}>
            {codexStatus()?.available ? 'Host binary detected' : 'Install Codex on host'}
          </SettingsPill>
          <SettingsPill tone={codexStatus()?.ready ? 'success' : 'default'}>
            {codexStatus()?.ready ? 'Bridge connected' : 'Bridge starts on demand'}
          </SettingsPill>
        </div>

        <Show when={!codexStatus()?.available}>
          <div class="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <Code class="h-5 w-5 text-muted-foreground" />
            <div class="text-sm text-muted-foreground">
              Redeven is waiting for the host <span class="font-mono">codex</span> binary. Install it on the host and expose it on <span class="font-mono">PATH</span>.
            </div>
          </div>
        </Show>

        <SettingsKeyValueTable rows={codexStatusRows()} minWidthClass="min-w-[40rem]" />

        <div class="rounded-lg border border-border bg-muted/20 p-4">
          <div class="text-sm font-semibold text-foreground">Notes</div>
          <div class="mt-2 space-y-1 text-xs leading-6 text-muted-foreground">
            <div>Codex keeps its own runtime defaults on the host; Redeven does not mirror them into <span class="font-mono">config.json</span>.</div>
            <div>The dedicated Codex activity entry and gateway namespace stay isolated from Flower.</div>
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}
