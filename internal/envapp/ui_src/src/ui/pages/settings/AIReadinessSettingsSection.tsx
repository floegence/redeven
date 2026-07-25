import { For, Show, createMemo, createSignal } from 'solid-js';
import { Check, Copy, Database, RefreshIcon } from '@floegence/floe-webapp-core/icons';

import { useI18n } from '../../i18n';
import type { AIReadinessController } from '../../flower/aiReadiness';
import { createAIReadinessPresentation } from '../../flower/aiReadinessPresentation';
import { SettingsList, SettingsPill, SettingsSection, SettingRow } from './SettingsPrimitives';

const BUTTON_CLASS = 'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-semibold text-foreground transition-colors motion-reduce:transition-none hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55';

export function AIReadinessSettingsSection(props: Readonly<{ controller: AIReadinessController }>) {
  const i18n = useI18n();
  const presentation = createMemo(() => createAIReadinessPresentation(props.controller.snapshot(), i18n));
  const [diagnosticsOpen, setDiagnosticsOpen] = createSignal(false);
  const [copyPending, setCopyPending] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [copyFailed, setCopyFailed] = createSignal(false);

  const statusLabel = createMemo(() => {
    if (props.controller.loading()) return i18n.t('aiReadiness.settings.refreshing');
    if (presentation().mode === 'ready') return i18n.t('aiReadiness.settings.noIssue');
    if (presentation().mode === 'busy') return i18n.t('aiReadiness.diagnostics.statusChecking');
    return presentation().title;
  });

  const statusTone = createMemo<'success' | 'warning' | 'danger'>(() => (
    presentation().mode === 'ready'
      ? 'success'
      : presentation().tone === 'danger'
        ? 'danger'
        : 'warning'
  ));

  const copyDiagnostics = async (): Promise<void> => {
    if (copyPending()) return;
    setCopyPending(true);
    setCopied(false);
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(presentation().diagnosticText);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    } finally {
      setCopyPending(false);
    }
  };

  return (
    <SettingsSection
      icon={Database}
      title={i18n.t('aiReadiness.settings.title')}
      description={i18n.t('aiReadiness.settings.description')}
    >
      <SettingsList class="ai-readiness-settings">
        <SettingRow
          icon={Database}
          title={i18n.t('aiReadiness.diagnostics.ownerFloret')}
          description={i18n.t('aiReadiness.settings.floretDescription')}
          tone={statusTone()}
          control={<SettingsPill tone={statusTone()}>{statusLabel()}</SettingsPill>}
        >
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class={BUTTON_CLASS}
              disabled={props.controller.loading() || props.controller.retryPending()}
              aria-busy={props.controller.loading() ? 'true' : undefined}
              data-pending={props.controller.loading() ? 'true' : undefined}
              onClick={() => void props.controller.refresh()}
            >
              <RefreshIcon class={`h-4 w-4 ${props.controller.loading() ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
              <span>{props.controller.loading() ? i18n.t('aiReadiness.settings.refreshing') : i18n.t('common.actions.refresh')}</span>
            </button>
            <button
              type="button"
              class={BUTTON_CLASS}
              aria-expanded={diagnosticsOpen()}
              onClick={() => {
                setDiagnosticsOpen((open) => !open);
                setCopied(false);
              }}
            >
              <span>{diagnosticsOpen() ? i18n.t('aiReadiness.actions.hideDiagnostics') : i18n.t('aiReadiness.actions.showDiagnostics')}</span>
            </button>
          </div>
          <Show when={diagnosticsOpen()}>
            <div class="mt-3 border-t border-border pt-3" data-testid="ai-readiness-settings-diagnostics">
              <p class="text-xs leading-relaxed text-muted-foreground">{i18n.t('aiReadiness.diagnostics.description')}</p>
              <dl class="mt-3 divide-y divide-border border-y border-border">
                <For each={presentation().diagnosticRows}>{(row) => (
                  <div class="grid min-w-0 grid-cols-[minmax(7.5rem,0.8fr)_minmax(0,1fr)] gap-4 py-2 text-xs max-[420px]:grid-cols-1 max-[420px]:gap-1">
                    <dt class="text-muted-foreground">{row.label}</dt>
                    <dd class="min-w-0 break-words font-semibold text-foreground">{row.value}</dd>
                  </div>
                )}</For>
              </dl>
              <button
                type="button"
                class={`${BUTTON_CLASS} mt-3`}
                disabled={copyPending()}
                aria-busy={copyPending() ? 'true' : undefined}
                data-pending={copyPending() ? 'true' : undefined}
                onClick={() => void copyDiagnostics()}
              >
                <Show when={copied()} fallback={<Copy class="h-4 w-4" aria-hidden="true" />}>
                  <Check class="h-4 w-4" aria-hidden="true" />
                </Show>
                <span>{copyPending()
                  ? i18n.t('aiReadiness.actions.copyingDiagnostics')
                  : copyFailed()
                    ? i18n.t('aiReadiness.actions.copyDiagnosticsFailed')
                  : copied()
                    ? i18n.t('aiReadiness.actions.diagnosticsCopied')
                    : i18n.t('aiReadiness.actions.copyDiagnostics')}</span>
              </button>
              <Show when={copied() || copyFailed()}>
                <span class="sr-only" role="status">
                  {copyFailed()
                    ? i18n.t('aiReadiness.actions.copyDiagnosticsFailed')
                    : i18n.t('aiReadiness.actions.diagnosticsCopied')}
                </span>
              </Show>
            </div>
          </Show>
        </SettingRow>
        <SettingRow
          icon={Database}
          title={i18n.t('aiReadiness.settings.redevenOwner')}
          description={i18n.t('aiReadiness.settings.redevenDescription')}
          control={<SettingsPill>{i18n.t('aiReadiness.settings.notChecked')}</SettingsPill>}
        />
        <SettingRow
          icon={Database}
          title={i18n.t('aiReadiness.settings.upstreamOwner')}
          description={i18n.t('aiReadiness.settings.upstreamDescription')}
          control={<SettingsPill>{i18n.t('aiReadiness.settings.notChecked')}</SettingsPill>}
        />
      </SettingsList>
    </SettingsSection>
  );
}
