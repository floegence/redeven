// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { GitCommitSummary } from '../protocol/redeven_v1';
import { buildCommitGraphRows } from './GitCommitGraph';

function commit(hash: string, parents: string[], subject: string): GitCommitSummary {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    subject,
    authorName: 'Tester',
    authorTimeMs: Date.now(),
  };
}

describe('buildCommitGraphRows', () => {
  it('keeps side lanes stable through a merge sequence', () => {
    const rows = buildCommitGraphRows([
      commit('merge000', ['main001', 'feat001'], 'Merge branch'),
      commit('main001', ['main000'], 'Main work'),
      commit('feat001', ['feat000'], 'Feature work'),
      commit('main000', ['root000'], 'Main base'),
      commit('feat000', ['root000'], 'Feature base'),
      commit('root000', [], 'Root'),
    ]);

    expect(rows).toHaveLength(6);
    expect(rows[0]?.afterLanes.map((lane) => lane.hash)).toEqual(['main001', 'feat001']);
    expect(rows[1]?.beforeLanes.map((lane) => lane.hash)).toEqual(['main001', 'feat001']);
    expect(rows[2]?.beforeLanes.map((lane) => lane.hash)).toEqual(['main000', 'feat001']);
    expect(rows[2]?.lane).toBe(1);
    expect(rows[2]?.afterLanes.map((lane) => lane.hash)).toEqual(['main000', 'feat000']);
    expect(new Set(rows.map((row) => row.columns))).toEqual(new Set([2]));
    expect(rows[0]?.afterLanes[1]?.colorIndex).toBe(rows[2]?.nodeColorIndex);
    expect(rows[0]?.nodeColorIndex).toBe(rows[1]?.nodeColorIndex);
  });
});
