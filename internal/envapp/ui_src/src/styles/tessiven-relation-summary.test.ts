import { describe, expect, it } from 'vitest';
import { projectCanvas, projectLayoutOptions } from '../../../../tessiven_ui/src/projection';
import { repeatedCallsDocument } from './tessiven-relation-summary.fixture';
import { relationPreviewLimit, relationSectionHeight, summaryReferences } from '../../../../tessiven_ui/src/relations';

describe('node pool relationship summaries', () => {
  it.each([4, 100, 500, 1000])('bounds collapsed geometry while retaining every relationship on %i hosts', count => {
    const document = repeatedCallsDocument(count);
    const before = JSON.stringify(document);
    const projection = projectCanvas(document, new Set(), {});
    const summaries = projection.groupRelations.get('pool')!;
    expect(summaries).toHaveLength(2);
    for (const summary of summaries) {
      expect(summary.locality).toBe('local');
      expect(summary.relationRefs).toHaveLength(count);
      expect(summary.nodeRefs).toHaveLength(count);
    }
    expect(new Set(summaries.flatMap(summary => summary.relationRefs)).size).toBe(count * 2);
    expect(projection.graph.nodes.find(node => node.id === 'pool')!.height).toBeLessThan(420);
    expect(projection.internalRelations.has('pool')).toBe(false);
    expect(JSON.stringify(document)).toBe(before);
  });

  it('keeps the entire pool summary stable when selecting an aggregated host', () => {
    const document = repeatedCallsDocument(100);
    const first = projectCanvas(document, new Set(['pool']), { pool: 'host-0' });
    const last = projectCanvas(document, new Set(['pool']), { pool: 'host-99' });
    expect(first.groupRelations).toEqual(last.groupRelations);
    expect(first.internalRelations.get('host-0')?.map(item => item.relation.id)).toEqual(['host-0-agent-call', 'host-0-ui-call']);
    expect(last.internalRelations.get('host-99')?.map(item => item.relation.id)).toEqual(['host-99-agent-call', 'host-99-ui-call']);
    expect(first.internalRelations.has('pool')).toBe(false);
    expect(projectLayoutOptions(document, first).groupPadding?.top).toBe(108);
  });

  it('separates endpoint identity, direction, protocol, granularity and locality without losing evidence', () => {
    const document = repeatedCallsDocument();
    document.services!.push({ id: 'other-agent', name: 'Runtime Agent', kind: 'service' });
    document.instances!.push({ id: 'other-0', nodeRef: 'host-0', serviceRef: 'other-agent', role: 'peer' });
    document.relations!.push(
      { id: 'reverse', from: 'host-0-runtime', to: 'host-0-agent', kind: 'calls', protocol: 'RPP', evidenceRefs: ['evidence-host-0'] },
      { id: 'protocol', from: 'host-0-agent', to: 'host-0-runtime', kind: 'calls', protocol: 'HTTP', evidenceRefs: ['evidence-host-0'] },
      { id: 'cross', from: 'host-0-agent', to: 'host-1-runtime', kind: 'calls', protocol: 'RPP', evidenceRefs: ['evidence-host-1'] },
      { id: 'logical', from: 'agent', to: 'runtime', kind: 'calls', protocol: 'RPP', evidenceRefs: ['evidence-host-0'] },
      { id: 'same-name', from: 'other-0', to: 'host-0-runtime', kind: 'calls', protocol: 'RPP', evidenceRefs: ['evidence-host-0'] },
    );
    const projection = projectCanvas(document, new Set(), {});
    const summaries = projection.groupRelations.get('pool')!;
    expect(summaries).toHaveLength(7);
    const cross = summaries.find(item => item.relationRefs.includes('cross'))!;
    expect(cross.locality).toBe('cross-node');
    expect(cross.nodeRefs).toEqual(['host-0', 'host-1']);
    const logical = summaries.find(item => item.relationRefs.includes('logical'))!;
    expect(logical.locality).toBe('logical');
    expect(logical.relationRefs).toEqual(['logical']);
    expect(logical.nodeRefs).toHaveLength(4);
    expect(summaries.find(item => item.relationRefs.includes('same-name'))!.from.canonicalRef).toBe('other-agent');
    const retained = summaries.flatMap(item => item.relationRefs);
    expect(new Set(retained).size).toBe(document.relations!.length);
    for (const relation of document.relations!) expect(projection.relationDetails.get(relation.id)?.relation).toBe(relation);
    expect(projection.graph.nodes[0].height).toBe(116 + 4 * 49 + relationSectionHeight(relationPreviewLimit, true));
    expect(summaryReferences('pool', summaries[0])).toEqual(['pool', 'agent', 'runtime']);
  });

  it('deduplicates canonical hosts and relationships across shared group appearances', () => {
    const document = repeatedCallsDocument(20);
    document.groups!.push({ id: 'shared', name: 'Shared pool', nodeRefs: [...document.groups![0].nodeRefs] });
    for (const expanded of [new Set<string>(), new Set(['pool', 'shared'])]) {
      const projection = projectCanvas(document, expanded, { pool: 'host-19', shared: 'host-0' });
      for (const id of ['pool', 'shared']) for (const summary of projection.groupRelations.get(id)!) {
        expect(summary.relationRefs).toHaveLength(20);
        expect(summary.nodeRefs).toHaveLength(20);
      }
    }
  });

  it('retains real cross-host graph edges while providing the same group overview in both states', () => {
    const document = repeatedCallsDocument();
    document.relations!.push({ id: 'peer', from: 'host-0-agent', to: 'host-1-agent', kind: 'peers', evidenceRefs: ['evidence-host-0'] });
    const collapsed = projectCanvas(document, new Set(), {});
    const expanded = projectCanvas(document, new Set(['pool']), {});
    expect(expanded.graph.edges.map(edge => [edge.source, edge.target])).toEqual([['host-0', 'host-1']]);
    expect(collapsed.groupRelations).toEqual(expanded.groupRelations);
  });

  it('preserves non-service canonical endpoints instead of merging unrelated host relations', () => {
    const document = repeatedCallsDocument();
    document.relations = [
      { id: 'hosts-1', from: 'host-0', to: 'host-1', kind: 'peers', evidenceRefs: [] },
      { id: 'hosts-2', from: 'host-0', to: 'host-2', kind: 'peers', evidenceRefs: [] },
    ];
    const summaries = projectCanvas(document, new Set(), {}).groupRelations.get('pool')!;
    expect(summaries).toHaveLength(2);
    expect(summaries.map(item => item.to.canonicalRef)).toEqual(['host-1', 'host-2']);
  });
});
