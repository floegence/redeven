import { describe, expect, it } from 'vitest';
import { projectCanvas, projectPositions } from '../../../../tessiven_ui/src/projection';
import { sharedHostsDocument } from './tessiven-shared-hosts.fixture';

describe('shared physical hosts in logical groups', () => {
  it('maps one canonical position hint to one visible appearance without changing saved data', () => {
    const document = sharedHostsDocument();
    document.presentation!.positions = [{objectRef:'node-1',x:600,y:500}];
    const both = projectCanvas(document,new Set(['hdfs','zk']),{});
    const positions = projectPositions(document,both);
    expect(positions).toHaveLength(1);
    expect(both.graph.nodes.find(n => n.id === positions[0].nodeId)?.parentId).toBe('hdfs');
    const second = projectCanvas(document,new Set(['zk']),{});
    expect(second.graph.nodes.find(n => n.id === projectPositions(document,second)[0].nodeId)?.parentId).toBe('zk');
    expect(projectPositions(document,projectCanvas(document,new Set(),{}))).toEqual([]);
    expect(document.presentation!.positions).toEqual([{objectRef:'node-1',x:600,y:500}]);
  });
  it('projects unique appearances with identical complete physical inventory', () => {
    const document = sharedHostsDocument();
    const projected = projectCanvas(document, new Set(['hdfs', 'zk']), {});
    expect(new Set(projected.graph.nodes.map(node => node.id)).size).toBe(projected.graph.nodes.length);
    const replicas = [...projected.cards].filter(([,card]) => card.kind === 'node' && card.node.id === 'node-1');
    expect(replicas).toHaveLength(2);
    for (const [,card] of replicas) {
      expect(card.kind === 'node' && card.instances.map(i => i.id)).toEqual(['nn-1', 'zk-1']);
    }
    const group = projected.cards.get('hdfs');
    expect(group?.kind === 'group' && group.instances.map(i => i.id)).toEqual(['nn-1', 'nn-2']);
    expect(projected.graph.edges.map(edge => [edge.source, edge.target])).toEqual([['hdfs', 'zk']]);
    expect([...projected.relations.values()].flat().map(r => r.id)).toEqual(['nn-zk']);
    expect(projected.internalRelations.get('hdfs::node-1')?.map(item => item.relation.id)).toEqual(['nn-zk']);
    expect(projected.internalRelations.get('zk::node-1')?.map(item => item.relation.id)).toEqual(['nn-zk']);
    expect(document.nodes).toHaveLength(3);
    expect(document.instances).toHaveLength(5);
  });

  it('routes instance relationships through their own logical appearance', () => {
    const document = sharedHostsDocument();
    document.relations![0] = { ...document.relations![0], from: 'nn-1', to: 'zk-1' };
    const projected = projectCanvas(document, new Set(['hdfs', 'zk']), {});
    expect(projected.graph.edges).toEqual([]);
    expect(projected.internalRelations.get('hdfs::node-1')?.map(item => item.relation.id)).toEqual(['nn-zk']);
    expect(projected.internalRelations.get('zk::node-1')?.map(item => item.relation.id)).toEqual(['nn-zk']);
    const collapsed = projectCanvas(document, new Set(), {});
    expect(collapsed.graph.edges).toEqual([]);
    expect(collapsed.internalRelations.get('hdfs')?.map(item => item.relation.id)).toEqual(['nn-zk']);
    expect(collapsed.internalRelations.get('zk')?.map(item => item.relation.id)).toEqual(['nn-zk']);
  });

  it('keeps an explicit cross-host call external without inferring co-located replicas', () => {
    const document = sharedHostsDocument();
    document.relations![0] = { ...document.relations![0], from: 'nn-1', to: 'zk-2' };
    const projected = projectCanvas(document, new Set(['hdfs', 'zk']), {});
    expect(projected.graph.edges.map(edge => [edge.source, edge.target]))
      .toEqual([['hdfs::node-1', 'zk::node-2']]);
    expect(projected.internalRelations.size).toBe(0);
  });

  it('keeps a co-located service call inside the host instead of creating a group self-loop', () => {
    const document = sharedHostsDocument();
    document.nodes = [{ id: 'local', name: 'local', runtimeRef: 'local:local' }];
    document.groups = [{ id: 'runtime', name: 'Runtime', nodeRefs: ['local'], instanceRefs: ['api-local', 'db-local'] }];
    document.services = [
      { id: 'api', name: 'HiveServer2', kind: 'api' },
      { id: 'db', name: 'Hive Metastore', kind: 'database' },
    ];
    document.instances = [
      { id: 'api-local', nodeRef: 'local', serviceRef: 'api', role: 'standalone' },
      { id: 'db-local', nodeRef: 'local', serviceRef: 'db', role: 'standalone' },
    ];
    document.relations = [{ id: 'local-call', from: 'api', to: 'db', kind: 'calls', evidenceRefs: ['design'] }];

    const expanded = projectCanvas(document, new Set(['runtime']), {});
    expect(expanded.graph.edges).toEqual([]);
    expect(expanded.internalRelations.get('local')?.map(item => item.relation.id)).toEqual(['local-call']);

    const collapsed = projectCanvas(document, new Set(), {});
    expect(collapsed.graph.edges).toEqual([]);
    expect(collapsed.internalRelations.get('runtime')?.map(item => item.relation.id)).toEqual(['local-call']);
  });

  it('routes physical host relationships through visible appearances and collapsed groups', () => {
    const document = sharedHostsDocument();
    document.relations![0] = { ...document.relations![0], from:'node-1',to:'node-3' };
    for (const expanded of [new Set(['hdfs','zk']),new Set(['hdfs']),new Set<string>()]) {
      const projection = projectCanvas(document,expanded,{});
      const visible = new Set(projection.graph.nodes.map(node => node.id));
      expect(projection.graph.edges.length).toBeGreaterThan(0);
      for (const edge of projection.graph.edges) {
        expect(visible.has(edge.source)).toBe(true);
        expect(visible.has(edge.target)).toBe(true);
        expect(projection.relations.get(edge.id)!.map(relation => relation.id)).toEqual(['nn-zk']);
      }
    }
    const expanded = projectCanvas(document,new Set(['hdfs','zk']),{});
    expect(expanded.graph.edges.map(edge => edge.source).sort()).toEqual(['hdfs::node-1','zk::node-1']);
  });

  it('retains every hosted service, ungrouped inventory and large group selection', () => {
    const document = sharedHostsDocument();
    for (let n = 4; n <= 20; n++) {
      document.nodes!.push({ id: `node-${n}`, name: `node-${n}`, runtimeRef: `conceptual:${n}` });
      document.groups![0].nodeRefs.push(`node-${n}`);
    }
    for (let n = 0; n < 15; n++) {
      document.services!.push({ id: `extra-${n}`, name: `Extra ${n}`, kind: 'worker' });
      document.instances!.push({ id: `extra-instance-${n}`, nodeRef: 'node-1', serviceRef: `extra-${n}`, role: 'standalone' });
    }
    const projected = projectCanvas(document, new Set(['hdfs','zk']), { hdfs: 'node-1' });
    const replicas = [...projected.cards].filter(([,card]) => card.kind === 'node' && card.node.id === 'node-1');
    expect(replicas).toHaveLength(2);
    for (const [id,card] of replicas) {
      expect(card.kind === 'node' && card.instances.length).toBe(17);
      expect(projected.graph.nodes.find(node => node.id === id)!.height).toBeGreaterThan(900);
    }
  });
});
