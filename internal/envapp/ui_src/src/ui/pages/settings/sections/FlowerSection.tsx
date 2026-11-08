import { Show, createResource, onCleanup, createMemo } from 'solid-js';
import { FlowerSettingsPanel } from '../../../../../../../flower_ui/src/settings/FlowerSettingsPanel';
import { createLocalizedFlowerSurfaceCopy } from '../../../../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { useI18n, type EnvAppTranslationKey } from '../../../i18n';

// IMPORTANT: FlowerSettingsSurface is the single provider/default editor.
// Runtime Settings must never reimplement its save, account or secret controller.
export function FlowerSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();
  const copy = createMemo(() => createLocalizedFlowerSurfaceCopy({ locale: i18n.locale(), t: (key, values) => i18n.t(key as EnvAppTranslationKey, values), tn: (key, count, values) => i18n.tn(key as EnvAppTranslationKey, count, values) }));
  const lifetime = new AbortController();
  onCleanup(() => lifetime.abort());
  const [adapter] = createResource(() => ctx.env.createSettingsFlowerAdapter?.({ signal: lifetime.signal, isAvailable: () => ctx.protocol.status() === 'connected' && (!ctx.env.resourceCacheAccess || ctx.env.resourceCacheAccess().phase === 'ready') }));
  return <Show when={adapter()} fallback={<p role="status">{copy().chat.loadingSettings}</p>}>{owner =>
    <FlowerSettingsPanel adapter={owner()} copy={copy()} canEdit={ctx.canAdmin()}
      onChanged={ctx.env.bumpSettingsSeq} onOpenComputer={() => ctx.env.openSettings('browser')} />
  }</Show>;
}
