import { Button } from '@floegence/floe-webapp-core/ui';
import { X } from '@floegence/floe-webapp-core/icons';
import { ENV_APP_FLOATING_LAYER } from '../../utils/envAppLayers';
import { For, Show, Suspense, createMemo, createResource, createSignal, onCleanup, lazy, type JSX } from 'solid-js';
import type { FloeShellThemeMode, ThemeType } from '@floegence/floe-webapp-core';
import { SettingsDialog } from '../../../../../../settings_ui/src/SettingsDialog';
import { settingsProviderFocus, settingsTargetSupported, type createSettingsSession } from '../../../../../../settings_ui/src/settingsSession';
import type { SettingsPanelRegistration } from '../../../../../../settings_ui/src/SettingsPanelHost';
import { UIFirstKeepAlivePanel } from '../../primitives/UIFirstKeepAlivePanel';
import { EnvSettingsPage } from '../EnvSettingsPage';
import { useEnvContext, type EnvSettingsSection } from '../EnvContext';
import { useEnvSettingsPage } from './EnvSettingsPageContext';
import { PluginSettingsPanel, type PluginSettingsOwner } from '../../plugins/PluginSettingsPanel';
import { AppearanceSettings } from './AppearanceSettings';
import { BrowserDisplaySettings } from './BrowserDisplaySettings';
import { ConversationDefaultsSettings } from './ConversationDefaultsSettings';
import { StorageSettings } from './StorageSettings';
import { AIReadinessSettingsSection } from './AIReadinessSettingsSection';
import { createAIReadinessController } from '../../flower/aiReadiness';
import { useI18n, type EnvAppTranslationKey } from '../../i18n';
import { createLocalizedFlowerSurfaceCopy } from '../../../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { FlowerSettingsPanel } from '../../../../../../flower_ui/src/settings/FlowerSettingsPanel';
import { FlowerComputerConnections } from '../../../../../../flower_ui/src/FlowerComputerConnections';
import { FlowerExtensionsSurface } from '../../../../../../flower_ui/src/extensions/FlowerExtensionsSurface';
const ContainerSettingsPanel = lazy(() => import('./ContainerSettingsPanel').then(m => ({ default: m.ContainerSettingsPanel })));
const TerminalSettingsPanel = lazy(() => import('./TerminalSettingsPanel').then(m => ({ default: m.TerminalSettingsPanel })));
const Services = lazy(() => import('../EnvPortForwardsPage').then(m => ({ default: m.EnvPortForwardsPage })));
const Applications = lazy(() => import('../EnvHostApplicationsPage').then(m => ({ default: m.EnvHostApplicationsPage })));

export function EnvSettingsDialog(props: {
  session: ReturnType<typeof createSettingsSession>;
  panels: readonly SettingsPanelRegistration[];
  pluginSettings?: PluginSettingsOwner;
  onThemeSourceChange: (value: ThemeType) => boolean | Promise<boolean>;
  onShellThemeChange: (mode: FloeShellThemeMode, preset: string) => boolean | Promise<boolean>;
}) {
  const env = useEnvContext();
  const i18n = useI18n();
  const [header, setHeader] = createSignal<JSX.Element>(null);
  const target = props.session.target;
  // IMPORTANT: Keep derived target ownership here. Inline conditional prop
  // getters can allocate reactive computations when controls read on events.
  const terminalResource = createMemo(() => target()?.section === 'terminal' ? target()?.resource : undefined);
  const containerResource = createMemo(() => target()?.section === 'containers' ? target()?.resource : undefined);
  const pluginResource = createMemo(() => target()?.section === 'plugins' ? target()?.resource : undefined);
  const supported = () => !target() || settingsTargetSupported(target()!) && !(target()?.section === 'connection' && target()?.resource);
  const scope = () => JSON.stringify([env.flowerScopeKey?.() ?? env.env_id()]);
  const copy = createMemo(() => createLocalizedFlowerSurfaceCopy({ locale: i18n.locale(), t: (key, values) => i18n.t(key as EnvAppTranslationKey, values), tn: (key, count, values) => i18n.tn(key as EnvAppTranslationKey, count, values) }));
  const hosted = (section: string) => [...props.panels].reverse().find(panel => target()?.section === section && panel.target.section === section && panel.target.resource === target()?.resource);
  const panel = (section: EnvSettingsSection, fallback: () => JSX.Element) => () => <>
    <UIFirstKeepAlivePanel active={!hosted(section) && !target()?.resource} render={fallback} class="h-full min-h-0" />
    <Show when={!hosted(section) && target()?.resource}><p role="alert">{i18n.t('settings.targetUnavailable')}</p></Show>
    <For each={props.panels.filter(entry => entry.target.section === section)}>{entry => <Show when={props.session.present() && hosted(section) === entry}>{entry.render()}</Show>}</For>
  </>;
  const RuntimeFlower = (kind: 'ai' | 'extensions' | 'browser') => {
    const ctx = useEnvSettingsPage();
    const lifetime = new AbortController();
    onCleanup(() => lifetime.abort());
    const [adapter, { refetch: reloadAdapter }] = createResource(() => env.createSettingsFlowerAdapter?.({ signal: lifetime.signal, isAvailable: () => ctx.protocol.status() === 'connected' && (!ctx.env.resourceCacheAccess || ctx.env.resourceCacheAccess().phase === 'ready') }));
    const providerFocus = () => target()?.section === 'ai' ? settingsProviderFocus(target()?.resource, props.session.revision()) : undefined;
    return <><Show when={adapter.error}><p role="alert">{String(adapter.error)}</p><Button onClick={() => void reloadAdapter()}>{i18n.t('common.actions.retry')}</Button></Show><Show when={adapter.error ? undefined : adapter()} fallback={<p role="status">{copy().chat.loadingSettings}</p>}>{owner => kind === 'ai'
      ? <div class="redeven-settings-stack"><ConversationDefaultsSettings adapter={owner()} copy={copy()} canEdit={ctx.canInteract() && !!env.env()?.permissions?.can_read && !!env.env()?.permissions?.can_write && !!env.env()?.permissions?.can_execute} active={props.session.present() && target()?.section === 'ai'} revision={env.settingsSeq()} scope={scope()} generation={env.resourceCacheAccess?.().generation ?? 0} onChanged={env.bumpSettingsSeq} /><FlowerSettingsPanel active={props.session.present() && target()?.section === 'ai' && supported()} adapter={owner()} copy={copy()} canEdit={ctx.canAdmin()} revision={env.settingsSeq()} onChanged={env.bumpSettingsSeq} providerFocusRequest={providerFocus()} onOpenComputer={() => env.openSettings('browser')} /></div>
      : kind === 'extensions' ? <Show when={owner().extensions}>{extensions => <FlowerExtensionsSurface embedded active={props.session.present() && target()?.section === 'extensions' && supported()} adapter={extensions()} i18n={copy().extensions} />}</Show>
      : <div class="redeven-settings-stack"><BrowserDisplaySettings /><FlowerComputerConnections embedded open={props.session.present() && target()?.section === 'browser'} threadID="" adapter={owner()} copy={copy().computer} onOpenChange={open => { if (!open) props.session.close(); }} /></div>
    }</Show></>;
  };
  const Storage = () => {
    const ctx = useEnvSettingsPage();
    const controller = env.aiReadinessController ?? createAIReadinessController();
    return <div class="space-y-6"><StorageSettings canAdmin={ctx.canAdmin() && ctx.canInteract()} scope={scope()} openFlower={() => env.openSettings('ai')} openTooling={() => env.openSettings('codespaces')} />
      <AIReadinessSettingsSection controller={controller} canAdmin={ctx.canAdmin()} endpointID={env.env_id()} namespacePublicID={env.env()?.namespace_public_id ?? ''} modelID={ctx.settings()?.ai?.current_model_id ?? ''} modelOptions={(ctx.settings()?.ai?.providers ?? []).flatMap(provider => (provider.models ?? []).map(model => ({ id: `${provider.id}/${model.model_name}`, label: `${provider.name} · ${model.model_name}` })))} permissionType={ctx.settings()?.ai?.permission_type ?? 'approval_required'} workingDir={ctx.settings()?.runtime?.agent_home_dir ?? ''} />
    </div>;
  };
  const panels: Partial<Record<EnvSettingsSection, () => JSX.Element>> = {
    appearance: () => <AppearanceSettings onThemeSourceChange={props.onThemeSourceChange} onShellThemeChange={props.onShellThemeChange} />,
    storage: Storage, terminal: () => <Suspense><TerminalSettingsPanel resource={terminalResource()} /></Suspense>, ai: () => RuntimeFlower('ai'),
    browser: panel('browser', () => RuntimeFlower('browser')), extensions: () => RuntimeFlower('extensions'),
    plugins: () => <PluginSettingsPanel resource={pluginResource()} installed={props.pluginSettings} />,
    containers: () => <Suspense><ContainerSettingsPanel resource={containerResource()} /></Suspense>,
    services: () => <Suspense><Services settingsOnly /></Suspense>,
    applications: () => <Suspense><Applications settingsOnly /></Suspense>,
  };
  // IMPORTANT: Outside clicks use Floe's modal stack and the same retained close
  // path as X/Escape. Closing must neither save drafts nor activate background UI.
  return <SettingsDialog closeOnBackdropClick globalZIndex={ENV_APP_FLOATING_LAYER.productModal} open={target() !== null} present={props.session.present()} title={i18n.t('settings.runtimeTitle')} closeLabel={i18n.t('common.actions.close')}
    header={<div data-floe-dialog-header class="redeven-env-settings-dialog-header">
      <div class="redeven-env-settings-dialog-header-main">{header()}</div>
      <Button variant="ghost" size="icon" class="redeven-env-settings-dialog-close shrink-0" aria-label={i18n.t('common.actions.close')} onClick={() => props.session.close()}><X class="h-4 w-4" /></Button>
    </div>}
    onClose={() => props.session.close()} onPresenceChange={props.session.setPresent}>
    {/* IMPORTANT: An invalid deep link is presentation state, not an owner change.
        Keep the scope-owned forms alive so returning never discards drafts. */}
    <div class="h-full min-h-0" hidden={!supported()} inert={!supported()}>
      <Show when={scope()} keyed>{(_scope) => <EnvSettingsPage panels={panels} initialSection={(target()?.section ?? 'appearance') as EnvSettingsSection} onNavigate={section => props.session.open({ section })} onHeaderChange={content => setHeader(() => content)} />}</Show>
    </div>
    <Show when={!supported()}><p role="alert">{i18n.t('settings.targetUnavailable')}</p></Show>
  </SettingsDialog>;
}
