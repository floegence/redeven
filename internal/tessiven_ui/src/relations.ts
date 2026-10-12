import type { Instance, Relation, RenderModel } from './types';

export type RelationLocality = 'local' | 'cross-node' | 'logical';
export type RelationEndpoint = {
  ref: string;
  canonicalRef: string;
  label: string;
  granularity: 'instance' | 'service' | 'node' | 'group' | 'resource' | 'object' | 'unknown';
  serviceRef?: string;
  nodeRefs: readonly string[];
};
export type RelationDetail = {
  relation: Relation;
  from: RelationEndpoint;
  to: RelationEndpoint;
  locality: RelationLocality;
  nodeRefs: readonly string[];
  searchText: string;
};
export type RelationSummary = {
  key: string;
  from: RelationEndpoint;
  to: RelationEndpoint;
  kind: string;
  protocol?: string;
  locality: RelationLocality;
  relationRefs: readonly string[];
  nodeRefs: readonly string[];
};

export const relationPreviewLimit = 4;
export const relationPageSize = 50;
export const relationSectionHeight = (count: number, more = false) => count ? 36 + count * 30 + (more ? 28 : 0) : 0;

/** One canonical endpoint index serves projection, summaries, and exact details. */
export function createRelationIndex(model: RenderModel) {
  const instances = new Map((model.instances ?? []).map(instance => [instance.id, instance]));
  const hosted = new Map<string, Instance[]>();
  for (const instance of instances.values()) {
    const members = hosted.get(instance.serviceRef) ?? [];
    members.push(instance);
    hosted.set(instance.serviceRef, members);
  }
  const names = new Map<string, string>();
  const kinds = new Map<string, RelationEndpoint['granularity']>();
  for (const [kind, values] of [
    ['node', model.nodes], ['service', model.services], ['group', model.groups],
    ['resource', model.resources], ['object', model.objects],
  ] as const) for (const value of values ?? []) { names.set(value.id, value.name); kinds.set(value.id, kind); }
  const endpoints = new Map<string, RelationEndpoint>();
  const endpoint = (ref: string): RelationEndpoint => {
    let value = endpoints.get(ref);
    if (value) return value;
    const instance = instances.get(ref);
    const granularity = instance ? 'instance' : kinds.get(ref) ?? 'unknown';
    const serviceRef = instance?.serviceRef ?? (granularity === 'service' ? ref : undefined);
    const nodeRefs = instance ? [instance.nodeRef] : granularity === 'node' ? [ref]
      : serviceRef ? [...new Set((hosted.get(serviceRef) ?? []).map(member => member.nodeRef))] : [];
    value = { ref, canonicalRef: serviceRef ?? ref, label: names.get(serviceRef ?? ref) ?? ref,
      granularity, serviceRef, nodeRefs };
    endpoints.set(ref, value);
    return value;
  };
  const details = new Map<string, RelationDetail>();
  for (const relation of model.relations ?? []) {
    const from = endpoint(relation.from), to = endpoint(relation.to);
    const exact = (value: RelationEndpoint) => value.granularity === 'instance' || value.granularity === 'node';
    const locality = exact(from) && exact(to)
      ? from.nodeRefs[0] === to.nodeRefs[0] ? 'local' : 'cross-node' : 'logical';
    const nodeRefs = [...new Set([...from.nodeRefs, ...to.nodeRefs])];
    details.set(relation.id, { relation, from, to, locality, nodeRefs,
      searchText: [relation.id, relation.from, relation.to, from.label, to.label, relation.kind, relation.protocol,
        ...nodeRefs.flatMap(ref => [ref, names.get(ref)])].filter(Boolean).join(' ').toLocaleLowerCase() });
  }
  const shared = new Map<string, readonly string[]>();
  const sharedHosts = (detail: RelationDetail) => {
    const key = JSON.stringify([detail.from.ref, detail.to.ref]);
    let value = shared.get(key);
    if (!value) {
      const targets = new Set(detail.to.nodeRefs);
      value = detail.from.nodeRefs.filter(ref => targets.has(ref));
      shared.set(key, value);
    }
    return value;
  };
  return { details, endpoint, sharedHosts };
}

export function summarizeRelations(details: Iterable<RelationDetail>, nodeScope: ReadonlySet<string>): RelationSummary[] {
  const patterns = new Map<string, { summary: RelationSummary; refs: Set<string>; nodes: Set<string> }>();
  for (const detail of details) {
    const { relation, from, to, locality } = detail;
    const key = JSON.stringify([from.canonicalRef, to.canonicalRef, from.granularity, to.granularity, relation.kind, relation.protocol ?? null, locality]);
    let pattern = patterns.get(key);
    if (!pattern) {
      pattern = { summary: { key, from, to, kind: relation.kind, protocol: relation.protocol, locality, relationRefs: [], nodeRefs: [] }, refs: new Set(), nodes: new Set() };
      patterns.set(key, pattern);
    }
    pattern.refs.add(relation.id);
    for (const ref of detail.nodeRefs) if (nodeScope.has(ref)) pattern.nodes.add(ref);
  }
  return [...patterns.values()].map(({ summary, refs, nodes }) => ({ ...summary, relationRefs: [...refs], nodeRefs: [...nodes] }));
}

export function summaryReferences(scopeRefs: string | readonly string[], summary?: RelationSummary): string[] {
  return [...new Set([...(typeof scopeRefs === 'string' ? [scopeRefs] : scopeRefs), ...(summary ? [summary.from.canonicalRef, summary.to.canonicalRef] : [])])];
}
