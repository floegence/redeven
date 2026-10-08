import type { CanvasDocument, Version } from '../../../../tessiven_ui/src/types';

export type SharedHostsScenario = 'two' | 'one' | 'same' | 'mixed';
export function sharedHostsDocument(scenario: SharedHostsScenario = 'two'): CanvasDocument {
  const document: CanvasDocument = {
    apiVersion: 'redeven.io/tessiven/v1', kind: 'ServiceCanvas',
    metadata: { title: 'Hadoop / Core' },
    nodes: [1, 2, 3].map(n => ({ id: `node-${n}`, name: `node-0${n}`, runtimeRef: `conceptual:demo/node-${n}` })),
    groups: [
      { id: 'hdfs', name: 'HDFS / Core', nodeRefs: ['node-1', 'node-2'], instanceRefs: ['nn-1', 'nn-2'] },
      { id: 'zk', name: 'ZooKeeper / Core', nodeRefs: ['node-1', 'node-2', 'node-3'], instanceRefs: ['zk-1', 'zk-2', 'zk-3'] },
    ],
    services: [
      { id: 'nn', name: 'NameNode', kind: 'service' },
      { id: 'zookeeper', name: 'ZooKeeper', kind: 'service' },
    ],
    instances: [
      { id: 'nn-1', nodeRef: 'node-1', serviceRef: 'nn', name: 'NameNode · Active', role: 'primary' },
      { id: 'nn-2', nodeRef: 'node-2', serviceRef: 'nn', name: 'NameNode · Standby', role: 'replica' },
      ...[1, 2, 3].map(n => ({ id: `zk-${n}`, nodeRef: `node-${n}`, serviceRef: 'zookeeper', role: n === 2 ? 'primary' : 'replica' })),
    ],
    relations: [{ id: 'nn-zk', from: 'nn', to: 'zookeeper', kind: 'accesses', evidenceRefs: ['design'] }],
    evidence: [{ id: 'design', source: 'inference', locator: 'example://hadoop', summary: 'Illustrative coordination topology.' }],
    presentation: { initiallyExpanded: ['hdfs', 'zk'] },
  };
  if (scenario === 'one') {
    document.nodes!.push({ id: 'node-4', name: 'node-04', runtimeRef: 'conceptual:demo/node-4' });
    document.instances!.find(i => i.id === 'zk-2')!.nodeRef = 'node-4';
    document.groups![1].nodeRefs = ['node-1','node-3','node-4'];
  }
  if (scenario === 'same') {
    document.nodes!.push({ id: 'node-4', name: 'node-04', runtimeRef: 'conceptual:demo/node-4' });
    document.groups![0] = { id:'hdfs', name:'ZooKeeper / Analytics', nodeRefs:['node-1','node-2','node-4'], instanceRefs:['analytics-1','analytics-2','analytics-4'] };
    document.services = document.services!.filter(s => s.id === 'zookeeper');
    document.services.push({id:'analytics-zookeeper',name:'ZooKeeper',kind:'service'});
    document.instances = document.instances!.filter(i => i.serviceRef === 'zookeeper');
    document.instances.push(...[1,2,4].map(n => ({id:`analytics-${n}`,nodeRef:`node-${n}`,serviceRef:'analytics-zookeeper',role:n === 1 ? 'primary' : 'replica'})));
    document.relations = [];
  }
  if (scenario === 'mixed') {
    document.nodes!.push(...[4,5,6].map(n => ({ id:`node-${n}`,name:`node-0${n}`,runtimeRef:`conceptual:demo/node-${n}` })));
    const placements = [
      { id:'yarn', name:'YARN / Core', service:'rm', title:'ResourceManager', kind:'service', nodes:[1,2,4] },
      { id:'web', name:'Commerce / API', service:'api', title:'Orders API', kind:'api', nodes:[1,5] },
      { id:'search', name:'Search / Analytics', service:'search-index', title:'Search index', kind:'search', nodes:[2,5] },
    ];
    for (const p of placements) {
      document.services!.push({id:p.service,name:p.title,kind:p.kind});
      const instances = p.nodes.map(n => ({id:`${p.service}-${n}`,nodeRef:`node-${n}`,serviceRef:p.service,role:'peer'}));
      document.instances!.push(...instances);
      document.groups!.push({id:p.id,name:p.name,nodeRefs:instances.map(i => i.nodeRef),instanceRefs:instances.map(i => i.id)});
    }
    document.services!.push({id:'monitor',name:'Prometheus',kind:'service'});
    document.instances!.push({id:'monitor-6',nodeRef:'node-6',serviceRef:'monitor',role:'standalone'});
    document.presentation!.initiallyExpanded = document.groups!.map(g => g.id);
  }
  return document;
}

export function sharedHostsVersion(scenario: SharedHostsScenario = 'two'): Version {
  return { canvas_id: 'hadoop', number: 3, document_yaml: '', document: sharedHostsDocument(scenario), digest: 'fixture', created_at: 0, source: 'example', summary: '' };
}
