import { Show, createMemo, createSignal } from 'solid-js';
import { FileCode } from '@floegence/floe-webapp-core/icons';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsCard, ViewToggle, CopyButton, JSONEditor, type ViewMode } from '../SettingsPrimitives';

export function ConfigFileSection() {
  const ctx = useEnvSettingsPage();

  const [viewMode, setViewMode] = createSignal<ViewMode>('ui');

  const configPath = createMemo(() => String(ctx.settings()?.config_path ?? ''));
  const configJSONText = createMemo(() => JSON.stringify({ config_path: configPath() }, null, 2));

  return (
    <SettingsCard
      icon={FileCode}
      title="Config File"
      description="Location of the runtime configuration file."
      actions={<ViewToggle value={viewMode} onChange={(v) => setViewMode(v)} />}
    >
      <Show
        when={viewMode() === 'ui'}
        fallback={<JSONEditor value={configJSONText()} onChange={() => undefined} disabled rows={4} />}
      >
        <div class="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <FileCode class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <code class="min-w-0 flex-1 break-all font-mono text-[11px]">{configPath() || '(unknown)'}</code>
          <CopyButton value={configPath() || ''} />
        </div>
        <p class="mt-2 text-[11px] text-muted-foreground">Read-only. Managed by the runtime.</p>
      </Show>
    </SettingsCard>
  );
}
