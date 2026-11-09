import { Button, Dropdown, Switch } from '@floegence/floe-webapp-core/ui';
import { MoreHorizontal } from '@floegence/floe-webapp-core/icons';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Dialog } from '../primitives/EnvAppModal';
import { useSettingsPresentation } from '../../../../../settings_ui/src/SettingsPanelHost';
import { useI18n } from '../i18n';
import type { HostAccessState } from '../services/hostAccess';
import { HostAccessFeatureIllustration, HostAccessFeatureMark, HostAccessHelperIllustration, HostAccessPermissionIllustration, HostAccessStateIllustration } from './HostAccessIllustration';
import { SettingRow, SettingsDisclosure, SettingsList } from './settings/SettingsPrimitives';
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
    active?: boolean;
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
    const recoveryAllowed = createMemo(() => props.allowed && props.active !== false);
    const [requested, setRequested] = createSignal<'screen_recording' | 'accessibility'>();
    const [returnPending, setReturnPending] = createSignal(true);
    let awaitingReturn = false;
    const next = (): 'screen_recording' | 'accessibility' | undefined => !props.screen ? 'screen_recording' : props.needsInput && !props.input ? 'accessibility' : undefined;
    const granted = (permission: 'screen_recording' | 'accessibility') => permission === 'screen_recording' ? props.screen : props.input;
    const permissionLabel = (permission: 'screen_recording' | 'accessibility') => i18n.t(permission === 'screen_recording' ? 'hostAccess.screenPermission' : 'hostAccess.inputPermission');
    // Entering setup or returning from its explicit permission flow renews the idle
    // native owner. Ordinary polling and unrelated focus never restart sharing.
    const returned = () => { if (props.active !== false && awaitingReturn) { awaitingReturn = false; setReturnPending(true); } };
    window.addEventListener('focus', returned);
    onCleanup(() => window.removeEventListener('focus', returned));
    createEffect(() => {
      if (props.active !== false && returnPending() && next() && !props.busy && props.allowed) {
        setReturnPending(false); props.onRefresh();
      }
    });
    return <section class="host-access-permissions" aria-label={i18n.t('hostAccess.requirements')}>
  <ol class="host-access-permission-progress" aria-label={i18n.t('hostAccess.requirements')}>
    <For each={props.needsInput ? ['screen_recording', 'accessibility'] as const : ['screen_recording'] as const}>{(permission, index) =>
      <li data-complete={granted(permission)} aria-current={next() === permission ? 'step' : undefined}>
        <span class="host-access-step-number" aria-hidden="true"><Show when={granted(permission)} fallback={index() + 1}><svg viewBox="0 0 16 16" fill="none"><path d="m4 8 3 3 5-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg></Show></span>
        <span>{permissionLabel(permission)}<Show when={granted(permission)}><span class="sr-only"> · {i18n.t('hostAccess.allowed')}</span></Show></span>
      </li>
    }</For>
  </ol>
  <Show when={next()} fallback={<p class="host-access-ready" role="status">{i18n.t('hostAccess.permissionsReady')}</p>}>{permission => <>
    <div class="host-access-permission">
      <div class="host-access-permission-visual"><HostAccessPermissionIllustration kind={permission() === 'screen_recording' ? 'screen' : 'input'} desktop={props.desktop} /></div>
      <div><h3>{i18n.t(permission() === 'accessibility' ? 'hostAccess.inputPurpose' : props.desktop ? 'hostAccess.desktopPurpose' : 'hostAccess.appPurpose')}</h3>
        <p>{i18n.t('hostAccess.permissionInstruction', { permission: permissionLabel(permission()) })}</p></div>
    </div>
    <div class="host-access-permission-target">{props.permissionAppName || i18n.t('hostAccess.permissionAppUnknown')}</div>
    <div class="host-access-permission-footer">
      <p role="status">{i18n.t(props.busy ? 'hostAccess.checkingPermissions' : 'hostAccess.returnToCheck')}</p>
      <div class="host-access-actions">
        <Button disabled={!props.allowed || props.busy} onClick={() => { const manage = requested() === permission(); setRequested(permission()); awaitingReturn = true; if (manage) props.onPermission(permission(), true); else props.onPermission(permission()); }}>{i18n.t(requested() === permission() ? 'hostAccess.openSystemSettings' : permission() === 'screen_recording' ? 'hostAccess.allowScreen' : 'hostAccess.allowInput')}</Button>
        <Button variant="ghost" disabled={!props.allowed || props.busy} onClick={props.onRefresh}>{i18n.t('hostAccess.checkAgain')}</Button>
      </div>
    </div>
  </>}</Show>
  <Show when={next() && props.onRecovery}><HostAccessRecovery name={props.permissionAppName} allowed={recoveryAllowed()} busy={props.busy} onRecovery={props.onRecovery!} /></Show>
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
    const [expanded, setExpanded] = createSignal(false);
    const canManage = () => expanded() && props.allowed && !props.busy;
    const recoveryAllowed = createMemo(() => props.allowed && expanded());
    const [requested, setRequested] = createSignal<Array<'screen_recording' | 'accessibility'>>([]);
    const granted = (permission: 'screen_recording' | 'accessibility') => permission === 'screen_recording' ? props.screen : props.input;
    return <SettingsDisclosure open={expanded()} onOpenChange={setExpanded} class="host-access-system" title={i18n.t('hostAccess.systemSettings')}>
      <HostAccessPermissionDestination name={props.permissionAppName} />
      <SettingsList><For each={['screen_recording', 'accessibility'] as const}>{permission => <SettingRow class="host-access-system-row"
        title={i18n.t(permission === 'screen_recording' ? 'hostAccess.screenPermission' : 'hostAccess.inputPermission')}
        description={i18n.t(granted(permission) ? 'hostAccess.allowed' : 'hostAccess.required')}
        control={<Button size="sm" variant="outline" disabled={!canManage()} onClick={() => { if (!canManage()) return; const manage = granted(permission) || requested().includes(permission); if (!manage) setRequested(previous => [...previous, permission]); props.onPermission(permission, manage); }}>{i18n.t((granted(permission) || requested().includes(permission)) ? 'hostAccess.openSystemSettings' : permission === 'screen_recording' ? 'hostAccess.allowScreen' : 'hostAccess.allowInput')}</Button>} />}</For></SettingsList>
      <Show when={requested().some(permission => !granted(permission))}><p role="status">{i18n.t('hostAccess.requestPending')}</p></Show>
      <p>{i18n.t('hostAccess.sharedPermissions')}</p>
      <Show when={props.onRecovery}><HostAccessRecovery name={props.permissionAppName} allowed={recoveryAllowed()} busy={props.busy} onRecovery={props.onRecovery!} /></Show>
    </SettingsDisclosure>;
}

function HostAccessRecovery(props: { name?: string; allowed: boolean; busy: boolean; onRecovery: (action: 'reveal_application' | 'restart_application') => void }) {
    const i18n = useI18n();
    const [confirmRestart, setConfirmRestart] = createSignal(false);
    const [expanded, setExpanded] = createSignal(false);
    const canManage = () => expanded() && props.allowed && !props.busy;
    createEffect(() => { if (!expanded() || !props.allowed) setConfirmRestart(false); });
    return <SettingsDisclosure open={expanded()} onOpenChange={setExpanded} class="host-access-recovery" title={i18n.t('hostAccess.permissionHelp')}>
      <SettingsList>
      <SettingRow class="host-access-recovery-step" resourceIcon={() => <HostAccessHelperIllustration kind="locate" />} title={i18n.t('hostAccess.missingApplication')} description={i18n.t('hostAccess.addApplicationHint', { app: props.name || 'Redeven Desktop Access' })}><Button size="sm" variant="outline" disabled={!canManage() || !props.name} onClick={() => { if (canManage() && props.name) props.onRecovery('reveal_application'); }}>{i18n.t('hostAccess.revealApplication')}</Button></SettingRow>
      <SettingRow class="host-access-recovery-step" resourceIcon={() => <HostAccessHelperIllustration kind="restart" />} title={i18n.t('hostAccess.changedPermissions')} description={i18n.t('hostAccess.helperRestartHint')}>
      <Show when={confirmRestart()} fallback={<Button size="sm" variant="outline" disabled={!canManage()} onClick={() => { if (canManage()) setConfirmRestart(true); }}>{i18n.t('hostAccess.applyPermissions')}</Button>}>
        <p role="alert">{i18n.t('hostAccess.helperRestartConfirm')}</p><div class="host-access-actions"><Button size="sm" variant="ghost" disabled={props.busy} onClick={() => setConfirmRestart(false)}>{i18n.t('common.actions.cancel')}</Button><Button size="sm" disabled={!canManage()} onClick={() => { if (!canManage()) return; props.onRecovery('restart_application'); setConfirmRestart(false); }}>{i18n.t('hostAccess.restartHelper')}</Button></div>
      </Show></SettingRow>
      </SettingsList>
    </SettingsDisclosure>;
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
      <SettingRow class="host-access-feature-row" title={title()} resourceIcon={() => <HostAccessFeatureMark feature={props.feature} />}
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
