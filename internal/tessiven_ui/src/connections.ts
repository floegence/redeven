import type { GraphEdge } from '@floegence/floe-webapp-core/graph';
import type { Projection } from './projection';
import type { RelationEndpoint } from './relations';
import type { Relation } from './types';

/** Display edges retain authored relations; neither overview nor focus invents observations. */
export type ConnectionProjection = {
  edges: GraphEdge[];
  relations: Map<string, Relation[]>;
};

function collector(prefix: string) {
  const edges: GraphEdge[] = [], relations = new Map<string, Relation[]>(), seen = new Map<string, Set<string>>();
  return {
    add(source: string, target: string, relation: Relation) {
      const id = `@${prefix}/${source}/${target}`;
      let refs = seen.get(id);
      if (!refs) {
        refs = new Set(); seen.set(id, refs); relations.set(id, []);
        edges.push({ id, source, target, label: '' });
      }
      if (!refs.has(relation.id)) { refs.add(relation.id); relations.get(id)!.push(relation); }
    },
    result(): ConnectionProjection {
      for (const edge of edges) {
        const values = relations.get(edge.id)!;
        edge.label = values.length > 1 ? String(values.length) : values[0].protocol ?? values[0].kind;
      }
      return { edges, relations };
    },
  };
}

export function projectOverviewConnections(projection: Projection): ConnectionProjection {
  const nodes = new Map(projection.graph.nodes.map(node => [node.id, node]));
  const root = (id: string): string => {
    let value = nodes.get(id)!;
    while (value.parentId) value = nodes.get(value.parentId)!;
    return value.id;
  };
  const output = collector('overview');
  for (const edge of projection.graph.edges) {
    const source = root(edge.source), target = root(edge.target);
    if (source === target && projection.cards.get(source)?.kind === 'group') continue;
    for (const relation of projection.relations.get(edge.id)!) output.add(source, target, relation);
  }
  return output.result();
}

export function projectNodeConnections(projection: Projection, viewId: string): ConnectionProjection {
  const card = projection.cards.get(viewId), output = collector('detail');
  if (card?.kind !== 'node') return output.result();
  const physical = (endpoint: RelationEndpoint) => endpoint.granularity === 'node' || endpoint.granularity === 'instance';
  const targets = (endpoint: RelationEndpoint): readonly string[] => {
    if (endpoint.granularity === 'service') return [...(projection.serviceTargets.get(endpoint.ref) ?? [])];
    if (!physical(endpoint)) return projection.cards.has(endpoint.ref) ? [endpoint.ref] : [];
    const nodeId = endpoint.nodeRefs[0];
    const groups = (endpoint.granularity === 'instance' ? projection.instanceMemberships.get(endpoint.ref) : undefined)
      ?? projection.memberships.get(nodeId) ?? [];
    const group = groups.find(value => value.id === card.group?.id) ?? groups[0];
    const appearance = projection.appearances.get(nodeId)?.find(id => {
      const value = projection.cards.get(id);
      return value?.kind === 'node' && value.group?.id === group?.id;
    });
    // A hidden member of this same pool belongs in the pool detail browser,
    // never in an external connector to the node's own enclosing border.
    if (!appearance && group?.id === card.group?.id && group) return [];
    return appearance ? [appearance] : group ? [group.id] : [];
  };
  for (const detail of projection.nodeRelations.get(card.node.id) ?? []) {
    if (physical(detail.from) && physical(detail.to) && detail.from.nodeRefs[0] === detail.to.nodeRefs[0]) continue;
    if (detail.from.nodeRefs.includes(card.node.id))
      for (const target of targets(detail.to))
        if (target !== viewId && target !== card.group?.id) output.add(viewId, target, detail.relation);
    if (detail.to.nodeRefs.includes(card.node.id))
      for (const source of targets(detail.from))
        if (source !== viewId && source !== card.group?.id) output.add(source, viewId, detail.relation);
  }
  return output.result();
}
