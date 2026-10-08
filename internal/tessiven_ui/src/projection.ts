import type {
  GraphInput,
  GraphNode,
  GraphEdge,
} from '@floegence/floe-webapp-core/graph';
import type {
  CanvasDocument,
  CanvasNode,
  Group,
  Instance,
  Relation,
  Resource,
  BusinessService,
} from './types';

export type Card =
  | {
      kind: 'group';
      group: Group;
      nodes: CanvasNode[];
      expanded: boolean;
      aggregated: boolean;
      selectedNode?: string;
      instances: Instance[];
    }
  | { kind: 'node'; node: CanvasNode; instances: Instance[]; group?: Group; groupInstances: Instance[] }
  | { kind: 'resource'; resource: Resource }
  | { kind: 'service'; service: BusinessService; instanceCount: number };
export type Projection = {
  graph: GraphInput;
  cards: Map<string, Card>;
  relations: Map<string, Relation[]>;
  appearances: Map<string, string[]>;
  memberships: Map<string, Group[]>;
  instanceMemberships: Map<string, Group[]>;
};

// Rendering identities are derived from stable DSL IDs. Grouping never changes
// the stored graph or turns a group into a service-operation target.
export function projectCanvas(
  document: CanvasDocument,
  expanded: ReadonlySet<string>,
  selectedNodes: Readonly<Record<string, string>>,
): Projection {
  const nodes: GraphNode[] = [],
    cards = new Map<string, Card>(),
    relationGroups = new Map<string, Relation[]>();
  const memberships = new Map<string, Group[]>(),
    appearances = new Map<string, string[]>(),
    instanceGroups = new Map<string, Group[]>();
  const hosts = new Map((document.nodes ?? []).map((node) => [node.id, node]));
  const instances = document.instances ?? [];
  const byNode = new Map<string, Instance[]>();
  const byID = new Map(instances.map((instance) => [instance.id, instance]));
  for (const instance of instances) {
    const list = byNode.get(instance.nodeRef) ?? [];
    list.push(instance);
    byNode.set(instance.nodeRef, list);
  }
  const groups = document.groups ?? [];
  const groupInstances = new Map<string, Instance[]>();
  for (const group of groups) {
    for (const id of group.nodeRefs) {
      const member = memberships.get(id) ?? [];
      member.push(group);
      memberships.set(id, member);
    }
    const members = group.instanceRefs
      ? group.instanceRefs.flatMap(id => byID.has(id) ? [byID.get(id)!] : [])
      : group.nodeRefs.flatMap(id => byNode.get(id) ?? []);
    groupInstances.set(group.id, members);
    for (const instance of members) {
      const member = instanceGroups.get(instance.id) ?? [];
      member.push(group);
      instanceGroups.set(instance.id, member);
    }
  }
  // DSL identities remain canonical. Only repeated host views need a distinct
  // renderer ID; its separator cannot collide with a schema-valid object ID.
  const viewID = (id: string, group?: Group) =>
    group && (memberships.get(id)?.length ?? 0) > 1 ? `${group.id}::${id}` : id;
  const addHost = (node: CanvasNode, group?: Group) => {
    const hosted = byNode.get(node.id) ?? [];
    const serviceCount = new Set(hosted.map((instance) => instance.serviceRef))
      .size;
    nodes.push({
      id: viewID(node.id, group),
      label: node.name,
      parentId: group?.id,
      width: 280,
      height: 116 + serviceCount * 49,
    });
    const id = viewID(node.id, group);
    cards.set(id, { kind: 'node', node, instances: hosted, group, groupInstances: group ? groupInstances.get(group.id)! : [] });
    const views = appearances.get(node.id) ?? [];
    views.push(id);
    appearances.set(node.id, views);
  };
  for (const group of document.groups ?? []) {
    const members = group.nodeRefs.flatMap((id) =>
      hosts.has(id) ? [hosts.get(id)!] : [],
    );
    const open = expanded.has(group.id),
      aggregated = members.length > 15;
    const selectedNode = members.some(
      (node) => node.id === selectedNodes[group.id],
    )
      ? selectedNodes[group.id]
      : members[0]?.id;
    const selectedMembers = aggregated
      ? members.filter((node) => node.id === selectedNode)
      : members;
    const groupedInstances = groupInstances.get(group.id)!;
    const serviceIDs = new Set(
      groupedInstances.map((instance) => instance.serviceRef),
    );
    nodes.push({
      id: group.id,
      label: group.name,
      kind: open && members.length ? 'group' : 'node',
      width: 320,
      height: 106 + Math.min(serviceIDs.size, 8) * 45,
    });
    cards.set(group.id, {
      kind: 'group',
      group,
      nodes: members,
      expanded: open,
      aggregated,
      selectedNode,
      instances: groupedInstances,
    });
    if (open) for (const node of selectedMembers) addHost(node, group);
  }
  for (const node of hosts.values())
    if (!memberships.has(node.id)) addHost(node);
  for (const resource of document.resources ?? []) {
    nodes.push({
      id: resource.id,
      label: resource.name,
      width: 220,
      height: 158,
    });
    cards.set(resource.id, { kind: 'resource', resource });
  }
  const serviceTargets = new Map<string, Set<string>>();
  const serviceCounts = new Map<string, number>();
  const instanceTargets = (instance: Instance, detailed: boolean): string[] => {
    const owners = instanceGroups.get(instance.id) ?? [];
    if (owners.length) return owners.map(group => {
      const id = viewID(instance.nodeRef, group);
      return detailed && cards.has(id) ? id : group.id;
    });
    const owner = memberships.get(instance.nodeRef)?.[0];
    const view = appearances.get(instance.nodeRef)?.[0];
    return [detailed && view ? view : owner?.id ?? instance.nodeRef];
  };
  for (const instance of instances) {
    serviceCounts.set(
      instance.serviceRef,
      (serviceCounts.get(instance.serviceRef) ?? 0) + 1,
    );
    if (!serviceTargets.has(instance.serviceRef))
      serviceTargets.set(instance.serviceRef, new Set());
    for (const target of instanceTargets(instance, false)) serviceTargets.get(instance.serviceRef)!.add(target);
  }
  for (const service of document.services ?? [])
    if (
      !serviceTargets.has(service.id) ||
      serviceTargets.get(service.id)!.size > 15
    ) {
      // A widely distributed logical service is one relationship endpoint.
      // Its host rows stay visible; expanding every host-to-host pair would
      // invent instance-level observations and produce quadratic edge counts.
      nodes.push({
        id: service.id,
        label: service.name,
        width: 240,
        height: 90,
      });
      cards.set(service.id, {
        kind: 'service',
        service,
        instanceCount: serviceCounts.get(service.id) ?? 0,
      });
      serviceTargets.set(service.id, new Set([service.id]));
    }
  const endpoints = (id: string): string[] => {
    if (serviceTargets.has(id)) return [...serviceTargets.get(id)!];
    const instance = byID.get(id);
    if (instance) return [...new Set(instanceTargets(instance, true))];
    if (hosts.has(id) && memberships.has(id))
      return memberships.get(id)!.map(group => {
        const view = viewID(id, group);
        return cards.has(view) ? view : group.id;
      });
    return [id];
  };
  const edges: GraphEdge[] = [];
  for (const relation of document.relations ?? [])
    for (const source of endpoints(relation.from))
      for (const target of endpoints(relation.to)) {
        const key = `${source}/${target}`;
        if (!relationGroups.has(key)) {
          relationGroups.set(key, []);
          edges.push({ id: key, source, target, label: relation.kind });
        }
        relationGroups.get(key)!.push(relation);
      }
  for (const edge of edges) {
    const values = relationGroups.get(edge.id)!;
    edge.label =
      values.length > 1
        ? String(values.length)
        : (values[0]?.protocol ?? values[0]?.kind);
  }
  const order = new Map(
    (document.presentation?.order ?? []).map((id, index) => [id, index]),
  );
  if (order.size)
    nodes.sort(
      (a, b) => {
        const rank = (id: string) => {
          const card = cards.get(id);
          return order.get(card?.kind === 'node' ? card.node.id : id) ?? Infinity;
        };
        return rank(a.id) - rank(b.id);
      },
    );
  return { graph: { nodes, edges }, cards, relations: relationGroups, appearances, memberships, instanceMemberships: instanceGroups };
}

export function projectPositions(document: CanvasDocument, projection: Projection) {
  const visible = new Set(projection.graph.nodes.map(node => node.id));
  return (document.presentation?.positions ?? []).flatMap(position => {
    const nodeId = projection.appearances.get(position.objectRef)?.[0] ?? position.objectRef;
    return visible.has(nodeId) ? [{ nodeId, x: position.x, y: position.y }] : [];
  });
}

export type Difference = {
  id: string;
  kind: string;
  change: 'added' | 'removed' | 'changed';
};
export function compareDocuments(
  before: CanvasDocument,
  after: CanvasDocument,
): Difference[] {
  const output: Difference[] = [];
  for (const kind of [
    'nodes',
    'groups',
    'services',
    'instances',
    'resources',
    'relations',
    'evidence',
  ] as const) {
    const old = new Map((before[kind] ?? []).map((value) => [value.id, value]));
    const next = new Map((after[kind] ?? []).map((value) => [value.id, value]));
    for (const [id, value] of next) {
      if (!old.has(id)) output.push({ id, kind, change: 'added' });
      else if (JSON.stringify(old.get(id)) !== JSON.stringify(value))
        output.push({ id, kind, change: 'changed' });
    }
    for (const id of old.keys())
      if (!next.has(id)) output.push({ id, kind, change: 'removed' });
  }
  for (const kind of ['metadata', 'presentation'] as const)
    if (JSON.stringify(before[kind]) !== JSON.stringify(after[kind]))
      output.push({ id: kind, kind, change: 'changed' });
  return output;
}
