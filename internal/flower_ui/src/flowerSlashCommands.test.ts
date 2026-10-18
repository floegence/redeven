import { describe, expect, it } from 'vitest';

import { FLOWER_COMPACT_CONTEXT_COMMAND, parseFlowerSlashCommand } from './flowerSlashCommands';

describe('Flower slash commands', () => {
  it('parses only the exact compact command as an intent', () => {
    expect(parseFlowerSlashCommand('/compact')).toEqual({ kind: 'intent', command: FLOWER_COMPACT_CONTEXT_COMMAND });
    expect(parseFlowerSlashCommand('  /compact  ')).toEqual({ kind: 'intent', command: FLOWER_COMPACT_CONTEXT_COMMAND });
  });

  it('suggests compact while its prefix is incomplete', () => {
    expect(parseFlowerSlashCommand('/')).toEqual({ kind: 'suggest', query: '' });
    expect(parseFlowerSlashCommand('/com')).toEqual({ kind: 'suggest', query: 'com' });
  });

  it('rejects arguments and unknown commands', () => {
    expect(parseFlowerSlashCommand('/compact now')).toEqual({ kind: 'invalid', reason: 'arguments', command: '/compact' });
    expect(parseFlowerSlashCommand('/unknown')).toEqual({ kind: 'invalid', reason: 'unknown', command: '/unknown' });
  });

  it('leaves ordinary messages alone', () => {
    expect(parseFlowerSlashCommand('please compact later')).toEqual({ kind: 'none' });
  });
});

it('parses goal viewing, exact desired text, deletion and prefixes', () => {
  expect(parseFlowerSlashCommand('/goal')).toEqual({ kind: 'intent', command: '/goal', operation: 'open' });
  expect(parseFlowerSlashCommand('/goal Ship a verified result')).toEqual({ kind: 'intent', command: '/goal', operation: 'set', text: 'Ship a verified result' });
  expect(parseFlowerSlashCommand('/goal clear')).toEqual({ kind: 'intent', command: '/goal', operation: 'delete' });
  expect(parseFlowerSlashCommand('/go')).toEqual({ kind: 'suggest', query: 'go' });
  expect(parseFlowerSlashCommand('/goalkeeper')).toEqual({ kind: 'invalid', reason: 'unknown', command: '/goalkeeper' });
});
