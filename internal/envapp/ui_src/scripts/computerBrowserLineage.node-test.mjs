import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserLineage } from './computerBrowserLineage.mjs';

test('private ancestry survives closed parents and stops at the exact source scope', () => {
  const owners = new Set(['root']);
  const tree = createBrowserLineage(id => owners.has(id));
  tree.observe('owned', '1'); tree.bind('owned', '1', 'root');
  tree.observe('owned', '2', '1'); tree.observe('owned', '3', '2');
  tree.bind('owned', '3', 'nested');
  tree.observe('other', '3', '1'); tree.bind('other', '3', 'peer');
  assert.deepEqual(tree.ancestors('nested'), ['root']);
  assert.deepEqual(tree.ancestors('peer'), []);
  tree.remove('owned', '1'); tree.remove('owned', '2');
  assert.deepEqual(tree.ancestors('nested'), ['root']);
  owners.clear(); tree.refresh();
  assert.deepEqual(tree.ancestors('nested'), []);
  tree.remove('owned', '3');
  assert.deepEqual(tree.lineage('owned', '3'), []);
});

test('long closed popup chains compact while native target state remains bounded', () => {
  const tree = createBrowserLineage(() => false);
  tree.observe('owned', '0');
  for (let id = 1; id < 2000; id++) {
    tree.observe('owned', String(id), String(id - 1));
    tree.remove('owned', String(id - 1));
  }
  tree.bind('owned', '1999', 'current');
  assert.deepEqual(tree.lineage('owned', '1999'), ['current']);
  for (let id = 0; id < 1023; id++) tree.observe('owned', `live-${id}`);
  assert.throws(() => tree.observe('owned', 'overflow'), /DIRECTORY_LIMIT/);
  tree.closeScope('owned');
  assert.deepEqual(tree.ancestors('current'), []);
});


test('a compacted native ancestry edge survives another directory reporting a closed intermediate target', () => {
  const tree = createBrowserLineage(id => id === 'private-root');
  tree.observe('native', 'root'); tree.bind('native', 'root', 'private-root');
  tree.observe('native', 'child', 'root');
  tree.observe('native', 'child', 'closed-middle');
  tree.observe('native', 'closed-middle', 'root');
  assert.deepEqual(tree.lineage('native', 'child'), ['private-root']);
  tree.remove('native', 'closed-middle'); tree.remove('native', 'root');
  assert.deepEqual(tree.lineage('native', 'child'), ['private-root']);
  assert.throws(() => tree.observe('native', 'root', 'child'), /DIRECTORY_INVALID/);
});
