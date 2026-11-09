import { Button, Dropdown, Switch } from '@floegence/floe-webapp-core/ui';
import { MoreHorizontal } from '@floegence/floe-webapp-core/icons';
import { For, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js';
import { Dialog } from '../primitives/EnvAppModal';
import { useSettingsPresentation } from '../../../../../settings_ui/src/SettingsPanelHost';
import { useI18n } from '../i18n';
import type { HostAccessState } from '../services/hostAccess';
import { HostAccessFeatureIllustration, HostAccessFeatureMark, HostAccessHelperIllustration, HostAccessPermissionIllustration, HostAccessStateIllustration } from './HostAccessIllustration';
import { SettingRow } from './settings/SettingsPrimitives';
import './host-access.css';
export function HostAccessWelcome(props: {
    applicationsStarted?: boolean;
    onApplications: () => void;
    onDesktop: () => void;
    onBrowse: () => void;
    allowed: boolean;
}) {
    const i18n = useI18n();
    return <section class="host-access-welcome" aria-label={i18n.t('hostAccess.welcome')}>
  <h2>{i18n.t('hostAccess.welcome')}</h2><p>{i18n.t('hostAccess.choose')}</p>
  <div class="host-access-choices"><For each={['applications', 'desktop'] as const}>{feature => <article class="host-access-choice">
   <div class="host-access-illustration"><HostAccessFeatureIllustration feature={feature} /></div>
   <h3>{i18n.t(feature === 'applications' ? 'hostAccess.applications' : 'hostAccess.desktop')}</h3><p>{i18n.t(feature === 'applications' ? 'hostAccess.appDescription' : 'hostAccess.desktopDescription')}</p>
   <Button disabled={!props.allowed} onClick={feature === 'applications' ? props.onApplications : props.onDesktop}>{i18n.t(feature === 'applications' ? props.applicationsStarted ? 'hostAccess.continue' : 'hostAccess.setupApplications' : 'hostAccess.setupDesktop')}</Button>
  </article>}</For></div>
  <div class="host-access-welcome-footer"><p>{i18n.t('hostAccess.independent')}</p><Button variant="ghost" onClick={props.onBrowse}>{i18n.t('hostAccess.browse')}</Button></div>
 </section>;
}
export function HostAccessPermissions(props: {
    permissionAppName?: string;
    onRecovery?: (action: 'reveal_application' | 'restart_application') => void;
    screen: boolean;
    input: boolean;
    needsInput: boolean;
    desktop?: boolean;
    allowed: boolean;
    busy: boolean;
    onPermission: (permission: 'screen_recording' | 'accessibility', manage?: boolean) => void;
    onRefresh: () => void;
}) {
    const i18n = useI18n();
    const [requested, setRequested] = createSignal<'screen_recording' | 'accessibility'>();
    const next = (): 'screen_recording' | 'accessibility' | undefined => !props.screen ? 'screen_recording' : props.needsInput && !props.input ? 'accessibility' : undefined;
    return <section class="host-access-permissions" aria-label={i18n.t('hostAccess.requirements')}>
  <Show when={next()}><HostAccessPermissionDestination name={props.permissionAppName} /></Show>
  <For each={['screen_recording', 'accessibility'] as const}>{permission => <Show when={permission === 'screen_recording' ? !props.screen : props.needsInput && !props.input}>
   <div class="host-access-permission">
    <div class="host-access-permission-visual"><HostAccessPermissionIllustration kind={permission === 'screen_recording' ? 'screen' : 'input'} desktop={props.desktop} /></div>
    <div><h3>{i18n.t(permission === 'accessibility' ? 'hostAccess.inputPurpose' : props.desktop ? 'hostAccess.desktopPurpose' : 'hostAccess.appPurpose')}</h3><p>{i18n.t(permission === 'screen_recording' ? 'hostAccess.screenPermission' : 'hostAccess.inputPermission')}</p></div>
    <span>{i18n.t('hostAccess.required')}</span>
   </div>
  </Show>}</For>
  <Show when={next()} fallback={<p role="status">{i18n.t('hostAccess.permissionsReady')}</p>}>{permission => <div class="host-access-actions">
   <Button disabled={!props.allowed || props.busy} onClick={() => { setRequested(permission()); props.onPermission(permission()); }}>{i18n.t(permission() === 'screen_recording' ? 'hostAccess.allowScreen' : 'hostAccess.allowInput')}</Button>
   <Button variant="ghost" disabled={props.busy} onClick={props.onRefresh}>{i18n.t('hostAccess.checkAgain')}</Button>
  </div>}</Show>

  <Show when={next() && requested() === next()}><div class="host-access-requested" role="status"><p>{i18n.t('hostAccess.requestPending')}</p><Button variant="outline" disabled={!props.allowed || props.busy} onClick={() => props.onPermission(next()!, true)}>{i18n.t('hostAccess.openSystemSettings')}</Button></div></Show>
  <Show when={next() && props.onRecovery}><HostAccessRecovery name={props.permissionAppName} allowed={props.allowed} busy={props.busy} onRecovery={props.onRecovery!} /></Show>
 </section>;
}
export function HostAccessSystemPermissions(props: {
    permissionAppName?: string;
    onRecovery?: (action: 'reveal_application' | 'restart_application') => void;
    screen: boolean;
    input: boolean;
    allowed: boolean;
    busy: boolean;
    onPermission: (permission: 'screen_recording' | 'accessibility', manage?: boolean) => void;
}) {
    const i18n = useI18n();
    const [requested, setRequested] = createSignal<Array<'screen_recording' | 'accessibility'>>([]);
    const granted = (permission: 'screen_recording' | 'accessibility') => permission === 'screen_recording' ? props.screen : props.input;
    return <details class="host-access-system"><summary>{i18n.t('hostAccess.systemSettings')}</summary>
      <HostAccessPermissionDestination name={props.permissionAppName} />
      <For each={['screen_recording', 'accessibility'] as const}>{permission => <div class="host-access-system-row">
        <div><strong>{i18n.t(permission === 'screen_recording' ? 'hostAccess.screenPermission' : 'hostAccess.inputPermission')}</strong><span>{i18n.t((granted(permission)) ? 'hostAccess.allowed' : 'hostAccess.required')}</span></div>
        <Button size="sm" variant="outline" disabled={!props.allowed || props.busy} onClick={() => { const manage = granted(permission) || requested().includes(permission); if (!manage) setRequested(previous => [...previous, permission]); props.onPermission(permission, manage); }}>{i18n.t((granted(permission) || requested().includes(permission)) ? 'hostAccess.openSystemSettings' : permission === 'screen_recording' ? 'hostAccess.allowScreen' : 'hostAccess.allowInput')}</Button>
      </div>}</For>
      <Show when={requested().some(permission => !granted(permission))}><p role="status">{i18n.t('hostAccess.requestPending')}</p></Show>
      <p>{i18n.t('hostAccess.sharedPermissions')}</p>
      <Show when={props.onRecovery}><HostAccessRecovery name={props.permissionAppName} allowed={props.allowed} busy={props.busy} onRecovery={props.onRecovery!} /></Show>
    </details>;
}

function HostAccessRecovery(props: { name?: string; allowed: boolean; busy: boolean; onRecovery: (action: 'reveal_application' | 'restart_application') => void }) {
    const i18n = useI18n();
    const [confirmRestart, setConfirmRestart] = createSignal(false);
    return <details class="host-access-recovery"><summary>{i18n.t('hostAccess.permissionHelp')}</summary>
      <div class="host-access-recovery-step"><HostAccessHelperIllustration kind="locate" /><div><h4>{i18n.t('hostAccess.missingApplication')}</h4><p>{i18n.t('hostAccess.addApplicationHint', { app: props.name || 'Redeven Desktop Access' })}</p><Button size="sm" variant="outline" disabled={!props.allowed || props.busy || !props.name} onClick={() => props.onRecovery('reveal_application')}>{i18n.t('hostAccess.revealApplication')}</Button></div></div>
      <div class="host-access-recovery-step"><HostAccessHelperIllustration kind="restart" /><div><h4>{i18n.t('hostAccess.changedPermissions')}</h4><p>{i18n.t('hostAccess.helperRestartHint')}</p>
      <Show when={confirmRestart()} fallback={<Button size="sm" variant="outline" disabled={!props.allowed || props.busy} onClick={() => setConfirmRestart(true)}>{i18n.t('hostAccess.applyPermissions')}</Button>}>
        <p role="alert">{i18n.t('hostAccess.helperRestartConfirm')}</p><div class="host-access-actions"><Button size="sm" variant="ghost" disabled={props.busy} onClick={() => setConfirmRestart(false)}>{i18n.t('common.actions.cancel')}</Button><Button size="sm" disabled={!props.allowed || props.busy} onClick={() => { props.onRecovery('restart_application'); setConfirmRestart(false); }}>{i18n.t('hostAccess.restartHelper')}</Button></div>
      </Show></div></div>
    </details>;
}

function HostAccessPermissionDestination(props: { name?: string }) {
    const i18n = useI18n();
    return <p class="host-access-permission-destination">{props.name ? i18n.t('hostAccess.permissionApp', { app: props.name }) : i18n.t('hostAccess.permissionAppUnknown')}</p>;
}

export function HostAccessFeatureSettings(props: {
    feature: 'applications' | 'desktop';
    state: HostAccessState;
    allowed: boolean;
    busy: boolean;
    ready?: boolean;
    children?: JSX.Element;
    error?: string;
    onChange: (state: HostAccessState) => Promise<void>;
    onReconfigure: () => void;
}) {
    const i18n = useI18n();
    const title = () => i18n.t(props.feature === 'applications' ? 'hostAccess.applicationFeature' : 'remoteDesktop.title');
    return <section class="host-access-feature-settings" aria-label={title()}>
      <SettingRow class="host-access-feature-row" title={title()} icon={() => <HostAccessFeatureMark feature={props.feature} />}
        description={i18n.t(props.state === 'paused' ? 'hostAccess.paused' : props.state === 'unconfigured' ? 'hostAccess.unconfigured' : props.ready === false ? 'hostAccess.needsAttention' : 'hostAccess.enabled')}
        control={<HostAccessManagement {...props} compact title={title()} />} />
      {props.children}
    </section>;
}

function HostAccessStatus(props: { state: HostAccessState; ready?: boolean }) {
    const i18n = useI18n();
    return <span class="host-access-state" data-state={props.state} data-ready={props.ready !== false} role="status">{i18n.t(props.state === 'paused' ? 'hostAccess.paused' : props.state === 'unconfigured' ? 'hostAccess.unconfigured' : props.ready === false ? 'hostAccess.needsAttention' : 'hostAccess.enabled')}</span>;
}

export function HostAccessManagement(props: {
    state: HostAccessState;
    ready?: boolean;
    compact?: boolean;
    title?: string;
    error?: string;
    allowed: boolean;
    busy: boolean;
    onChange: (state: HostAccessState) => Promise<void>;
    onReconfigure: () => void;
}) {
    const i18n = useI18n();
    const presented = useSettingsPresentation('applications');
    const [confirm, setConfirm] = createSignal<'paused' | 'unconfigured'>();
    const [menuOpen, setMenuOpen] = createSignal(false);
    const canManage = () => presented() && props.allowed && !props.busy;
    // IMPORTANT: Dropdown reads controlled props from event handlers. Allocate
    // conditional reactivity here under the component owner, never in its getter.
    const effectiveMenuOpen = createMemo(() => canManage() && menuOpen());
    // IMPORTANT: Portalled menu visibility follows live host authority, just
    // like confirmations. A hidden retained category never keeps active items.
    createEffect(() => {
      if (!canManage()) setMenuOpen(false);
      if (!presented() || !props.allowed) setConfirm(undefined);
    });
    const commit = async () => {
      const action = confirm();
      if (!action || !canManage()) return;
      try { await props.onChange(action); setConfirm(undefined); }
      catch { /* The owning panel keeps the failure visible for reconciliation. */ }
    };
    const menuItems = createMemo(() => [
      ...(props.state === 'enabled' && props.ready === false ? [{ id: 'paused', label: i18n.t('hostAccess.pause') }] : []),
      { id: 'unconfigured', label: i18n.t('hostAccess.remove'), tone: 'danger' as const },
    ]);
    if (props.compact) return <div class="host-access-feature-control">
      {/* IMPORTANT: The compact switch expresses current authority; turning it
          off still requires the existing explicit confirmation, never autosave. */}
      <Show when={props.state !== 'unconfigured' && props.ready !== false} fallback={<Button size="sm" variant="outline" disabled={!canManage()} onClick={() => { if (canManage()) props.onReconfigure(); }}>{i18n.t(props.state === 'paused' ? 'hostAccess.resume' : props.state === 'unconfigured' ? 'hostAccess.setup' : 'hostAccess.continue')}</Button>}>
        <Switch aria-label={props.title} checked={props.state === 'enabled'} disabled={!canManage()} onClick={event => {
          // Keep the native checked state authoritative while confirmation is open.
          event.preventDefault();
          if (!canManage()) return;
          if (props.state === 'enabled') setConfirm('paused'); else props.onReconfigure();
        }} />
      </Show>
      <Show when={props.state !== 'unconfigured'}><Dropdown align="end" open={effectiveMenuOpen()} onOpenChange={setMenuOpen} trigger={<MoreHorizontal class="h-4 w-4" />} triggerClass="host-access-feature-more" triggerAriaLabel={`${i18n.t('hostAccess.manage')} · ${props.title}`} disabled={!canManage()} items={menuItems()} onSelect={action => { if (canManage()) setConfirm(action as 'paused' | 'unconfigured'); }} /></Show>
      <Dialog open={presented() && Boolean(confirm())} onOpenChange={open => { if (!open && !props.busy) setConfirm(undefined); }}
        closeLabel={i18n.t('common.actions.close')} title={i18n.t(confirm() === 'paused' ? 'hostAccess.pauseTitle' : 'hostAccess.removeTitle')}
        footer={<><Button variant="ghost" disabled={props.busy} onClick={() => setConfirm(undefined)}>{i18n.t('common.actions.cancel')}</Button><Button variant="destructive" disabled={!canManage()} onClick={() => void commit()}>{i18n.t(confirm() === 'paused' ? 'hostAccess.pause' : 'hostAccess.remove')}</Button></>}>
        <p class="host-access-confirm-target">{props.title}</p><p class="text-sm text-muted-foreground">{i18n.t(confirm() === 'paused' ? 'hostAccess.pauseHint' : 'hostAccess.removeHint')}</p>
        <Show when={props.error}><p role="alert" class="host-app-error">{props.error}</p></Show>
      </Dialog>
    </div>;
    return <section class="host-access-management" aria-label={i18n.t('hostAccess.manage')}>
  <Show when={!confirm()}><HostAccessStatus state={props.state} ready={props.ready} /></Show>
  <Show when={confirm()} fallback={<div class="host-access-actions">
   <Show when={props.state !== 'enabled' || props.ready === false}><Button variant="outline" disabled={!canManage()} onClick={() => { if (canManage()) props.onReconfigure(); }}>{i18n.t(props.state === 'paused' ? 'hostAccess.resume' : props.state === 'unconfigured' ? 'hostAccess.setup' : 'hostAccess.continue')}</Button></Show>
   <Show when={props.state === 'enabled'}><Button variant="outline" disabled={!canManage()} onClick={() => { if (canManage()) setConfirm('paused'); }}>{i18n.t('hostAccess.pause')}</Button></Show>
   <Show when={props.state !== 'unconfigured'}><Button variant="ghost" disabled={!canManage()} onClick={() => { if (canManage()) setConfirm('unconfigured'); }}>{i18n.t('hostAccess.remove')}</Button></Show>
  </div>}>{action => <div class="host-access-confirm" role="alert"><div class="host-access-state-summary"><HostAccessStateIllustration state={action() === 'paused' ? 'paused' : 'remove'} /><h3>{i18n.t(action() === 'paused' ? 'hostAccess.pauseTitle' : 'hostAccess.removeTitle')}</h3></div><p>{i18n.t(action() === 'paused' ? 'hostAccess.pauseHint' : 'hostAccess.removeHint')}</p><div class="host-access-actions">
   <Button variant="ghost" disabled={props.busy} onClick={() => setConfirm(undefined)}>{i18n.t('common.actions.cancel')}</Button><Button variant="destructive" disabled={!canManage()} onClick={() => void commit()}>{i18n.t(action() === 'paused' ? 'hostAccess.pause' : 'hostAccess.remove')}</Button>
  </div></div>}</Show>
 </section>;
}
