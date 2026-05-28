import { Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import { Code } from '@floegence/floe-webapp-core/icons';
import { Input, Checkbox } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import {
  SettingsCard, SettingsTable, SettingsTableHead, SettingsTableHeaderRow, SettingsTableHeaderCell,
  SettingsTableBody, SettingsTableRow, SettingsTableCell, ViewToggle,
  AutoSaveIndicator, JSONEditor, type ViewMode,
} from '../SettingsPrimitives';
import { CodeRuntimeSettingsCard } from '../CodeRuntimeSettingsCard';
import { formatUnknownError } from '../../../maintenance/shared';
import { useI18n } from '../../../i18n';

const AUTO_SAVE_DELAY_MS = 700;
const DEFAULT_CODE_SERVER_PORT_MIN = 20000;
const DEFAULT_CODE_SERVER_PORT_MAX = 21000;

function normalizePortRange(min: number, max: number) {
  let m = Number(min), M = Number(max);
  if (!Number.isFinite(m)) m = 0;
  if (!Number.isFinite(M)) M = 0;
  if (m <= 0 || M <= 0 || M > 65535 || m >= M) return { use_default: true, effective_min: DEFAULT_CODE_SERVER_PORT_MIN, effective_max: DEFAULT_CODE_SERVER_PORT_MAX };
  if (m < 1024) m = 1024;
  if (M < 1024) M = 1024;
  if (m >= M) return { use_default: true, effective_min: DEFAULT_CODE_SERVER_PORT_MIN, effective_max: DEFAULT_CODE_SERVER_PORT_MAX };
  return { use_default: false, effective_min: m, effective_max: M };
}

export function CodespacesSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();

  const [viewMode, setViewMode] = createSignal<ViewMode>('ui');
  const [useDefaults, setUseDefaults] = createSignal(true);
  const [portMin, setPortMin] = createSignal<number | ''>('');
  const [portMax, setPortMax] = createSignal<number | ''>('');
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [savedAt, setSavedAt] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    const s = ctx.settings();
    if (!s) return;
    if (!dirty()) {
      const m = Number(s?.codespaces?.code_server_port_min ?? 0);
      const M = Number(s?.codespaces?.code_server_port_max ?? 0);
      const r = normalizePortRange(m, M);
      setUseDefaults(r.use_default);
      setPortMin(r.use_default ? '' : r.effective_min);
      setPortMax(r.use_default ? '' : r.effective_max);
    }
  });

  const effective = createMemo(() => normalizePortRange(
    useDefaults() ? 0 : Number(portMin()),
    useDefaults() ? 0 : Number(portMax()),
  ));

  const jsonText = createMemo(() => JSON.stringify({
    code_server_port_min: useDefaults() ? null : (portMin() === '' ? null : Number(portMin())),
    code_server_port_max: useDefaults() ? null : (portMax() === '' ? null : Number(portMax())),
  }, null, 2));

  let autoSaveTimer: number | undefined;
  const clearTimer = (t: number | undefined) => { if (t != null) { window.clearTimeout(t); return undefined; } return undefined; };

  createEffect(() => {
    if (!dirty() || saving() || !ctx.canInteract()) { autoSaveTimer = clearTimer(autoSaveTimer); return; }
    autoSaveTimer = clearTimer(autoSaveTimer);
    autoSaveTimer = window.setTimeout(async () => {
      autoSaveTimer = undefined;
      if (!dirty() || saving() || !ctx.canInteract()) return;
      setSaving(true);
      try {
        await ctx.saveSettings({
          codespaces: {
            code_server_port_min: useDefaults() ? null : (portMin() === '' ? null : Number(portMin())),
            code_server_port_max: useDefaults() ? null : (portMax() === '' ? null : Number(portMax())),
          },
        });
        setSaving(false); setSavedAt(Date.now()); setDirty(false); setError(null);
      } catch (e) {
        setSaving(false); setError(formatUnknownError(e) || i18n.t('codespacesSettings.saveFailed'));
      }
    }, AUTO_SAVE_DELAY_MS);
  });

  onCleanup(() => { autoSaveTimer = clearTimer(autoSaveTimer); });

  const switchView = (next: ViewMode) => setViewMode(next);

  return (
    <div class="space-y-4">
      <CodeRuntimeSettingsCard
        status={ctx.codeRuntimeStatus()}
        loading={ctx.codeRuntimeStatus.loading}
        error={null}
        localPrepareFailure={ctx.codeRuntimeLocalPrepareFailure()}
        canInteract={ctx.canInteract()}
        canManage={ctx.canManageCodeRuntime()}
        actionLoading={ctx.codeRuntimeActionLoading()}
        cancelLoading={ctx.codeRuntimeCancelLoading()}
        selectionLoadingVersion={ctx.codeRuntimeSelectionLoadingVersion()}
        removeVersionLoading={ctx.codeRuntimeRemoveVersionLoading()}
        onRefresh={() => ctx.refreshCodeRuntimeStatus()}
        onPrepare={() => ctx.prepareManagedCodeRuntime()}
        onSelectVersion={(v) => ctx.selectManagedCodeRuntimeVersion(v)}
        onRemoveVersion={(v) => ctx.removeManagedCodeRuntimeVersion(v)}
        onCancel={() => ctx.cancelManagedCodeRuntimeOperation()}
      />

      <SettingsCard
        icon={Code}
        title={i18n.t('codespacesSettings.title')}
        description={i18n.t('codespacesSettings.description')}
        error={error()}
        actions={
          <>
            <ViewToggle value={viewMode} disabled={!ctx.canInteract()} onChange={switchView} />
            <AutoSaveIndicator dirty={dirty()} saving={saving()} error={error()} savedAt={savedAt()} enabled={ctx.canInteract()} />
          </>
        }
      >
        <Show
          when={viewMode() === 'ui'}
          fallback={<JSONEditor value={jsonText()} onChange={(v) => { try { const p = JSON.parse(v); setUseDefaults(!p.code_server_port_min && !p.code_server_port_max); if (p.code_server_port_min) setPortMin(Number(p.code_server_port_min)); if (p.code_server_port_max) setPortMax(Number(p.code_server_port_max)); setDirty(true); } catch {} }} disabled={!ctx.canInteract()} rows={5} />}
        >
          <div class="space-y-4">
            <label class={`flex items-center gap-2 ${ctx.canInteract() ? 'cursor-pointer' : ''}`}>
              <Checkbox checked={useDefaults()} onChange={(v) => { setUseDefaults(Boolean(v)); setDirty(true); }} disabled={!ctx.canInteract()} />
              <span class="text-sm font-medium text-foreground">{i18n.t('codespacesSettings.useDefaultRange')}</span>
            </label>
            <div class="text-xs text-muted-foreground">
              {i18n.t('codespacesSettings.effectiveRange')}: <code class="font-mono">{effective().effective_min}–{effective().effective_max}</code>
            </div>
            <Show when={!useDefaults()}>
              <SettingsTable minWidthClass="min-w-[36rem]">
                <SettingsTableHead>
                  <SettingsTableHeaderRow>
                    <SettingsTableHeaderCell>{i18n.t('codespacesSettings.setting')}</SettingsTableHeaderCell>
                    <SettingsTableHeaderCell>{i18n.t('codespacesSettings.value')}</SettingsTableHeaderCell>
                    <SettingsTableHeaderCell>{i18n.t('codespacesSettings.notes')}</SettingsTableHeaderCell>
                  </SettingsTableHeaderRow>
                </SettingsTableHead>
                <SettingsTableBody>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">code_server_port_min</SettingsTableCell>
                    <SettingsTableCell>
                      <Input value={portMin() === '' ? '' : String(portMin())}
                        onInput={(e) => { const v = e.currentTarget.value.trim(); setPortMin(v ? Number(v) : ''); setDirty(true); }}
                        placeholder="20000" size="sm" class="w-full" disabled={!ctx.canInteract()} />
                    </SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">{i18n.t('codespacesSettings.minPortNote')}</SettingsTableCell>
                  </SettingsTableRow>
                  <SettingsTableRow>
                    <SettingsTableCell class="font-medium text-muted-foreground">code_server_port_max</SettingsTableCell>
                    <SettingsTableCell>
                      <Input value={portMax() === '' ? '' : String(portMax())}
                        onInput={(e) => { const v = e.currentTarget.value.trim(); setPortMax(v ? Number(v) : ''); setDirty(true); }}
                        placeholder="21000" size="sm" class="w-full" disabled={!ctx.canInteract()} />
                    </SettingsTableCell>
                    <SettingsTableCell class="text-[11px] text-muted-foreground">{i18n.t('codespacesSettings.maxPortNote')}</SettingsTableCell>
                  </SettingsTableRow>
                </SettingsTableBody>
              </SettingsTable>
            </Show>
          </div>
        </Show>
      </SettingsCard>
    </div>
  );
}
