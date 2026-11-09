import { batch, createEffect, createMemo, createResource, createSignal, on, onCleanup, Show } from 'solid-js';
import { Button, Select } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../../i18n';
import { useEnvContext } from '../EnvContext';
import { fetchLocalApiJSON } from '../../services/localApi';
import { createEnvResourceCollection } from '../../services/envResourceCache';

import { SettingsList, SettingRow } from './SettingsPrimitives';
import { useSettingsPresentation } from '../../../../../../settings_ui/src/SettingsPanelHost';

type Picture = { mode: 'auto' | 'clarity' | 'smooth' | 'data'; max_dimension: number; frame_rate: number };
const endpoint = '/_redeven_proxy/api/host-applications/picture';
export function ApplicationPictureSettings(props: { allowed: boolean; macOS: boolean }) {
  const i18n = useI18n(), env = useEnvContext();
  const resources = createEnvResourceCollection(env);
  let disposed = false; onCleanup(() => { disposed = true; });
  const presented = useSettingsPresentation('applications');
  const authority = createMemo(() => ({ generation: resources.access().generation, ready: resources.ready(), allowed: props.allowed }));
  const [saved, { refetch, mutate }] = createResource(() => resources.ready() ? resources.access().generation + 1 : false, async () => {
    const generation = resources.access().generation;
    const value = await fetchLocalApiJSON<Picture>(endpoint, { method: 'GET' });
    if (disposed || generation !== resources.access().generation || !resources.ready()) throw new DOMException('Settings authority changed', 'AbortError');
    return { generation, value };
  });
  const canonical = () => !saved.error && resources.ready() && saved()?.generation === resources.access().generation ? saved()?.value : undefined;
  const [choices, setChoices] = createSignal<Partial<Picture>>({});
  const draft = createMemo<Picture>(() => ({ mode: 'auto', max_dimension: 0, frame_rate: 0, ...canonical(), ...choices() }));
  const [busy, setBusy] = createSignal(false), [error, setError] = createSignal('');
  const hasChoices = () => Object.keys(choices()).length > 0;
  const editable = () => !disposed && presented() && props.allowed && resources.ready() && !!canonical();
  const [openField, setOpenField] = createSignal<keyof Picture>();
  // IMPORTANT: Retained categories do not own visible portals. Resolve this
  // under the component owner; Select may read controlled props on events.
  const presentedField = createMemo(() => editable() ? openField() : undefined);
  createEffect(() => { if (!editable()) setOpenField(undefined); });
  const open = (field: keyof Picture, value: boolean) => setOpenField(value && editable() ? field : undefined);
  let queued = false;
  // IMPORTANT: Reads, permission recovery and navigation never submit retained
  // choices. Every write comes from a current explicit choice or Retry; losing
  // authority cancels admission without trusting any late acknowledgement.
  createEffect(on(authority, () => {
    queued = false;
    if (hasChoices()) setError(i18n.t('settings.autoSave.unsavedChanges'));
  }, { defer: true }));
  createEffect(on(presented, visible => {
    if (!visible && queued) { queued = false; if (hasChoices()) setError(i18n.t('settings.autoSave.unsavedChanges')); }
  }, { defer: true }));
  const save = async () => {
    if (!editable() || busy() || !queued || !hasChoices()) return;
    const admitted = authority(), submitted = { ...draft() };
    const current = () => !disposed && authority() === admitted;
    queued = false; setBusy(true); setError('');
    try {
      // IMPORTANT: The owner API assigns a complete record. Serialize explicit
      // choices, preserve untouched platform fields, and never auto-retry an
      // uncertain failure. Retry is safe only as a new explicit assignment.
      const value = await fetchLocalApiJSON<Picture>(endpoint, { method: 'PUT', body: JSON.stringify(submitted) });
      if (current()) batch(() => {
        mutate({ generation: admitted.generation, value });
        setChoices(previous => Object.fromEntries(Object.entries(previous).filter(([key, selected]) => selected !== submitted[key as keyof Picture])) as Partial<Picture>);
        queued = queued && hasChoices();
        if (!hasChoices()) setError('');
      });
    } catch {
      if (current()) { queued = false; setError(i18n.t('remoteDesktop.settingsFailed')); }
    } finally {
      if (!disposed) { setBusy(false); if (queued && !error()) void save(); }
    }
  };
  const change = (patch: Partial<Picture>) => {
    if (!editable() || Object.entries(patch).every(([key, value]) => draft()[key as keyof Picture] === value)) return;
    setChoices(previous => ({ ...previous, ...patch }));
    if (error()) return;
    queued = true; void save();
  };
  const retry = () => { if (!editable() || busy()) return; setError(''); queued = true; void save(); };
  return <section data-testid="application-picture-settings">
    <fieldset disabled={!editable()} class="min-w-0"><SettingsList class="application-picture-fields">
      <SettingRow title={i18n.t('hostApplications.macPicture')} control={<Select ariaLabel={i18n.t('hostApplications.macPicture')} disabled={!editable()} open={presentedField() === 'mode'} onOpenChange={value => open('mode', value)} value={draft().mode} options={[
        { value: 'auto', label: i18n.t('hostApplications.macPictureAuto') }, { value: 'clarity', label: i18n.t('hostApplications.macPictureClarity') },
        { value: 'smooth', label: i18n.t('hostApplications.macPictureSmooth') }, { value: 'data', label: i18n.t('hostApplications.macPictureData') },
      ]} onChange={mode => change({ mode: mode as Picture['mode'] })} />} />
      <Show when={props.macOS}>
        <SettingRow title={i18n.t('hostApplications.macPictureResolution')} control={<Select ariaLabel={i18n.t('hostApplications.macPictureResolution')} disabled={!editable()} open={presentedField() === 'max_dimension'} onOpenChange={value => open('max_dimension', value)} value={String(draft().max_dimension)} options={[0, 1600, 1920, 2560, 3840, 4096].map(value => ({ value: String(value), label: value ? `${value} px` : i18n.t('hostApplications.macPictureAuto') }))} onChange={value => change({ max_dimension: Number(value) })} />} />
        <SettingRow title={i18n.t('hostApplications.macPictureFrameRate')} control={<Select ariaLabel={i18n.t('hostApplications.macPictureFrameRate')} disabled={!editable()} open={presentedField() === 'frame_rate'} onOpenChange={value => open('frame_rate', value)} value={String(draft().frame_rate)} options={[0, 15, 24, 30, 60].map(value => ({ value: String(value), label: value ? `${value} FPS` : i18n.t('hostApplications.macPictureAuto') }))} onChange={value => change({ frame_rate: Number(value) })} />} />
      </Show>
    </SettingsList>
    </fieldset>
    <Show when={busy() && !error()}><p role="status" class="application-picture-feedback text-muted-foreground">{i18n.t('settings.autoSave.saving')}</p></Show>
    <Show when={saved.error || error()}><div class="application-picture-feedback"><p role="alert" class="text-destructive">{error() || i18n.t('hostApplications.errors.failed')}</p>
      <Show when={saved.error} fallback={<Button size="sm" variant="ghost" disabled={!editable() || busy()} onClick={retry}>{i18n.t('common.actions.retry')}</Button>}>
        <Button size="sm" variant="ghost" disabled={!resources.ready()} onClick={() => void refetch()}>{i18n.t('common.actions.refresh')}</Button>
      </Show>
    </div></Show>
  </section>;
}
