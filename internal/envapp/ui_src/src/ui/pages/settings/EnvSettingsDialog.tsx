import { ENV_APP_FLOATING_LAYER } from '../../utils/envAppLayers';
import { For, Show, Suspense, createMemo, createResource, onCleanup, lazy, type JSX } from 'solid-js';
import type { FloeShellThemeMode, ThemeType } from '@floegence/floe-webapp-core';
import { SettingsDialog } from '../../../../../../settings_ui/src/SettingsDialog';
import { settingsProviderFocus, settingsTargetSupported, type createSettingsSession } from '../../../../../../settings_ui/src/settingsSession';
import type { SettingsPanelRegistration } from '../../../../../../settings_ui/src/SettingsPanelHost';
import { UIFirstKeepAlivePanel } from '../../primitives/UIFirstKeepAlivePanel';
import { EnvSettingsPage } from '../EnvSettingsPage';
import { useEnvContext, type EnvSettingsSection } from '../EnvContext';
import { useEnvSettingsPage } from './EnvSettingsPageContext';
import { StorageSettings } from './StorageSettings';
import { AIReadinessSettingsSection } from './AIReadinessSettingsSection';
import { createAIReadinessController } from '../../flower/aiReadiness';
import { LanguagePreferenceMenu, useI18n, type EnvAppTranslationKey } from '../../i18n';
import { EnvAppThemePicker } from '../../EnvAppThemePicker';
import { createLocalizedFlowerSurfaceCopy } from '../../../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { FlowerSettingsPanel } from '../../../../../../flower_ui/src/settings/FlowerSettingsPanel';
import { FlowerComputerConnections } from '../../../../../../flower_ui/src/FlowerComputerConnections';
import { FlowerExtensionsSurface } from '../../../../../../flower_ui/src/extensions/FlowerExtensionsSurface';
import { TerminalSettingsDialog } from '../../widgets/TerminalSettingsDialog';
import { useTerminalPreferences, ensureTerminalPreferencesInitialized, TERMINAL_MIN_FONT_SIZE, TERMINAL_MAX_FONT_SIZE } from '../../services/terminalPreferences';
import { useTheme, useResolvedFloeConfig } from '@floegence/floe-webapp-core';
const Services = lazy(() => import('../EnvPortForwardsPage').then(m => ({ default: m.EnvPortForwardsPage })));
const Applications = lazy(() => import('../EnvHostApplicationsPage').then(m => ({ default: m.EnvHostApplicationsPage })));

export function EnvSettingsDialog(props: {
  session: ReturnType<typeof createSettingsSession>;
  panels: readonly SettingsPanelRegistration[];
  renderPlugins: () => JSX.Element;
  onThemeSourceChange: (value: ThemeType) => boolean | Promise<boolean>;
  onShellThemeChange: (mode: FloeShellThemeMode, preset: string) => boolean | Promise<boolean>;
}) {
  const env = useEnvContext();
  const i18n = useI18n();
  const target = props.session.target;
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
    const [adapter] = createResource(() => env.createSettingsFlowerAdapter?.({ signal: lifetime.signal, isAvailable: () => ctx.protocol.status() === 'connected' && (!ctx.env.resourceCacheAccess || ctx.env.resourceCacheAccess().phase === 'ready') }));
    const providerFocus = () => target()?.section === 'ai' ? settingsProviderFocus(target()?.resource, props.session.revision()) : undefined;
    return <Show when={adapter()} fallback={<p role="status">{copy().chat.loadingSettings}</p>}>{owner => kind === 'ai'
      ? <FlowerSettingsPanel active={props.session.present() && target()?.section === 'ai' && supported()} adapter={owner()} copy={copy()} canEdit={ctx.canAdmin()} revision={env.settingsSeq()} onChanged={env.bumpSettingsSeq} providerFocusRequest={providerFocus()} onOpenComputer={() => env.openSettings('browser')} />
      : kind === 'extensions' ? <Show when={owner().extensions}>{extensions => <FlowerExtensionsSurface active={props.session.present() && target()?.section === 'extensions' && supported()} adapter={extensions()} i18n={copy().extensions} onBack={() => props.session.close()} />}</Show>
      : <FlowerComputerConnections embedded open={props.session.present() && target()?.section === 'browser'} threadID="" adapter={owner()} copy={copy().computer} onOpenChange={open => { if (!open) props.session.close(); }} />
    }</Show>;
  };
  const Terminal = () => {
    const ctx = useEnvSettingsPage();
    const preferences = useTerminalPreferences(); const theme = useTheme();
    ensureTerminalPreferencesInitialized(useResolvedFloeConfig().persist);
    return <TerminalSettingsDialog embedded open retentionCanManage={ctx.canAdmin()} userTheme={preferences.userTheme()} fontSize={preferences.fontSize()} fontFamilyId={preferences.fontFamilyId()} mobileInputMode={preferences.mobileInputMode()}
      systemAppearance={theme.resolvedTheme()} followInput={preferences.followInput()} onFollowInputChange={preferences.setFollowInput} workIndicatorEnabled={preferences.workIndicatorEnabled()}
      minFontSize={TERMINAL_MIN_FONT_SIZE} maxFontSize={TERMINAL_MAX_FONT_SIZE} onOpenChange={open => { if (!open) props.session.close(); }} onThemeChange={value => { preferences.setUserTheme(value); return true; }}
      onFontSizeChange={preferences.setFontSize} onFontFamilyChange={preferences.setFontFamily} onMobileInputModeChange={preferences.setMobileInputMode} onWorkIndicatorEnabledChange={preferences.setWorkIndicatorEnabled} />;
  };
  const Storage = () => {
    const ctx = useEnvSettingsPage();
    const controller = env.aiReadinessController ?? createAIReadinessController();
    return <div class="space-y-6"><StorageSettings canAdmin={ctx.canAdmin() && ctx.canInteract()} scope={scope()} openFlower={() => env.openSettings('ai')} openTooling={() => env.openSettings('codespaces')} />
      <AIReadinessSettingsSection controller={controller} canAdmin={ctx.canAdmin()} endpointID={env.env_id()} namespacePublicID={env.env()?.namespace_public_id ?? ''} modelID={ctx.settings()?.ai?.current_model_id ?? ''} modelOptions={(ctx.settings()?.ai?.providers ?? []).flatMap(provider => (provider.models ?? []).map(model => ({ id: `${provider.id}/${model.model_name}`, label: `${provider.name} · ${model.model_name}` })))} permissionType={ctx.settings()?.ai?.permission_type ?? 'approval_required'} workingDir={ctx.settings()?.runtime?.agent_home_dir ?? ''} />
    </div>;
  };
  const panels: Partial<Record<EnvSettingsSection, () => JSX.Element>> = {
    appearance: () => <div class="space-y-5"><h1 class="text-lg font-semibold">{i18n.t('settings.nav.appearance')}</h1><LanguagePreferenceMenu variant="inline" /><EnvAppThemePicker presentation="inline" onSourceChange={props.onThemeSourceChange} onShellThemeChange={props.onShellThemeChange} /></div>,
    storage: Storage, terminal: panel('terminal', Terminal), ai: () => RuntimeFlower('ai'),
    browser: panel('browser', () => RuntimeFlower('browser')), extensions: () => RuntimeFlower('extensions'),
    plugins: props.renderPlugins,
    services: () => <Suspense><Services settingsOnly /></Suspense>,
    applications: () => <Suspense><Applications settingsOnly /></Suspense>,
  };
  return <SettingsDialog globalZIndex={ENV_APP_FLOATING_LAYER.productModal} open={target() !== null} present={props.session.present()} title={i18n.t('settings.runtimeTitle')} closeLabel={i18n.t('common.actions.close')}
    onClose={() => props.session.close()} onPresenceChange={props.session.setPresent}>
    {/* IMPORTANT: An invalid deep link is presentation state, not an owner change.
        Keep the scope-owned forms alive so returning never discards drafts. */}
    <div class="h-full min-h-0" hidden={!supported()} inert={!supported()}>
      <Show when={scope()} keyed>{(_scope) => <EnvSettingsPage panels={panels} initialSection={(target()?.section ?? 'appearance') as EnvSettingsSection} onNavigate={section => props.session.open({ section })} />}</Show>
    </div>
    <Show when={!supported()}><p role="alert">{i18n.t('settings.targetUnavailable')}</p></Show>
  </SettingsDialog>;
}
