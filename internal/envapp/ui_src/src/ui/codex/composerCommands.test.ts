import { describe, expect, it } from 'vitest';

import { filterCodexSlashCommands } from './composerCommands';

describe('composerCommands', () => {
  it('returns all available commands for an empty query', () => {
    expect(filterCodexSlashCommands({
      query: '',
      context: { hostAvailable: true },
    }).map((entry) => entry.command)).toEqual([
      'mention',
      'new',
      'clear',
      'cwd',
      'model',
      'effort',
      'approval',
      'sandbox',
    ]);
  });

  it('filters and ranks commands by prefix and alias', () => {
    expect(filterCodexSlashCommands({
      query: 'perm',
      context: { hostAvailable: true },
    }).map((entry) => entry.command)).toEqual(['approval']);

    expect(filterCodexSlashCommands({
      query: 'me',
      context: { hostAvailable: true },
    }).map((entry) => entry.command)[0]).toBe('mention');
  });

  it('hides host-backed commands when the host is unavailable', () => {
    expect(filterCodexSlashCommands({
      query: '',
      context: { hostAvailable: false },
    }).map((entry) => entry.command)).toEqual([
      'mention',
      'clear',
      'cwd',
    ]);
  });
});
