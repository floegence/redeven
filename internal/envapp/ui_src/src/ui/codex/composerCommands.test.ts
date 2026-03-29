import { describe, expect, it } from 'vitest';

import { filterCodexSlashCommands } from './composerCommands';

describe('composerCommands', () => {
  it('returns all available commands for an empty query', () => {
    expect(filterCodexSlashCommands({
      query: '',
      context: { hostAvailable: true, workingDirEditable: true },
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
      context: { hostAvailable: true, workingDirEditable: true },
    }).map((entry) => entry.command)).toEqual(['approval']);

    expect(filterCodexSlashCommands({
      query: 'me',
      context: { hostAvailable: true, workingDirEditable: true },
    }).map((entry) => entry.command)[0]).toBe('mention');
  });

  it('hides host-backed commands when the host is unavailable', () => {
    expect(filterCodexSlashCommands({
      query: '',
      context: { hostAvailable: false, workingDirEditable: false },
    }).map((entry) => entry.command)).toEqual([
      'mention',
      'clear',
    ]);
  });

  it('hides /cwd when the working directory is locked', () => {
    expect(filterCodexSlashCommands({
      query: '',
      context: { hostAvailable: true, workingDirEditable: false },
    }).map((entry) => entry.command)).not.toContain('cwd');
  });
});
