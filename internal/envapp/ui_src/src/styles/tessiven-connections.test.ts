import { describe, expect, it } from 'vitest';
import { projectCanvas } from '../../../../tessiven_ui/src/projection';
import { projectOverviewConnections, projectNodeConnections } from '../../../../tessiven_ui/src/connections';
import { connectionDocument } from './tessiven-connections.fixture';

const pairs = (value: ReturnType<typeof projectOverviewConnections>) => value.edges.map(edge => [edge.source, edge.target]);
describe('progressive canvas connections', () => {
  it.each([[], ['a'], ['a', 'b']])('retains root overview independent of expansion: %j', (...expanded) => {
    const document = connectionDocument(), before = JSON.stringify(document);
    const projection = projectCanvas(document, new Set(expanded), {});
    const overview = projectOverviewConnections(projection);
    expect(pairs(overview)).toEqual([['a', 'b'], ['b', 'a'], ['outside', 'a'], ['b', 'store']]);
    expect(overview.relations.get(overview.edges[0].id)?.map(relation => relation.id)).toEqual(['a1-b1', 'a2-b2']);
    expect(JSON.stringify(document)).toBe(before);
  });
  it('shows only incident physical relationships without sibling leakage', () => {
    const projection = projectCanvas(connectionDocument(), new Set(['a', 'b']), {});
    expect(pairs(projectNodeConnections(projection, 'a1'))).toEqual([['a1', 'b1'], ['b1', 'a1'], ['a1', 'a2'], ['outside', 'a1']]);
    expect(pairs(projectNodeConnections(projection, 'a2'))).toEqual([['a2', 'b2'], ['a1', 'a2']]);
  });
  it('routes hidden targets to other pools without a false own-pool edge', () => {
    const document = connectionDocument();
    for (let i = 3; i <= 20; i++) {
      document.nodes!.push({ id: `a${i}`, name: `a${i}`, runtimeRef: `conceptual:a${i}` });
      document.groups![0].nodeRefs.push(`a${i}`);
    }
    const projection = projectCanvas(document, new Set(['a']), { a: 'a1' });
    expect(pairs(projectNodeConnections(projection, 'a1'))).toEqual([['a1', 'b'], ['b', 'a1'], ['outside', 'a1']]);
    expect(projection.groupRelations.get('a')!.flatMap(value => value.relationRefs)).toContain('a1-a2');
  });
  it('preserves logical service endpoints without inventing instance pairs', () => {
    const document = connectionDocument();
    document.relations = [{ id: 'logical', from: 'api', to: 'worker', kind: 'calls', evidenceRefs: [] }];
    const projection = projectCanvas(document, new Set(['a', 'b']), {});
    expect(pairs(projectNodeConnections(projection, 'a1'))).toEqual([['a1', 'b']]);
    expect(pairs(projectNodeConnections(projection, 'b1'))).toEqual([['a', 'b1'], ['outside', 'b1']]);
  });
  it('keeps one target appearance while sharing canonical node identity', () => {
    const document = connectionDocument();
    document.groups![1].nodeRefs.push('a1');
    document.relations = [{ id: 'physical', from: 'a1', to: 'b1', kind: 'calls', evidenceRefs: [] }];
    const projection = projectCanvas(document, new Set(['a', 'b']), {});
    expect(pairs(projectNodeConnections(projection, 'a::a1'))).toEqual([['a::a1', 'b1']]);
    expect(pairs(projectNodeConnections(projection, 'b::a1'))).toEqual([['b::a1', 'b1']]);
  });
  it('preserves ungrouped connectivity without groups', () => {
    const document = connectionDocument(); document.groups = []; delete document.presentation;
    const projection = projectCanvas(document, new Set(), {});
    expect(projectOverviewConnections(projection).edges).toHaveLength(6);
  });
});
