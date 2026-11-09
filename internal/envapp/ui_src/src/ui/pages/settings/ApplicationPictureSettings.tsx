import { createEffect, createResource, createSignal, onCleanup, Show } from 'solid-js';
import { Button, Select } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../../i18n';
import { useEnvContext } from '../EnvContext';
import { fetchLocalApiJSON } from '../../services/localApi';
import { createEnvResourceCollection } from '../../services/envResourceCache';

type Picture = { mode: 'auto' | 'clarity' | 'smooth' | 'data'; max_dimension: number; frame_rate: number };
const endpoint = '/_redeven_proxy/api/host-applications/picture';
export function ApplicationPictureSettings(props: { allowed: boolean; macOS: boolean }) {
  const i18n = useI18n(), env = useEnvContext();
  const resources = createEnvResourceCollection(env);
  let disposed = false; onCleanup(() => { disposed = true; });
  const [saved, { refetch, mutate }] = createResource(() => resources.ready() ? resources.access().generation + 1 : false, async () => {
    const generation = resources.access().generation;
    const result = await fetchLocalApiJSON<Picture>(endpoint, { method: 'GET' });
    if (disposed || generation !== resources.access().generation || !resources.ready()) throw new DOMException('Settings authority changed', 'AbortError');
    return result;
  });
  const savedData = () => saved.error ? undefined : saved();
  const [draft, setDraft] = createSignal<Picture>({ mode: 'auto', max_dimension: 0, frame_rate: 0 });
  const [dirty, setDirty] = createSignal(false), [busy, setBusy] = createSignal(false), [error, setError] = createSignal('');
  createEffect(() => { const value = savedData(); if (value && !dirty()) setDraft(value); });
  const change = (patch: Partial<Picture>) => { setDirty(true); setDraft(value => ({ ...value, ...patch })); };
  const save = async () => {
    if (disposed || busy() || !props.allowed || !resources.ready()) return;
    const generation = resources.access().generation;
    setBusy(true); setError('');
    try {
      const result = await fetchLocalApiJSON<Picture>(endpoint, { method: 'PUT', body: JSON.stringify(draft()) });
      if (!disposed && generation === resources.access().generation) { setDirty(false); mutate(result); }
    } catch { if (!disposed) setError(i18n.t('remoteDesktop.settingsFailed')); }
    finally { if (!disposed) setBusy(false); }
  };
  return <section class="space-y-3" data-testid="application-picture-settings">
    <h2 class="font-medium">{i18n.t('hostApplications.macPicture')}</h2>
    <Show when={saved.error || error()}><p role="alert">{error() || i18n.t('hostApplications.errors.failed')}</p><Button variant="ghost" onClick={() => void refetch()}>{i18n.t('common.actions.refresh')}</Button></Show>
    <fieldset disabled={!savedData() || !props.allowed || busy()} class="space-y-3">
      <Select ariaLabel={i18n.t('hostApplications.macPicture')} value={draft().mode} options={[
        { value: 'auto', label: i18n.t('hostApplications.macPictureAuto') }, { value: 'clarity', label: i18n.t('hostApplications.macPictureClarity') },
        { value: 'smooth', label: i18n.t('hostApplications.macPictureSmooth') }, { value: 'data', label: i18n.t('hostApplications.macPictureData') },
      ]} onChange={mode => change({ mode: mode as Picture['mode'] })} />
      <Show when={props.macOS}><div class="grid gap-3 sm:grid-cols-2">
        <label>{i18n.t('hostApplications.macPictureResolution')}<Select ariaLabel={i18n.t('hostApplications.macPictureResolution')} value={String(draft().max_dimension)} options={[0, 1600, 1920, 2560, 3840, 4096].map(value => ({ value: String(value), label: value ? `${value} px` : i18n.t('hostApplications.macPictureAuto') }))} onChange={value => change({ max_dimension: Number(value) })} /></label>
        <label>{i18n.t('hostApplications.macPictureFrameRate')}<Select ariaLabel={i18n.t('hostApplications.macPictureFrameRate')} value={String(draft().frame_rate)} options={[0, 15, 24, 30, 60].map(value => ({ value: String(value), label: value ? `${value} FPS` : i18n.t('hostApplications.macPictureAuto') }))} onChange={value => change({ frame_rate: Number(value) })} /></label>
      </div></Show>
      <div class="flex justify-end"><Button disabled={!dirty() || busy()} onClick={() => void save()}>{i18n.t('common.actions.save')}</Button></div>
    </fieldset>
  </section>;
}
