import { Button } from '@floegence/floe-webapp-core/ui';
import { For, Show, createSignal } from 'solid-js';
import { useI18n } from '../i18n';
import type { HostAccessState } from '../services/hostAccess';
import { HostAccessFeatureIllustration, HostAccessFeatureMark, HostAccessPermissionIllustration, HostAccessStateIllustration } from './HostAccessIllustration';
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
    const next = (): 'screen_recording' | 'accessibility' | undefined => !props.screen ? 'screen_recording' : props.needsInput && !props.input ? 'accessibility' : undefined;
    return <section class="host-access-permissions" aria-label={i18n.t('hostAccess.requirements')}>
  <Show when={next()}><p>{i18n.t('hostAccess.authorizeOnHost')}</p></Show>
  <For each={['screen_recording', 'accessibility'] as const}>{permission => <Show when={permission === 'screen_recording' ? !props.screen : props.needsInput && !props.input}>
   <div class="host-access-permission">
    <div class="host-access-permission-visual"><HostAccessPermissionIllustration kind={permission === 'screen_recording' ? 'screen' : 'input'} desktop={props.desktop} /></div>
    <div><h3>{i18n.t(permission === 'accessibility' ? 'hostAccess.inputPurpose' : props.desktop ? 'hostAccess.desktopPurpose' : 'hostAccess.appPurpose')}</h3><p>{i18n.t(permission === 'screen_recording' ? 'hostAccess.screenPermission' : 'hostAccess.inputPermission')}</p></div>
    <span>{i18n.t('hostAccess.required')}</span>
   </div>
  </Show>}</For>
  <Show when={next()} fallback={<p role="status">{i18n.t('hostAccess.permissionsReady')}</p>}>{permission => <div class="host-access-actions">
   <Button disabled={!props.allowed || props.busy} onClick={() => props.onPermission(permission())}>{i18n.t(permission() === 'screen_recording' ? 'hostAccess.allowScreen' : 'hostAccess.allowInput')}</Button>
   <Button variant="ghost" disabled={props.busy} onClick={props.onRefresh}>{i18n.t('hostAccess.checkAgain')}</Button>
  </div>}</Show>

 </section>;
}
export function HostAccessSystemPermissions(props: {
    screen: boolean;
    input: boolean;
    allowed: boolean;
    busy: boolean;
    onPermission: (permission: 'screen_recording' | 'accessibility', manage?: boolean) => void;
}) {
    const i18n = useI18n();
    return <details class="host-access-system"><summary>{i18n.t('hostAccess.systemSettings')}</summary>
      <p>{i18n.t('hostAccess.sharedPermissions')}</p>
      <For each={['screen_recording', 'accessibility'] as const}>{permission => <div class="host-access-system-row">
        <div><strong>{i18n.t(permission === 'screen_recording' ? 'hostAccess.screenPermission' : 'hostAccess.inputPermission')}</strong><span>{i18n.t('hostAccess.required')}</span></div>
        <Button size="sm" variant="outline" disabled={!props.allowed || props.busy} onClick={() => props.onPermission(permission, true)}>{i18n.t('hostAccess.openSystemSettings')}</Button>
      </div>}</For>
    </details>;
}

export function HostAccessFeatureSettings(props: {
    feature: 'applications' | 'desktop';
    state: HostAccessState;
    allowed: boolean;
    busy: boolean;
    ready?: boolean;
    onChange: (state: HostAccessState) => Promise<void>;
    onReconfigure: () => void;
}) {
    const i18n = useI18n();
    return <section class="host-access-feature-settings" aria-label={i18n.t(props.feature === 'applications' ? 'hostAccess.applicationFeature' : 'remoteDesktop.title')}>
      <div class="host-access-feature-heading">
        <HostAccessFeatureMark feature={props.feature} />
        <div><h3>{i18n.t(props.feature === 'applications' ? 'hostAccess.applicationFeature' : 'remoteDesktop.title')}</h3><p>{i18n.t(props.feature === 'applications' ? 'hostAccess.appDescription' : 'hostAccess.desktopDescription')}</p></div>
      </div>
      <HostAccessManagement {...props} />
    </section>;
}

export function HostAccessManagement(props: {
    state: HostAccessState;
    ready?: boolean;
    allowed: boolean;
    busy: boolean;
    onChange: (state: HostAccessState) => Promise<void>;
    onReconfigure: () => void;
}) {
    const i18n = useI18n();
    const [confirm, setConfirm] = createSignal<'paused' | 'unconfigured'>();
    return <section class="host-access-management" aria-label={i18n.t('hostAccess.manage')}>
  <Show when={!confirm()}><div class="host-access-state-summary"><p class="host-access-state" data-state={props.state} data-ready={props.ready !== false} role="status">{i18n.t(props.state === 'paused' ? 'hostAccess.paused' : props.state === 'unconfigured' ? 'hostAccess.unconfigured' : props.ready === false ? 'hostAccess.needsAttention' : 'hostAccess.enabled')}</p></div></Show>
  <Show when={confirm()} fallback={<div class="host-access-actions">
   <Show when={props.state !== 'enabled' || props.ready === false}><Button variant="outline" disabled={!props.allowed || props.busy} onClick={props.onReconfigure}>{i18n.t(props.state === 'paused' ? 'hostAccess.resume' : props.state === 'unconfigured' ? 'hostAccess.setup' : 'hostAccess.continue')}</Button></Show>
   <Show when={props.state === 'enabled'}><Button variant="outline" disabled={!props.allowed || props.busy} onClick={() => setConfirm('paused')}>{i18n.t('hostAccess.pause')}</Button></Show>
   <Show when={props.state !== 'unconfigured'}><Button variant="ghost" disabled={!props.allowed || props.busy} onClick={() => setConfirm('unconfigured')}>{i18n.t('hostAccess.remove')}</Button></Show>
  </div>}>{action => <div class="host-access-confirm" role="alert"><div class="host-access-state-summary"><HostAccessStateIllustration state={action() === 'paused' ? 'paused' : 'remove'} /><h3>{i18n.t(action() === 'paused' ? 'hostAccess.pauseTitle' : 'hostAccess.removeTitle')}</h3></div><p>{i18n.t(action() === 'paused' ? 'hostAccess.pauseHint' : 'hostAccess.removeHint')}</p><div class="host-access-actions">
   <Button variant="ghost" disabled={props.busy} onClick={() => setConfirm(undefined)}>{i18n.t('common.actions.cancel')}</Button><Button variant="destructive" disabled={!props.allowed || props.busy} onClick={async () => { try {
            await props.onChange(action());
            setConfirm(undefined);
        }
        catch { /* The owning panel keeps the failure visible for reconciliation. */ } }}>{i18n.t(action() === 'paused' ? 'hostAccess.pause' : 'hostAccess.remove')}</Button>
  </div></div>}</Show>
 </section>;
}
