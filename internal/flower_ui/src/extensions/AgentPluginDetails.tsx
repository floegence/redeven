import { For, Show } from 'solid-js';
import { Button, Switch } from '@floegence/floe-webapp-core/ui';
import { Refresh, Wand, Workflow } from '@floegence/floe-webapp-core/icons';
import { useFlowerExtensions } from './context';
import { SettingsPill } from './primitives';
import { ExtensionIcon } from './ExtensionIcon';
import type { AgentPluginInstall, AgentPluginPackage } from './agentPluginTypes';

export const pluginComponentKeys = (pkg: AgentPluginPackage) => [...pkg.skills.map(skill => skill.key), ...Object.keys(pkg.mcp).sort().map(key => 'mcp:' + key)];
export const pluginComponentName = (key: string) => key.slice(key.indexOf(':') + 1);

export function AgentPluginCard(props: { item: AgentPluginInstall; onOpen: () => void }) {
  const ctx = useFlowerExtensions(); const t = ctx.i18n.t;
  return <button class="flower-plugin-card" type="button" aria-label={t('plugins.manage') + ': ' + props.item.package.manifest.name} onClick={props.onOpen}>
    <div class="flower-plugin-card-top"><ExtensionIcon identity={'plugin:' + props.item.id} name={props.item.package.manifest.name} /><SettingsPill tone={props.item.update?.available ? 'info' : props.item.enabled ? 'success' : 'default'}>{t(props.item.update?.available ? 'plugins.updateBadge' : props.item.enabled ? 'enabled' : 'disabled')}</SettingsPill></div>
    <h3>{props.item.package.manifest.name}</h3><p>{props.item.package.manifest.description || props.item.source.repository || props.item.source.directory}</p>
    <div class="flower-plugin-card-footer"><span>{props.item.package.skills.length} {t('skills')}</span><span>{Object.keys(props.item.package.mcp).length} MCP</span><span>{props.item.package.manifest.version}</span></div>
  </button>;
}

export function AgentPluginDetails(props: {
  item: AgentPluginInstall; canManage: boolean; busy: boolean;
  onChange: (enabled: boolean, key?: string) => void; onAutoCheck: (enabled: boolean) => void;
  onCheck: (key: string) => void; onCredentials: (key: string) => void; onUpdate: () => void; onRemove: () => void;
}) {
  const ctx = useFlowerExtensions(); const t = ctx.i18n.t;
  return <div class="flower-plugin-detail">
    <div class="flower-plugin-detail-summary"><ExtensionIcon identity={'plugin:' + props.item.id} name={props.item.package.manifest.name} /><div><p>{props.item.package.manifest.description}</p><small>{props.item.package.manifest.version} <Show when={props.item.package.manifest.author?.name}>· {props.item.package.manifest.author?.name}</Show></small></div><Switch checked={props.item.enabled} aria-label={props.item.package.manifest.name + ': ' + t('enabled')} disabled={!props.canManage} onChange={value => props.onChange(value)} /></div>
    <Show when={props.item.update?.available}><div class="flower-plugin-update"><Refresh class="h-4 w-4" /><span>{t('plugins.updateAvailable')}</span><Button size="sm" variant="outline" disabled={!props.canManage} onClick={props.onUpdate}>{t('plugins.resume')}</Button></div></Show>
    <section class="flower-plugin-detail-section"><h3>{t('plugins.components')}</h3>
      <For each={pluginComponentKeys(props.item.package)}>{key => <div class="flower-plugin-component">
        <div class="flower-plugin-component-title"><span class="flower-plugin-component-icon"><Show when={key.startsWith('skill:')} fallback={<Workflow class="h-4 w-4" />}><Wand class="h-4 w-4" /></Show></span><div><strong>{pluginComponentName(key)}</strong><small>{t(key.startsWith('skill:') ? 'skills' : 'mcp')}</small></div><SettingsPill>{t('plugins.status.' + (props.item.health?.[key]?.status ?? (props.item.enabled && props.item.components[key]?.enabled ? 'needs_check' : 'disabled')))}</SettingsPill><Switch checked={props.item.components[key]?.enabled ?? false} aria-label={key + ': ' + t('enabled')} disabled={!props.canManage} onChange={value => props.onChange(value, key)} /></div>
        <Show when={key.startsWith('mcp:')} fallback={<p>{props.item.package.skills.find(skill => skill.key === key)?.description}</p>}>
          <code>{props.item.package.mcp[key.slice(4)]?.url ?? props.item.package.mcp[key.slice(4)]?.command}</code>
          <div class="flower-plugin-actions"><Button size="sm" variant="outline" disabled={!props.canManage || !props.item.enabled || !props.item.components[key]?.enabled || props.item.health?.[key]?.status === 'blocked'} onClick={() => props.onCheck(key)}>{t('check')}</Button><Button size="sm" variant="ghost" disabled={!props.canManage} onClick={() => props.onCredentials(key)}>{t('plugins.credentials')}</Button></div>
          <Show when={props.item.components[key]?.credential_keys?.length}><small>{t('stored', { keys: props.item.components[key].credential_keys!.join(', ') })}</small></Show>
        </Show>
      </div>}</For>
    </section>
    <Show when={props.item.package.diagnostics.length}><details class="flower-plugin-disclosure"><summary>{t('plugins.partial')}</summary><For each={props.item.package.diagnostics}>{entry => <code>{entry.component}: {entry.code} {entry.detail}</code>}</For></details></Show>
    <details class="flower-plugin-disclosure"><summary>{t('plugins.installationDetails')}</summary><dl class="flower-plugin-metadata"><dt>{t('plugins.origin')}</dt><dd>{props.item.source.repository ?? props.item.source.directory}</dd><dt>{t('plugins.version')}</dt><dd>{props.item.package.manifest.version ?? '—'}</dd><dt>{t('plugins.revision')}</dt><dd><code>{props.item.source.commit ?? props.item.digest}</code></dd></dl>
      <Show when={props.item.source.type === 'github'}><label class="flower-plugin-preference"><span>{t('plugins.autoCheck')}</span><Switch checked={props.item.auto_check ?? false} disabled={!props.canManage} onChange={props.onAutoCheck} /></label><Show when={props.item.update?.failed}><p>{t('plugins.updateFailed')}</p></Show></Show>
      <Button size="sm" variant="outline" disabled={!props.canManage} onClick={props.onUpdate}>{t('plugins.update')}</Button>
    </details>
    <div class="flower-plugin-danger"><Button size="sm" variant="ghost" disabled={!props.canManage || props.busy} onClick={props.onRemove}>{t('plugins.uninstall')}</Button></div>
  </div>;
}
