import type { CanvasDocument, Version } from '../../../../tessiven_ui/src/types';

export function repeatedCallsDocument(count = 4): CanvasDocument {
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `host-${index}`, name: `Host ${index + 1}`, runtimeRef: `conceptual:pool/${index}`,
  }));
  const services = [
    { id: 'agent', name: 'Runtime Agent', kind: 'service' },
    { id: 'ui', name: 'Runtime Local UI', kind: 'api' },
    { id: 'runtime', name: 'Redeven Runtime', kind: 'runtime' },
  ];
  return {
    apiVersion: 'redeven.io/tessiven/v1.1.0', kind: 'ServiceCanvas', metadata: { title: 'Runtime pool' },
    nodes, services, groups: [{ id: 'pool', name: 'Runtime pool', nodeRefs: nodes.map(node => node.id) }],
    instances: nodes.flatMap(node => services.map(service => ({
      id: `${node.id}-${service.id}`, nodeRef: node.id, serviceRef: service.id, role: 'peer',
    }))),
    relations: nodes.flatMap(node => ['agent', 'ui'].map(service => ({
      id: `${node.id}-${service}-call`, from: `${node.id}-${service}`, to: `${node.id}-runtime`,
      kind: 'calls', protocol: service === 'agent' ? 'RPP' : 'process', evidenceRefs: [`evidence-${node.id}`],
    }))),
    evidence: nodes.map(node => ({ id: `evidence-${node.id}`, source: 'inference', locator: `example://${node.id}`, summary: `Design for ${node.name}` })),
  };
}

export function repeatedCallsVersion(count = 4): Version {
  return { canvas_id: 'repeated-calls', number: 1, source: 'example', document: repeatedCallsDocument(count),
    document_yaml: '', digest: 'fixture', created_at: 0, summary: '' };
}
