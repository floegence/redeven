import { createEnvResourceCollection } from '../../services/envResourceCache';
import { useEnvContext } from '../EnvContext';
import { createEffect, on, createSignal, onCleanup, Show } from 'solid-js';
import { Button, Switch } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../../i18n';
import { forgetRemoteDesktopAuthorization, setRemoteDesktopUnattended, type RemoteDesktopStatus } from '../../services/remoteDesktopApi';

import { SettingsList, SettingRow } from './SettingsPrimitives';
import { useSettingsPresentation } from '../../../../../../settings_ui/src/SettingsPanelHost';

export function DesktopAuthorizationSettings(props: { status?: RemoteDesktopStatus; allowed: boolean; refresh: () => Promise<void> }) {
  const i18n = useI18n();
  const presented = useSettingsPresentation('applications');
  const resources = createEnvResourceCollection(useEnvContext());
  const [busy, setBusy] = createSignal(false);
  const [confirm, setConfirm] = createSignal(false);
  const [error, setError] = createSignal('');
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const identity = () => JSON.stringify([resources.access().generation, resources.ready(), props.status?.capabilities.backend, props.status?.capabilities.authorization]);
  const [confirmationIdentity, setConfirmationIdentity] = createSignal('');
  createEffect(on(identity, () => { setConfirm(false); }));
  const applicable = () => props.status?.capabilities.backend === 'wayland' && props.status.capabilities.unattended;
  // IMPORTANT: Hidden retained controls cannot mutate host consent. Retire
  // confirmation on hiding/authority loss so reopening never revives intent.
  const canChange = () => !disposed && presented() && !busy() && props.allowed && resources.ready() && applicable();
  createEffect(() => { if (!presented() || !props.allowed) { setConfirm(false); setConfirmationIdentity(''); } });
  const change = async (action: () => Promise<unknown>) => {
    if (!canChange()) return;
    const admitted = identity();
    const current = () => !disposed && identity() === admitted && resources.ready();
    setBusy(true); setError(''); setConfirm(false);
    try { await action(); if (current()) await props.refresh(); }
    catch { if (current()) setError(i18n.t('remoteDesktop.settingsFailed')); }
    finally { if (!disposed) setBusy(false); }
  };
  // IMPORTANT: Persistent authorization belongs to Env settings. Opening this
  // form never requests system consent, starts a desktop, or forgets approval.
  return <Show when={applicable()}><section class="space-y-3">
    <SettingsList><SettingRow title={i18n.t('remoteDesktop.unattended')} description={i18n.t('remoteDesktop.unattendedHint')} control={<Switch checked={props.status?.unattended ?? false} disabled={!canChange()} onChange={value => change(() => setRemoteDesktopUnattended(value))}
      aria-label={i18n.t('remoteDesktop.unattended')} />} /></SettingsList>
    <Show when={['saved', 'unknown', 'revoked'].includes(props.status?.capabilities.authorization ?? '')}>
      <Button variant="outline" disabled={!canChange()} onClick={() => { if (!canChange()) return; setConfirmationIdentity(identity()); setConfirm(true); }}>{i18n.t('remoteDesktop.approvalForget')}</Button>
    </Show>
    <Show when={confirm()}><div role="alert" class="space-y-2"><p>{i18n.t('remoteDesktop.approvalForgetHint')}</p><div class="flex gap-2">
      <Button variant="ghost" onClick={() => setConfirm(false)}>{i18n.t('common.actions.cancel')}</Button>
      <Button disabled={!canChange()} onClick={() => { if (confirm() && confirmationIdentity() === identity()) void change(forgetRemoteDesktopAuthorization); }}>{i18n.t('remoteDesktop.approvalForgetConfirm')}</Button>
    </div></div></Show>
    <Show when={error()}><p role="alert">{error()}</p></Show>
  </section></Show>;
}
