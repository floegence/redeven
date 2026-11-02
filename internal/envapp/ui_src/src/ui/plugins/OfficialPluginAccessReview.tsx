import { For, Show, type JSX } from 'solid-js';
import { ChevronDown, RefreshIcon, Shield } from '@floegence/floe-webapp-core/icons';
import { useI18n } from '../i18n';
import { backgroundScheduleLabel } from './PluginBackgroundStatus';
import { dataUpgradeFacts } from './externalPluginSecurityProjection';
import type { PluginMarketInstallPreview, PluginExternalPackageProcessSummary, PluginExternalPackageBackgroundSummary } from './pluginTypes';

export function OfficialPluginAccessReview(props: { preview: PluginMarketInstallPreview }): JSX.Element {
  const i18n = useI18n();
  const permissions = () => props.preview.security_summary.permissions.filter((permission) =>
    permission.permission_id !== 'network.client' || !props.preview.security_summary.network?.length);
  const methods = () => props.preview.security_summary.methods?.filter((method) => method.route.kind === 'capability' || method.dangerous);
  return (
    <section class="space-y-3 border-t pt-4" data-plugin-access-review>
      <h3 class="text-[length:var(--floe-type-body)] font-semibold">
        {i18n.t('uiCopy.plugin.external.requestedAccessTitle')}
      </h3>
      <Show
        when={permissions().length > 0}
        fallback={<Show when={!props.preview.security_summary.permissions.length && !props.preview.security_summary.network?.length && !props.preview.security_summary.process && !props.preview.security_summary.background}>
          <p class="text-xs leading-5 text-muted-foreground">{i18n.t('uiCopy.plugin.noRequiredPermissions')}</p>
        </Show>}
      >
        <div class="mt-2 space-y-3">
          <For each={[true, false] as const}>
            {(required) => {
              const grouped = () => permissions().filter((permission) => permission.required === required);
              return (
                <Show when={grouped().length > 0}>
                  <div data-plugin-install-permission-group={required ? 'required' : 'optional'}>
                    <h4 class="text-xs font-semibold text-foreground">{required ? i18n.t('uiCopy.plugin.requiredToOpen') : i18n.t('uiCopy.plugin.optionalPermission')}</h4>
                    <div class="divide-y">
                      <For each={grouped()}>
                        {(permission) => (
                          <div class="flex items-start gap-3 py-2.5" data-plugin-install-permission={permission.permission_id}>
                            <Shield class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            <div class="min-w-0 flex-1">
                              <div class="flex flex-wrap items-center gap-2">
                                <span class="text-[length:var(--floe-type-body)] font-medium">{humanizePermissionID(permission.permission_id)}</span>

                              </div>
                              <p class="mt-1 text-xs leading-5 text-muted-foreground">{permission.effects.map((effect) => humanizePermissionID(effect)).join(', ')}</p>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              );
            }}
          </For>
        </div>
      </Show>
      <Show when={props.preview.security_summary.data_upgrade}>
        <section data-plugin-install-data-upgrade class="space-y-2 border-t pt-3">
          <div class="flex items-center gap-2 text-[length:var(--floe-type-body)] font-medium"><RefreshIcon class="h-4 w-4 shrink-0 text-muted-foreground" />{i18n.t('uiCopy.plugin.external.dataUpgrade')}</div>
          <details data-plugin-install-data-upgrade-details class="group rounded-md border">
            <summary class="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-xs font-semibold"><span>{i18n.t('uiCopy.plugin.updateReview.technicalEvidence')}</span><ChevronDown class="h-4 w-4 group-open:rotate-180" /></summary>
            <ul class="space-y-1 break-all border-t p-3 font-mono text-xs"><For each={dataUpgradeFacts(props.preview.security_summary.data_upgrade!)}>{(fact) => <li>{fact}</li>}</For></ul>
          </details>
        </section>
      </Show>
      <Show when={props.preview.security_summary.network?.length}>
        <div class="space-y-2" data-plugin-official-network>
          <h4 class="text-xs font-medium">{i18n.t('uiCopy.plugin.external.accessNetwork')}</h4>
          <For each={props.preview.security_summary.network}>{(network) => <p class="break-all text-xs text-muted-foreground">{network.destinations.join(', ')}</p>}</For>
        </div>
      </Show>
      <Show when={props.preview.security_summary.storage?.length}>
        <p class="text-xs text-muted-foreground">{i18n.t('uiCopy.plugin.external.accessStorage')}</p>
      </Show>
      <For each={props.preview.security_summary.secret_refs}>{(secret) => <div class="flex flex-wrap gap-2 text-xs">
        <span>{i18n.t('uiCopy.plugin.external.accessCredential')}</span><code class="break-all">{secret.secret_ref}</code>
      </div>}</For>
      <For each={methods()}>{(method) => <p class="break-words text-xs">{humanizePermissionID(method.method)}<Show when={method.dangerous}><span class="ml-2 text-[var(--redeven-status-warning-foreground)]">{i18n.tn('uiCopy.plugin.external.dangerousOperations', 1)}</span></Show></p>}</For>
      <For each={props.preview.security_summary.core_actions}>{(action) => <p class="break-words text-xs">{humanizePermissionID(action.action_id)} · {action.method}</p>}</For>
      <OfficialProcessAccessReview
        process={props.preview.security_summary.process}
        background={props.preview.security_summary.background}
      />
      <p class="text-xs text-muted-foreground">{i18n.t('uiCopy.plugin.installOperation.declarationNotice')}</p>
    </section>
  );
}

function OfficialProcessAccessReview(props: {
  process?: PluginExternalPackageProcessSummary;
  background?: PluginExternalPackageBackgroundSummary;
}): JSX.Element {
  const i18n = useI18n();
  return <div class="space-y-3" data-plugin-install-process-review>
    <Show when={props.process}>{(process) => <details class="group rounded-md border border-[var(--redeven-status-warning-foreground)] bg-[var(--redeven-status-warning-soft)]">
      <summary class="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium">
        <Shield class="h-4 w-4 shrink-0 text-[var(--redeven-status-warning-foreground)]" />
        <span class="min-w-0 flex-1">{i18n.t('uiCopy.plugin.external.localProcessAccess')}</span><ChevronDown class="h-4 w-4 shrink-0 group-open:rotate-180" />
      </summary>
      <div class="space-y-2 border-t px-3 py-2.5 text-xs text-muted-foreground">
        <p class="leading-5">{i18n.t('uiCopy.plugin.external.localProcessAccessGuidance')}</p>
        <code class="block break-all">{i18n.t('uiCopy.plugin.external.processLimits', { output: process().resource_limits.output_buffer_bytes, runtime: process().resource_limits.max_runtime_ms })}</code>
      </div>
    </details>}</Show>
    <Show when={props.background}>{(background) => <details data-plugin-install-background-details class="group rounded-md border">
      <summary class="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium">
        <RefreshIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1">{backgroundScheduleLabel(background(), i18n)}</span><ChevronDown class="h-4 w-4 shrink-0 group-open:rotate-180" />
      </summary>
      <code class="block break-all border-t p-3 text-[11px] text-muted-foreground">{'strategy=' + background().strategy + '; method=' + (background().method ?? '-') + '; interval_ms=' + (background().interval_ms ?? '-') + '; max_runtime_ms=' + (background().max_runtime_ms ?? '-')}</code>
    </details>}</Show>
  </div>;
}

function humanizePermissionID(value: string): string {
  return value.split(/[._:-]+/u).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
