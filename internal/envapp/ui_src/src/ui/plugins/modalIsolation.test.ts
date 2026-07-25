// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { isolateDocumentBranch } from './modalIsolation';

afterEach(() => {
  document.body.replaceChildren();
});

describe('isolateDocumentBranch', () => {
  it('reference-counts overlapping isolation and restores original inert state', () => {
    const shell = document.createElement('main');
    const alreadyInert = document.createElement('aside');
    alreadyInert.inert = true;
    const portal = document.createElement('div');
    const modal = document.createElement('section');
    const modalSibling = document.createElement('button');
    portal.append(modal, modalSibling);
    document.body.append(shell, alreadyInert, portal);

    const restoreFirst = isolateDocumentBranch(modal);
    const restoreSecond = isolateDocumentBranch(modal);

    expect(shell.inert).toBe(true);
    expect(alreadyInert.inert).toBe(true);
    expect(modalSibling.inert).toBe(true);
    expect(Boolean(modal.inert)).toBe(false);

    restoreFirst();
    expect(shell.inert).toBe(true);
    expect(modalSibling.inert).toBe(true);

    restoreSecond();
    expect(Boolean(shell.inert)).toBe(false);
    expect(alreadyInert.inert).toBe(true);
    expect(Boolean(modalSibling.inert)).toBe(false);
  });
});
