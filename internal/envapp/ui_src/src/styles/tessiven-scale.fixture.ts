import type { CanvasDocument } from '../../../../tessiven_ui/src/types';

export function scaleDocument(count: number, grouped: boolean): CanvasDocument {
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `host-${index}`, name: `Host ${index + 1}`, runtimeRef: `conceptual:scale/host-${index}`,
  }));
  const services = ['api', 'worker', 'cache', 'metrics'].map(kind => ({ id: kind, name: `${kind} service`, kind }));
  const groups = grouped ? Array.from({ length: Math.ceil(count / 10) }, (_, index) => ({
    id: `group-${index}`, name: `Application ${index + 1}`, nodeRefs: nodes.slice(index * 10, index * 10 + 10).map(node => node.id),
  })) : [];
  return {
    apiVersion: 'redeven.io/tessiven/v1.0.0', kind: 'ServiceCanvas', metadata: { title: `Scale / ${count} hosts` }, nodes, groups, services,
    instances: nodes.flatMap(node => services.map(service => ({ id: `${node.id}-${service.id}`, nodeRef: node.id, serviceRef: service.id, role: 'peer' }))),
    relations: [
      ...nodes.slice(1).map((node, index) => ({ id: `link-${index}`, from: nodes[Math.floor(index / 2)].id, to: node.id, kind: 'calls', evidenceRefs: ['design'] })),
      ...nodes.map(node => ({ id: `${node.id}-local`, from: `${node.id}-api`, to: `${node.id}-cache`, kind: 'accesses', evidenceRefs: ['design'] })),
    ],
    evidence: [{ id: 'design', source: 'inference', locator: 'example://scale', summary: 'Deterministic large topology qualification.' }],
    presentation: { direction: 'RIGHT', initiallyExpanded: groups.map(group => group.id) },
  };
}
