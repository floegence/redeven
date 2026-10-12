import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink } from '@floegence/floe-webapp-core/icons';
import { relationPageSize, summaryReferences, type RelationDetail, type RelationSummary } from './relations';
import type { CanvasNode, TessivenText } from './types';
import { FlowerIcon } from '../../flower_ui/src/icons/FlowerIcon';

/** Group summaries browse every original relation without growing graph geometry. */
export function TessivenRelationDetails(props: {
  scopeRefs: readonly string[];
  title?: string;
  summaries: readonly RelationSummary[];
  initialKey?: string;
  details: ReadonlyMap<string, RelationDetail>;
  nodes: readonly CanvasNode[];
  t: TessivenText;
  renderDetail: (id: string) => JSX.Element;
  onInspect: (event: MouseEvent, id: string) => boolean;
  onLocate: (id: string) => void;
  onAsk: (refs: string[]) => void;
  canAsk: (refs: string[]) => boolean;
}) {
  const [key, setKey] = createSignal(props.initialKey);
  const [query, setQuery] = createSignal('');
  const [node, setNode] = createSignal('');
  const [page, setPage] = createSignal(0);
  const [exact, setExact] = createSignal<string>();
  const summary = createMemo(() => props.summaries.find(item => item.key === key()));
  const nodeNames = createMemo(() => new Map(props.nodes.map(item => [item.id, item.name])));
  const poolNodes = createMemo(() => new Set(props.summaries.flatMap(item => item.nodeRefs)));
  const matching = (detail: RelationDetail) => (!node() || detail.nodeRefs.includes(node()))
    && (!query().trim() || detail.searchText.includes(query().trim().toLocaleLowerCase()));
  const patterns = createMemo(() => props.summaries.filter(item => item.relationRefs.some(ref => matching(props.details.get(ref)!))));
  const relations = createMemo(() => (summary()?.relationRefs ?? []).map(ref => props.details.get(ref)!).filter(matching));
  const count = () => summary() ? relations().length : patterns().length;
  const currentPage = () => Math.min(page(), Math.max(0, Math.ceil(count() / relationPageSize) - 1));
  const start = () => currentPage() * relationPageSize;
  const selected = () => exact() ? [exact()!] : summaryReferences(props.scopeRefs, summary());
  const resetPage = () => { setPage(0); setExact(undefined); };
  const openPattern = (item: RelationSummary) => { setKey(item.key); resetPage(); };
  const back = () => { if (exact()) setExact(undefined); else { setKey(undefined); resetPage(); } };
  const relationLabel = (detail: RelationDetail) => {
    const hosts = detail.nodeRefs.filter(ref => poolNodes().has(ref));
    return hosts.map(ref => nodeNames().get(ref) ?? ref).join(' → ');
  };
  return <div class="tessiven-relation-details">
    <div class="tessiven-relation-detail-heading">
      <Show when={summary() || exact()}><button type="button" onClick={back} aria-label={props.t('relationBack')}><ArrowLeft aria-hidden="true" /></button></Show>
      <strong>{summary() ? `${summary()!.from.label} → ${summary()!.to.label}` : props.title ?? props.t('poolRelations')}</strong>
    </div>
    <Show when={!exact()} fallback={<>
      <div class="tessiven-detail-content tessiven-relation-exact">{props.renderDetail(exact()!)}</div>
      <div class="tessiven-relation-locate">
        <For each={['from', 'to'] as const}>{side => <button type="button" onClick={() => props.onLocate(props.details.get(exact()!)!.relation[side])}>
          <ExternalLink aria-hidden="true" />{props.t(side === 'from' ? 'locateRelationSource' : 'locateRelationTarget')}
        </button>}</For>
      </div>
    </>}>
      <Show when={summary()}>{item => <div class="tessiven-relation-coverage">
        <span>{props.t(`relationLocality.${item().locality}`)}</span>
        <span>{props.t('relationCount', { count: item().relationRefs.length })}</span>
        <span>{props.t('nodeCount', { count: item().nodeRefs.length })}</span>
        <span>{item().protocol ?? props.t(`relation.${item().kind}`)}</span>
      </div>}</Show>
      <div class="tessiven-relation-filters">
        <input type="search" value={query()} placeholder={props.t('searchRelations')} aria-label={props.t('searchRelations')}
          onInput={event => { setQuery(event.currentTarget.value); resetPage(); }} />
        <select value={node()} aria-label={props.t('filterRelationNode')} onChange={event => { setNode(event.currentTarget.value); resetPage(); }}>
          <option value="">{props.t('allRelationNodes')}</option>
          <For each={props.nodes.filter(item => poolNodes().has(item.id))}>{item => <option value={item.id}>{item.name}</option>}</For>
        </select>
      </div>
      <div class="tessiven-relation-results" aria-label={props.t('relationResults')}>
        <Show when={count()} fallback={<p class="tessiven-muted">{props.t('noMatchingRelations')}</p>}>
          <Show when={summary()} fallback={<For each={patterns().slice(start(), start() + relationPageSize)}>{item =>
            <button type="button" class="tessiven-relation-detail-row" data-summary-key={item.key} onClick={() => openPattern(item)}>
              <strong>{item.from.label} → {item.to.label}</strong>
              <small>{item.protocol ?? props.t(`relation.${item.kind}`)} · {props.t(`relationLocality.${item.locality}`)} · {props.t('relationCount', { count: item.relationRefs.length })}</small>
              <ChevronRight aria-hidden="true" />
            </button>
          }</For>}>
            <For each={relations().slice(start(), start() + relationPageSize)}>{item =>
              <button type="button" class="tessiven-relation-detail-row" data-exact-relation-id={item.relation.id}
                onClick={event => { if (!props.onInspect(event, item.relation.id)) setExact(item.relation.id); }}>
                <strong>{relationLabel(item) || `${item.from.label} → ${item.to.label}`}</strong>
                <small>{item.relation.from} → {item.relation.to}</small>
                <ChevronRight aria-hidden="true" />
              </button>
            }</For>
          </Show>
        </Show>
      </div>
      <nav class="tessiven-relation-pagination" aria-label={props.t('relationPages')}>
        <span>{props.t('relationResultRange', { start: count() ? start() + 1 : 0, end: Math.min(start() + relationPageSize, count()), count: count() })}</span>
        <button type="button" disabled={currentPage() === 0} onClick={() => setPage(currentPage() - 1)} aria-label={props.t('previousRelationPage')}><ChevronLeft aria-hidden="true" /></button>
        <button type="button" disabled={start() + relationPageSize >= count()} onClick={() => setPage(currentPage() + 1)} aria-label={props.t('nextRelationPage')}><ChevronRight aria-hidden="true" /></button>
      </nav>
    </Show>
    <button type="button" class="tessiven-ask-flower" disabled={!props.canAsk(selected())} onClick={() => props.onAsk(selected())}>
      <span class="tessiven-ask-flower-mark" aria-hidden="true"><FlowerIcon /></span>{props.t('askFlower')}
    </button>
  </div>;
}
