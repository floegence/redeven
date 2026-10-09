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
  internalRelations: Map<string, InternalRelation[]>;
  appearances: Map<string, string[]>;
  memberships: Map<string, Group[]>;
  instanceMemberships: Map<string, Group[]>;
};
export type InternalRelation = {
  relation: Relation;
  fromLabel: string;
  toLabel: string;
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
  const byService = new Map<string, Instance[]>();
  for (const instance of instances) {
    const list = byNode.get(instance.nodeRef) ?? [];
    list.push(instance);
    byNode.set(instance.nodeRef, list);
    const serviceInstances = byService.get(instance.serviceRef) ?? [];
    serviceInstances.push(instance);
    byService.set(instance.serviceRef, serviceInstances);
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
      height: 128 + serviceCount * 49,
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
      height: open ? 108 : 116 + Math.min(serviceIDs.size, 8) * 49 + (serviceIDs.size > 8 ? 26 : 0),
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
  const hostTargets = (nodeId: string): string[] => {
    const owners = memberships.get(nodeId);
    if (owners?.length) return [...new Set(owners.map(group => {
      const view = viewID(nodeId, group);
      return cards.has(view) ? view : group.id;
    }))];
    return [appearances.get(nodeId)?.[0] ?? nodeId];
  };
  type Endpoint = { id: string; hostId?: string };
  const endpoints = (id: string): Endpoint[] => {
    if (serviceTargets.has(id)) return [...serviceTargets.get(id)!].map(target => ({ id: target }));
    const instance = byID.get(id);
    if (instance) return [...new Set(instanceTargets(instance, true))].map(target => ({ id: target, hostId: instance.nodeRef }));
    if (hosts.has(id)) return hostTargets(id).map(target => ({ id: target, hostId: id }));
    return [{ id }];
  };
  const edges: GraphEdge[] = [];
  const internalRelations = new Map<string, InternalRelation[]>();
  const objectNames = new Map<string, string>();
  for (const item of [...(document.nodes ?? []), ...(document.groups ?? []), ...(document.services ?? []), ...(document.resources ?? [])])
    objectNames.set(item.id, item.name);
  const endpointLabel = (id: string) => {
    const instance = byID.get(id);
    return objectNames.get(instance?.serviceRef ?? id) ?? id;
  };
  const addInternalRelation = (target: string, relation: Relation) => {
    const values = internalRelations.get(target) ?? [];
    if (!values.some(value => value.relation.id === relation.id)) {
      values.push({ relation, fromLabel: endpointLabel(relation.from), toLabel: endpointLabel(relation.to) });
      internalRelations.set(target, values);
    }
  };
  const endpointInstances = (id: string): Instance[] => {
    const instance = byID.get(id);
    return instance ? [instance] : byService.get(id) ?? [];
  };
  for (const relation of document.relations ?? []) {
    // Service-level relations are intentionally kept at the logical group
    // level for routing. When both endpoints have instances on one host, add
    // the same relation to that host card so a group self-loop is unnecessary.
    const sourceInstances = endpointInstances(relation.from);
    const targetHosts = new Set(endpointInstances(relation.to).map(instance => instance.nodeRef));
    const sharedHosts = new Set(sourceInstances
      .filter(instance => targetHosts.has(instance.nodeRef))
      .map(instance => instance.nodeRef));
    const localOwners = new Set<string>();
    for (const nodeId of sharedHosts)
      for (const owner of hostTargets(nodeId)) {
        localOwners.add(owner);
        const card = cards.get(owner);
        if (card?.kind === 'node' && card.group) localOwners.add(card.group.id);
        addInternalRelation(owner, relation);
      }
    for (const source of endpoints(relation.from))
      for (const target of endpoints(relation.to)) {
        if (source.hostId && source.hostId === target.hostId) {
          for (const owner of hostTargets(source.hostId)) addInternalRelation(owner, relation);
          continue;
        }
        const card = cards.get(source.id);
        if (source.id === target.id && (card?.kind === 'node' || card?.kind === 'group')) {
          // A relationship inside one visible card is a compact, inspectable
          // row. Expanded hosts already show co-located calls, so the group
          // header does not repeat the same row.
          if (!localOwners.has(source.id)) addInternalRelation(source.id, relation);
          continue;
        }
        const key = `${source.id}/${target.id}`;
        if (!relationGroups.has(key)) {
          relationGroups.set(key, []);
          edges.push({ id: key, source: source.id, target: target.id, label: relation.kind });
        }
        relationGroups.get(key)!.push(relation);
      }
  }
  for (const node of nodes) node.height += (internalRelations.get(node.id)?.length ?? 0) * 30;
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
  return { graph: { nodes, edges }, cards, relations: relationGroups, internalRelations, appearances, memberships, instanceMemberships: instanceGroups };
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
