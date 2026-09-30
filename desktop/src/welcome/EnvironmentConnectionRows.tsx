import { Dynamic } from 'solid-js/web';
import { For, Show, createMemo, createSignal, createUniqueId, onCleanup } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { Check, ChevronRight, Copy, ExternalLink, HelpIcon, Search, ShareIcon, X } from '@floegence/floe-webapp-core/icons';
import { isShareableConnectionAddress, type AddressRecoveryTarget, type DesktopConnectionAddress, type DesktopConnectionRow } from '../shared/desktopEnvironmentConnection';
import type { DesktopI18n } from '../shared/i18n';
import { DesktopTooltip } from './DesktopTooltip';

type ConnectionActions = Readonly<{
  i18n: DesktopI18n;
  selectedID?: string;
  configureAddress?: (target: AddressRecoveryTarget) => void;
  selectForShare: (id: string) => void;
  openInBrowser: (url: string) => Promise<void>;
  copyEnvironmentValue: (value: string, label: string) => Promise<void>;
}>;

type ConnectionPresentation = 'full' | 'settings-summary';

const ADDRESS_SCOPES = ['this_device', 'network', 'environment_only'] as const;

/** Both connection surfaces own the same grouping, filtering and address actions. */
export function EnvironmentConnectionRows(props: ConnectionActions & Readonly<{
  environmentID: string;
  rows: readonly DesktopConnectionRow[];
  presentation?: ConnectionPresentation;
}>) {
  // Only a different Environment resets interaction state; snapshots and labels do not.
  return <Show when={props.environmentID} keyed>{(_environmentID) => {
    const facts = createMemo(() => props.rows.filter(row => row.kind !== 'address'));
    const factIDs = createMemo(() => facts().map(row => row.id));
    const factsByID = createMemo(() => new Map(facts().map(row => [row.id, row])));
    const groups = createMemo(() => new Map(ADDRESS_SCOPES.map(scope => [scope,
      props.rows.filter((row): row is DesktopConnectionAddress => row.kind === 'address' && row.access_scope === scope),
    ])));
    const scopes = createMemo(() => ADDRESS_SCOPES.filter(scope => groups().get(scope)!.length > 0));
    return <>
      <For each={factIDs()}>{id => <ConnectionRow {...props} row={factsByID().get(id)!} />}</For>
      <For each={scopes()}>{scope => <ConnectionAddressGroup {...props} rows={groups().get(scope)!}
        compact={props.presentation === 'settings-summary'} />}</For>
    </>;
  }}</Show>;
}

function ConnectionAddressGroup(props: ConnectionActions & Readonly<{
  rows: readonly DesktopConnectionAddress[];
  compact?: boolean;
}>) {
  const headingID = createUniqueId();
  const helpLabelID = createUniqueId();
  const helpDescriptionID = createUniqueId();
  const [query, setQuery] = createSignal('');
  // Once offered, filtering stays mounted even if a refresh reduces the address count.
  const searchable = createMemo<boolean>(previous => previous || props.rows.length > 6, false);
  const term = createMemo(() => query().trim().toLowerCase());
  const rowsByID = createMemo(() => new Map(props.rows.map(row => [row.id, row])));
  const visibleIDs = createMemo(() => props.rows.filter(row => row.value.toLowerCase().includes(term())).map(row => row.id));
  let filter: HTMLInputElement | undefined;
  let viewport: HTMLDivElement | undefined;
  const changeQuery = (value: string) => {
    setQuery(value);
    // Explicit filtering starts a new result view. A Runtime refresh never resets scroll.
    if (viewport) viewport.scrollTop = 0;
  };
  const countLabel = () => term()
    ? props.i18n.t('environmentConnection.filteredAddressCount', { shown: props.i18n.formatNumber(visibleIDs().length), total: props.i18n.formatNumber(props.rows.length) })
    : props.i18n.tn('environmentConnection.addressCount', props.rows.length);
  const list = <div class="redeven-address-list">
    <Show when={searchable()}>
      <div class="redeven-address-filter" data-floe-input-surface>
        <Search class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <input ref={filter} type="search" value={query()} aria-label={props.i18n.t('environmentConnection.filterAddresses')}
          placeholder={props.i18n.t('environmentConnection.filterAddresses')} spellcheck={false}
          onInput={event => changeQuery(event.currentTarget.value)} />
        <Show when={query()}><button type="button" aria-label={props.i18n.t('environmentConnection.clearAddressFilter')}
          onClick={() => { changeQuery(''); filter?.focus(); }}><X class="h-3.5 w-3.5" /></button></Show>
      </div>
    </Show>
    <div ref={viewport} class="redeven-address-viewport" role="region" aria-labelledby={headingID} tabIndex={0}>
      <table class="redeven-address-table" aria-labelledby={headingID}>
        <thead><tr>
          <th scope="col" colSpan={props.rows[0].access_scope === 'environment_only' ? 2 : 1}>{props.i18n.t('environmentFacts.url')}</th>
          <Show when={props.rows[0].access_scope !== 'environment_only'}><th scope="col">{props.i18n.t('environmentConnection.addressActions')}</th></Show>
        </tr></thead>
        <tbody>
          <For each={visibleIDs()} fallback={<tr><td colSpan={2}><p class="redeven-address-empty" role="status">{props.i18n.t('environmentConnection.noMatchingAddresses')}</p></td></tr>}>
            {id => <ConnectionRow {...props} row={rowsByID().get(id)!} />}
          </For>
        </tbody>
      </table>
    </div>
  </div>;
  const title = () => (<div class="redeven-address-title">
    <span id={headingID} class="redeven-card-endpoint-label">{props.i18n.t(props.rows[0].label_key)}</span>
    <Show when={props.rows[0].access_scope !== 'environment_only'}>
      <DesktopTooltip content={props.i18n.t(props.rows[0].detail_key, props.rows[0].detail_params)} placement="top"
        anchorClass="redeven-address-help-anchor" class="redeven-address-help-tooltip">
        <Button type="button" size="sm" variant="ghost" class="redeven-address-help"
          aria-labelledby={`${headingID} ${helpLabelID}`} aria-describedby={helpDescriptionID}
          onClick={event => event.preventDefault()}>
          <HelpIcon class="h-3.5 w-3.5" aria-hidden="true" />
          <span id={helpLabelID} class="sr-only">{props.i18n.t('common.moreInformation')}</span>
        </Button>
      </DesktopTooltip>
      <span id={helpDescriptionID} class="sr-only">{props.i18n.t(props.rows[0].detail_key, props.rows[0].detail_params)}</span>
    </Show>
  </div>);
  return <Show when={props.rows[0]}>{first => props.compact && first().access_scope !== 'environment_only' ? (
    <details class="redeven-address-group redeven-address-group--summary" data-address-scope={first().access_scope}>
      <summary class="redeven-address-heading redeven-address-summary">
        {title()}
        <span class="redeven-address-summary-meta">
          <span class="redeven-address-count" aria-label={countLabel()}>{term() ? `${props.i18n.formatNumber(visibleIDs().length)} / ${props.i18n.formatNumber(props.rows.length)}` : props.i18n.formatNumber(props.rows.length)}</span>
          <ChevronRight class="h-3.5 w-3.5 redeven-address-summary-chevron" aria-hidden="true" />
        </span>
      </summary>
      <div class="redeven-address-summary-content">
        {list}
      </div>
    </details>
  ) : (<section class="redeven-address-group" data-address-scope={first().access_scope}>
    <div class="redeven-address-heading">
      {title()}
      <Show when={props.rows.length > 1 || term()}><span class="redeven-address-count" aria-label={countLabel()} title={countLabel()}>
        {term() ? `${props.i18n.formatNumber(visibleIDs().length)} / ${props.i18n.formatNumber(props.rows.length)}` : props.i18n.formatNumber(props.rows.length)}
      </span></Show>
    </div>
    <Show when={first().access_scope === 'environment_only'} fallback={list}>
      <div class="redeven-address-restricted">
        <span class="redeven-endpoint-scope-title">{props.i18n.t(first().detail_key, first().detail_params)}</span>
        <p class="redeven-card-endpoint-detail">{props.i18n.t('environmentConnection.openViaDesktop', { action: props.i18n.t('environmentAction.open') })}</p>
        <details class="redeven-endpoint-listener">
          <summary><ChevronRight class="h-3 w-3" aria-hidden="true" />{props.i18n.t('environmentConnection.listenerDetails')}</summary>
          <div class="redeven-endpoint-listener-content">
            {list}
            <p>{props.i18n.t('environmentConnection.loopbackHelp', first().detail_params)}</p>
          </div>
        </details>
      </div>
    </Show>
  </section>)}</Show>;
}

function ConnectionRow(props: ConnectionActions & Readonly<{ row: DesktopConnectionRow }>) {
  const valueID = createUniqueId();
  const row = () => props.row;
  const recovery = () => { const value = row(); return value.kind === 'status' ? value.recovery : undefined; };
  const address = () => row().kind === 'address';
  const copyable = () => { const value = row(); return value.kind !== 'status' && value.copyable; };
  const browserOpenable = () => { const value = row(); return value.kind === 'address' && value.browser_openable; };
  const [copiedValue, setCopiedValue] = createSignal<string | null>(null);
  const copied = () => copiedValue() === row().value;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(resetTimer));
  const copyLabel = () => address() ? props.i18n.t('environmentFacts.copyEnvironmentUrl')
    : props.i18n.t('environmentFacts.copyFact', { label: props.i18n.t(row().label_key) });
  const copy = async () => {
    const value = row().value;
    await props.copyEnvironmentValue(value, props.i18n.t(address() ? 'environmentFacts.environmentUrl' : row().label_key));
    setCopiedValue(value);
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => setCopiedValue(null), 1500);
  };
  return <Dynamic component={address() ? 'tr' : 'div'} class="redeven-card-endpoint-row" data-endpoint-id={row().id} data-endpoint-kind={row().kind} data-address-diagnostic={row().id.startsWith('address-issue:') || undefined}
    data-selected={row().id === props.selectedID ? '' : undefined} role={row().kind === 'status' ? 'status' : undefined}>
    <Show when={!address()}><span class="redeven-card-endpoint-label">{props.i18n.t(row().label_key)}</span></Show>
    <Dynamic component={address() ? 'td' : 'div'} class="redeven-card-endpoint-content min-w-0 select-text">
      <span id={valueID} class="redeven-card-endpoint-value" title={row().value || undefined}>{row().value_key ? props.i18n.t(row().value_key!) : row().value}</span>
      <Show when={address() ? undefined : row().detail_key}>{key => <span class="redeven-card-endpoint-detail">{props.i18n.t(key(), row().detail_params)}</span>}</Show>
    </Dynamic>
    <Dynamic component={address() ? 'td' : 'div'} class="redeven-endpoint-action-cell">
      <div class="redeven-endpoint-actions">
        <Show when={props.configureAddress && recovery()}>{target => (
          <Button size="sm" variant="outline" aria-describedby={valueID} onClick={() => props.configureAddress?.(target())}>
            {props.i18n.t(target() === 'certificate' ? 'settings.certificateManage' : 'accessFlow.changeAccess')}
          </Button>
        )}</Show>
        <Show when={copyable()}>
          <Button size="sm" variant="ghost" class="redeven-copy-action" classList={{ 'redeven-endpoint-action': address() }} data-icon-only aria-describedby={valueID} aria-label={copyLabel()}
            title={copied() ? props.i18n.t('environmentCenter.copied') : copyLabel()} data-copied={copied() || undefined}
            onClick={() => void copy()}>{copied() ? <Check class="h-3.5 w-3.5" /> : <Copy class="h-3.5 w-3.5" />}</Button>
        </Show>
        <Show when={browserOpenable()}>
          <Button size="sm" variant="ghost" class="redeven-endpoint-action shrink-0" aria-describedby={valueID}
            aria-label={props.i18n.t('webServiceBrowser.openInBrowser')} title={props.i18n.t('webServiceBrowser.openInBrowser')}
            onClick={() => void props.openInBrowser(row().value)}><ExternalLink class="h-3.5 w-3.5" /></Button>
        </Show>
        <Show when={isShareableConnectionAddress(row())}>
          <Button size="sm" variant="ghost" class="redeven-endpoint-action shrink-0" aria-describedby={valueID}
            aria-label={props.i18n.t('settings.shareConnection')} title={props.i18n.t('settings.shareConnection')}
            aria-expanded={row().id === props.selectedID} onClick={() => props.selectForShare(row().id === props.selectedID ? '' : row().id)}>
            <ShareIcon class="h-3.5 w-3.5" />
          </Button>
        </Show>
      </div>
    </Dynamic>
  </Dynamic>;
}
