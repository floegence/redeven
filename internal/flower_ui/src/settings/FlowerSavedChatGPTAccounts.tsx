import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { FlowerChatGPTAccount, FlowerSurfaceAdapter } from '../contracts/flowerSurfaceContracts';
import type { FlowerProviderDialogCopy } from '../copy';

export function FlowerSavedChatGPTAccounts(props: Readonly<{
  enabled: boolean;
  bindingID?: string;
  refreshKey: boolean;
  load?: FlowerSurfaceAdapter['loadChatGPTAccounts'];
  boundAccountIDs: readonly string[];
  copy: FlowerProviderDialogCopy['chatGPT'];
  disabled?: boolean;
  onContinue: (account: FlowerChatGPTAccount) => void;
}>) {
  const [accounts, setAccounts] = createSignal<readonly FlowerChatGPTAccount[]>([]);
  const [error, setError] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  let sequence = 0;
  onCleanup(() => { sequence++; });
  const refresh = async () => {
    const load = props.load;
    if (!props.enabled || !load) return;
    const current = ++sequence, binding = props.bindingID;
    setLoading(true); setError(false);
    try {
      const result = await load();
      if (current === sequence && props.enabled && binding === props.bindingID) setAccounts(result.saved_accounts);
    } catch {
      if (current === sequence && props.enabled) setError(true);
    } finally { if (current === sequence) setLoading(false); }
  };
  createEffect(on(() => [props.enabled, props.bindingID, props.refreshKey] as const, (next, previous) => {
    sequence++;
    if (!previous || next[0] !== previous[0] || next[1] !== previous[1]) setAccounts([]);
    setError(false); setLoading(false);
    if (!props.refreshKey) void refresh();
  }));
  const accountsByID = createMemo(() => new Map(accounts().map(account => [account.account_id, account])));
  const unboundIDs = () => accounts().filter(account => !props.boundAccountIDs.includes(account.account_id)).map(account => account.account_id);
  return <Show when={props.enabled && (unboundIDs().length > 0 || error())}>
    <section class="flower-saved-accounts" aria-label={props.copy.savedAccounts}>
      <h3>{props.copy.savedAccounts}</h3>
      <For each={unboundIDs()}>{id => {
        const account = () => accountsByID().get(id)!;
        return <div class="flower-saved-account" data-flower-saved-account={id}>
        <div class="min-w-0"><p class="break-words font-medium">{account().email || props.copy.account}</p><p class="flower-body-copy text-muted-foreground">{account().state === 'ready' || account().state === 'plan_permission_required' ? props.copy.unboundSignIn : props.copy.authorizationRequired}</p></div>
        <Button size="sm" variant="outline" disabled={props.disabled} onClick={() => props.onContinue(account())}>{props.copy.continueSetup}</Button>
      </div>; }}</For>
      <Show when={error()}><div role="alert" class="flower-provider-account-error flex flex-wrap items-center gap-3"><p>{props.copy.accountsUnavailable}</p><Button size="sm" variant="outline" disabled={loading()} onClick={() => void refresh()}>{props.copy.retry}</Button></div></Show>
    </section>
  </Show>;
}
