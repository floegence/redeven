import { describe, expect, it } from 'vitest';

import { normalizeDesktopAskFlowerHandoffPayload } from './askFlowerHandoffIPC';

describe('askFlowerHandoffIPC', () => {
  it('normalizes a detached file preview handoff payload', () => {
    expect(
      normalizeDesktopAskFlowerHandoffPayload({
        source: 'file_preview',
        path: '/workspace/demo.txt/',
        selectionText: '  selected line  ',
      }),
    ).toEqual({
      source: 'file_preview',
      path: '/workspace/demo.txt',
      selectionText: 'selected line',
    });
  });

  it('rejects payloads without an absolute file path', () => {
    expect(
      normalizeDesktopAskFlowerHandoffPayload({
        source: 'file_preview',
        path: 'workspace/demo.txt',
        selectionText: 'selected line',
      }),
    ).toBeNull();
  });

  it('rejects unsupported handoff sources', () => {
    expect(
      normalizeDesktopAskFlowerHandoffPayload({
        source: 'terminal',
        path: '/workspace/demo.txt',
        selectionText: '',
      }),
    ).toBeNull();
  });
});
