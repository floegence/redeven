import { For, Show, createEffect, createSignal, createUniqueId, on, onCleanup, type JSX } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { Check, CheckCircle, Loader2 } from '@floegence/floe-webapp-core/icons';
import { pluginMutationOutcome, type PluginDataBinding, type PluginRetainedRecoveryInspection } from '@floegence/redevplugin-ui';

import { useI18n } from '../i18n';
import { Dialog } from '../primitives/EnvAppModal';
import { PLUGIN_MOBILE_TOUCH_TARGET_CLASS } from './pluginPresentation';
import type { PluginLifecycleAPI } from './pluginApi';
import type { PluginInventoryItem } from './pluginTypes';

export type PluginRetainedDataAPI = Pick<PluginLifecycleAPI,
  'listRecoverableData' | 'inspectRetainedRecovery' | 'commitRetainedRecovery' | 'getRetainedRecoveryStatus'>;

type RecoveryStage = 'loading' | 'choose' | 'preparing' | 'review' | 'committing' | 'reconciling' | 'unresolved' | 'not_applied' | 'disable_unknown' | 'complete';

export type PluginRetainedDataDialogProps = {
  open: boolean;
  item?: PluginInventoryItem;
  ownerScope?: object | false;
  canRecover: boolean;
  canDisable: boolean;
  api: PluginRetainedDataAPI;
  onDisable: (item: PluginInventoryItem, signal: AbortSignal) => Promise<unknown>;
  onRefresh: () => Promise<unknown> | unknown;
  onOpenChange: (open: boolean) => void;
  onDismissed: () => void;
};

export function PluginRetainedDataDialog(props: PluginRetainedDataDialogProps): JSX.Element {
  const i18n = useI18n();
  const groupName = `retained-data-${createUniqueId()}`;
  const [stage, setStage] = createSignal<RecoveryStage>('loading');
  const [sources, setSources] = createSignal<PluginDataBinding[]>([]);
  const [sourceID, setSourceID] = createSignal<string>();
  const [inspection, setInspection] = createSignal<PluginRetainedRecoveryInspection>();
  const [error, setError] = createSignal<string>();
  const [refreshFailed, setRefreshFailed] = createSignal(false);
  let operation: AbortController | undefined;
  let owner: object | undefined;
  let targetID: string | undefined;
  let wasPresent = false;
  let disablePermission = false;
  let disableInFlight = false;
  const selected = () => sources().find((source) => source.plugin_instance_id === sourceID());
  const busy = () => ['loading', 'preparing', 'committing', 'reconciling'].includes(stage());
  const closeBlocked = () => stage() === 'committing' || stage() === 'preparing';
  const date = (source: PluginDataBinding) => source.retained_at
    ? i18n.formatDateTime(source.retained_at, { dateStyle: 'medium', timeStyle: 'short' })
    : i18n.t('uiCopy.plugin.dataRecovery.savedData');

  function begin() {
    operation?.abort('Recovery request superseded');
    const controller = new AbortController();
    operation = controller;
    return controller;
  }
  function current(controller: AbortController) {
    return !controller.signal.aborted && operation === controller && props.open
      && props.canRecover && props.ownerScope === owner && props.item?.pluginInstanceID === targetID;
  }
  function finish(controller: AbortController) {
    if (operation === controller) operation = undefined;
  }

  createEffect(on(
    () => [props.open, props.ownerScope, props.item?.pluginInstanceID, props.canRecover, props.canDisable] as const,
    ([open, scope, id, canRecover, allowedToDisable], previous) => {
      if (previous && previous[0] === open && previous[1] === scope && previous[2] === id
        && previous[3] === canRecover && previous[4] === allowedToDisable) return;
      if (!scope || !id || !canRecover || (owner === scope && targetID === id && disablePermission && !allowedToDisable)) {
        operation?.abort('Recovery authority changed');
        operation = undefined;
        owner = undefined;
        targetID = undefined;
        setInspection(undefined);
        setSources([]);
        if (open) props.onOpenChange(false);
        return;
      }
      const sameTarget = owner === scope && targetID === id;
      if (!open) {
        operation?.abort('Recovery dialog closed');
        operation = undefined;
        if (stage() === 'committing' || stage() === 'reconciling') setStage('unresolved');
        if (stage() === 'preparing' && disableInFlight) setStage('disable_unknown');
        if (!sameTarget) { owner = undefined; targetID = undefined; setInspection(undefined); }
        return;
      }
      if (sameTarget && stage() === 'disable_unknown') return;
      if (sameTarget && inspection()) {
        if (stage() === 'unresolved') void checkStatus();
        return;
      }
      owner = scope;
      targetID = id;
      disablePermission = allowedToDisable;
      setRefreshFailed(false);
      void loadSources();
    },
  ));
  onCleanup(() => operation?.abort('Recovery dialog disposed'));

  async function loadSources() {
    if (!targetID) return;
    const controller = begin();
    setStage('loading');
    setError(undefined);
    setInspection(undefined);
    setSourceID(undefined);
    setSources([]);
    try {
      const result = await props.api.listRecoverableData(targetID, { signal: controller.signal });
      if (!current(controller)) return;
      setSources(result.retained_data);
      if (result.retained_data.length === 1) setSourceID(result.retained_data[0]!.plugin_instance_id);
    } catch {
      if (current(controller)) setError(i18n.t('uiCopy.plugin.dataRecovery.loadFailed'));
    } finally {
      if (current(controller)) setStage('choose');
      finish(controller);
    }
  }

  async function prepare() {
    const item = props.item;
    const source = selected();
    if (busy() || !item?.pluginInstanceID || !source || !props.canRecover || (item.canDisable && !props.canDisable)) return;
    const controller = begin();
    setStage('preparing');
    setError(undefined);
    disableInFlight = false;
    try {
      if (item.canDisable) {
        disableInFlight = true;
        await props.onDisable(item, controller.signal);
        disableInFlight = false;
        if (!current(controller)) return;
      }
      const result = await props.api.inspectRetainedRecovery({
        source_plugin_instance_id: source.plugin_instance_id,
        target_plugin_instance_id: item.pluginInstanceID,
      }, { signal: controller.signal });
      if (!current(controller)) return;
      setInspection(result);
      setStage('review');
    } catch (cause) {
      if (current(controller)) {
        const uncertainDisable = disableInFlight && pluginMutationOutcome(cause) !== 'not_committed';
        if (!uncertainDisable) disableInFlight = false;
        setStage(uncertainDisable ? 'disable_unknown' : 'choose');
        setError(i18n.t(uncertainDisable ? 'uiCopy.plugin.dataRecovery.unknown' : 'uiCopy.plugin.dataRecovery.reviewFailed'));
      }
    } finally { finish(controller); }
  }

  async function checkDisabled() {
    if (operation || stage() !== 'disable_unknown') return;
    const controller = begin();
    try {
      await props.onRefresh();
      if (current(controller) && props.item?.canDisable === false) {
        disableInFlight = false;
        setError(undefined);
        setStage('choose');
      }
    } catch { /* Keep uncertain effects read-only until inventory is authoritative. */ }
    finally { finish(controller); }
  }

  async function markComplete(controller: AbortController) {
    setStage('complete');
    setError(undefined);
    try {
      await props.onRefresh();
      if (current(controller)) setRefreshFailed(false);
    } catch {
      if (current(controller)) setRefreshFailed(true);
    }
  }

  async function reconcile(controller: AbortController, plan: PluginRetainedRecoveryInspection) {
    setStage('reconciling');
    setError(undefined);
    try {
      const result = await props.api.getRetainedRecoveryStatus(plan, { signal: controller.signal });
      if (!current(controller)) return;
      if (result.state === 'applied') await markComplete(controller);
      else {
        setStage('not_applied');
        setError(i18n.t('uiCopy.plugin.dataRecovery.notApplied'));
      }
    } catch {
      if (current(controller)) {
        setStage('unresolved');
        setError(i18n.t('uiCopy.plugin.dataRecovery.unknown'));
      }
    }
  }

  async function commit() {
    const plan = inspection();
    if (!plan || stage() !== 'review' || !props.canRecover) return;
    const controller = begin();
    setStage('committing');
    setError(undefined);
    try {
      await props.api.commitRetainedRecovery(plan, { signal: controller.signal });
      if (current(controller)) await markComplete(controller);
    } catch (cause) {
      if (!current(controller)) return;
      if (pluginMutationOutcome(cause) === 'not_committed') {
        setInspection(undefined);
        setStage('choose');
        setError(i18n.t('uiCopy.plugin.dataRecovery.reviewFailed'));
      } else await reconcile(controller, plan);
    } finally { finish(controller); }
  }

  async function checkStatus() {
    const plan = inspection();
    if (!plan || busy()) return;
    const controller = begin();
    try { await reconcile(controller, plan); } finally { finish(controller); }
  }

  async function refreshCompleted() {
    const controller = begin();
    try { await markComplete(controller); } finally { finish(controller); }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => { if (open || !closeBlocked()) props.onOpenChange(open); }}
      onPresenceChange={(present) => {
        const dismissed = wasPresent && !present;
        wasPresent = present;
        if (dismissed && !props.open) queueMicrotask(props.onDismissed);
      }}
      title={i18n.t('uiCopy.plugin.dataRecovery.title')}
      footer={(
        <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} size="sm" variant="outline" disabled={closeBlocked()} onClick={() => props.onOpenChange(false)}>
            {stage() === 'complete' ? i18n.t('common.actions.close') : i18n.t('common.actions.cancel')}
          </Button>
          <Show when={stage() === 'choose' && sources().length > 0 || stage() === 'preparing'}>
            <Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} size="sm" loading={stage() === 'preparing'} disabled={busy() || !selected() || !props.canRecover || Boolean(props.item?.canDisable && !props.canDisable)} onClick={() => void prepare()}>
              {props.item?.canDisable ? i18n.t('uiCopy.plugin.dataRecovery.disableContinue') : i18n.t('uiCopy.plugin.dataRecovery.continue')}
            </Button>
          </Show>
          <Show when={stage() === 'review' || stage() === 'committing'}>
            <Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} size="sm" variant="ghost" disabled={busy()} onClick={() => { setInspection(undefined); setStage('choose'); }}>{i18n.t('uiCopy.plugin.dataRecovery.back')}</Button>
            <Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} size="sm" data-plugin-recovery-confirm loading={stage() === 'committing'} disabled={busy() || !props.canRecover} onClick={() => void commit()}>{i18n.t('uiCopy.plugin.dataRecovery.restore')}</Button>
          </Show>
          <Show when={stage() === 'unresolved' || stage() === 'not_applied' || stage() === 'reconciling'}>
            <Show when={stage() === 'not_applied'}><Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} size="sm" variant="ghost" disabled={busy()} onClick={() => void loadSources()}>{i18n.t('uiCopy.plugin.dataRecovery.reviewAgain')}</Button></Show>
            <Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} size="sm" loading={stage() === 'reconciling'} disabled={busy()} onClick={() => void checkStatus()}>{i18n.t('uiCopy.plugin.dataRecovery.checkStatus')}</Button>
          </Show>
          <Show when={stage() === 'choose' && sources().length === 0 && error()}><Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} size="sm" onClick={() => void loadSources()}>{i18n.t('common.actions.retry')}</Button></Show>
          <Show when={stage() === 'disable_unknown'}><Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} size="sm" onClick={() => void checkDisabled()}>{i18n.t('uiCopy.plugin.dataRecovery.checkStatus')}</Button></Show>
          <Show when={stage() === 'complete' && refreshFailed()}><Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} size="sm" onClick={() => void refreshCompleted()}>{i18n.t('common.actions.refresh')}</Button></Show>
        </div>
      )}
    >
      <div class="space-y-4" data-plugin-data-recovery data-stage={stage()}>
        <p class="truncate text-sm font-medium">{props.item?.displayName}</p>
        <Show when={stage() === 'loading'}><div class="flex min-h-24 items-center justify-center" role="status" aria-label={i18n.t('uiCopy.plugin.dataRecovery.loading')}><Loader2 class="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" /></div></Show>
        <Show when={stage() === 'choose' || stage() === 'preparing'}>
          <Show when={sources().length > 0} fallback={<Show when={!error()}><p class="py-8 text-center text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.dataRecovery.empty')}</p></Show>}>
            <fieldset class="space-y-2" disabled={busy()}>
              <legend class="sr-only">{i18n.t('uiCopy.plugin.dataRecovery.choose')}</legend>
              <For each={sources()}>{(source) => (
                <label class="relative flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-3 transition-colors hover:bg-muted/40 has-[:checked]:border-primary/60 has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                  <input class="sr-only" type="radio" name={groupName} value={source.plugin_instance_id} checked={sourceID() === source.plugin_instance_id} onChange={() => setSourceID(source.plugin_instance_id)} />
                  <span class="min-w-0 flex-1"><span class="block text-sm font-medium">{date(source)}</span><span class="mt-1 block truncate font-mono text-xs text-muted-foreground" title={source.plugin_instance_id}>{source.plugin_instance_id.slice(-12)}</span></span>
                  <Show when={sourceID() === source.plugin_instance_id}><Check class="size-4 shrink-0 text-primary" aria-hidden="true" /></Show>
                </label>
              )}</For>
            </fieldset>
          </Show>
        </Show>
        <Show when={stage() === 'review' || stage() === 'committing' || stage() === 'unresolved' || stage() === 'not_applied' || stage() === 'reconciling'}>
          <Show when={inspection()}>{(plan) => <div class="rounded-lg border border-border bg-muted/20 p-4"><p class="text-sm font-medium">{date(plan().plan.source)}</p><p class="mt-2 text-sm leading-6 text-muted-foreground">{i18n.t('uiCopy.plugin.dataRecovery.preserveCurrent')}</p></div>}</Show>
        </Show>
        <Show when={stage() === 'complete'}><div class="flex items-center gap-3 py-6" role="status"><CheckCircle class="size-7 shrink-0 text-primary" /><div><p class="text-sm font-medium">{i18n.t('uiCopy.plugin.dataRecovery.complete')}</p><p class="mt-1 text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.dataRecovery.enableLater')}</p></div></div></Show>
        <Show when={error()}><p class="text-sm leading-6 text-destructive" role="alert">{error()}</p></Show>
        <Show when={refreshFailed()}><p class="text-sm text-muted-foreground" role="status">{i18n.t('uiCopy.plugin.dataRecovery.refreshFailed')}</p></Show>
      </div>
    </Dialog>
  );
}
