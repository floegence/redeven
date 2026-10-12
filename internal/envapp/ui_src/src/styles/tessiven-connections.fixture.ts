import type { CanvasDocument, Version } from '../../../../tessiven_ui/src/types';

export function connectionDocument(): CanvasDocument {
  const ids = ['a1', 'a2', 'b1', 'b2', 'outside'];
  return {
    apiVersion: 'redeven.io/tessiven/v1.1.0', kind: 'ServiceCanvas', metadata: { title: 'Progressive connections' },
    nodes: ids.map(id => ({ id, name: id, runtimeRef: `conceptual:${id}` })),
    groups: [{ id: 'a', name: 'Application', nodeRefs: ['a1', 'a2'] }, { id: 'b', name: 'Workers', nodeRefs: ['b1', 'b2'] }],
    services: [{ id: 'api', name: 'API', kind: 'api' }, { id: 'worker', name: 'Worker', kind: 'worker' }],
    instances: ids.map(id => ({ id: `instance-${id}`, nodeRef: id, serviceRef: id.startsWith('b') ? 'worker' : 'api', role: 'peer' })),
    resources: [{ id: 'store', name: 'External storage', kind: 'object_store', endpoint: 's3://example' }],
    relations: [
      { id: 'a1-b1', from: 'instance-a1', to: 'instance-b1', kind: 'calls', evidenceRefs: ['design'] },
      { id: 'a2-b2', from: 'instance-a2', to: 'instance-b2', kind: 'calls', evidenceRefs: ['design'] },
      { id: 'b1-a1', from: 'instance-b1', to: 'instance-a1', kind: 'calls', evidenceRefs: ['design'] },
      { id: 'a1-a2', from: 'instance-a1', to: 'instance-a2', kind: 'peers', evidenceRefs: ['design'] },
      { id: 'outside-a1', from: 'instance-outside', to: 'instance-a1', kind: 'calls', evidenceRefs: ['design'] },
      { id: 'b1-store', from: 'instance-b1', to: 'store', kind: 'writes', evidenceRefs: ['design'] },
    ],
    evidence: [{ id: 'design', source: 'inference', locator: 'example://connections', summary: 'Progressive connection qualification.' }],
    presentation: { direction: 'RIGHT', layers: [['a', 'outside'], ['b'], ['store']], initiallyExpanded: ['a', 'b'],
      groupLayouts: { a: { flow: 'column' }, b: { flow: 'column' } } },
  };
}
export function connectionVersion(document = connectionDocument()): Version {
  return { canvas_id: 'connections', number: 1, document, document_yaml: '', digest: 'fixture', created_at: 0, source: 'example', summary: '' };
}
