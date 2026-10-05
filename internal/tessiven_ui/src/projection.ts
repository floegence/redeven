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
  | { kind: 'node'; node: CanvasNode; instances: Instance[] }
  | { kind: 'resource'; resource: Resource }
  | { kind: 'service'; service: BusinessService; instanceCount: number };
export type Projection = {
  graph: GraphInput;
  cards: Map<string, Card>;
  relations: Map<string, Relation[]>;
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
  const nodeOwners = new Map<string, string>(),
    visibleHosts = new Set<string>();
  const hosts = new Map((document.nodes ?? []).map((node) => [node.id, node]));
  const instances = document.instances ?? [];
  const byNode = new Map<string, Instance[]>();
  const byID = new Map(instances.map((instance) => [instance.id, instance]));
  for (const instance of instances) {
    const list = byNode.get(instance.nodeRef) ?? [];
    list.push(instance);
    byNode.set(instance.nodeRef, list);
  }
  const addHost = (node: CanvasNode, parentId?: string) => {
    const hosted = byNode.get(node.id) ?? [];
    const serviceCount = new Set(hosted.map((instance) => instance.serviceRef))
      .size;
    nodes.push({
      id: node.id,
      label: node.name,
      parentId,
      width: 280,
      height:
        116 + Math.min(serviceCount, 12) * 49 + (serviceCount > 12 ? 32 : 0),
    });
    cards.set(node.id, { kind: 'node', node, instances: hosted });
    visibleHosts.add(node.id);
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
    const groupedInstances = group.nodeRefs.flatMap(
      (id) => byNode.get(id) ?? [],
    );
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
    for (const node of members) nodeOwners.set(node.id, group.id);
    if (open) for (const node of selectedMembers) addHost(node, group.id);
  }
  for (const node of hosts.values())
    if (!nodeOwners.has(node.id)) addHost(node);
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
  for (const instance of instances) {
    serviceCounts.set(
      instance.serviceRef,
      (serviceCounts.get(instance.serviceRef) ?? 0) + 1,
    );
    const target = nodeOwners.get(instance.nodeRef) ?? instance.nodeRef;
    if (!serviceTargets.has(instance.serviceRef))
      serviceTargets.set(instance.serviceRef, new Set());
    serviceTargets.get(instance.serviceRef)!.add(target);
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
    if (instance)
      return [
        visibleHosts.has(instance.nodeRef)
          ? instance.nodeRef
          : (nodeOwners.get(instance.nodeRef) ?? instance.nodeRef),
      ];
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
      (a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
    );
  return { graph: { nodes, edges }, cards, relations: relationGroups };
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
