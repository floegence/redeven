import { describe, expect, it } from 'vitest';

import { isWebServiceBrowserDevToolsShortcut } from './webServiceBrowserShortcuts';

const input = (overrides: Partial<Parameters<typeof isWebServiceBrowserDevToolsShortcut>[0]> = {}) => ({
  type: 'keyDown',
  key: '',
  control: false,
  shift: false,
  alt: false,
  meta: false,
  ...overrides,
});

describe('webServiceBrowserShortcuts', () => {
  it('accepts F12 and conventional platform DevTools shortcuts', () => {
    expect(isWebServiceBrowserDevToolsShortcut(input({ key: 'F12' }))).toBe(true);
    expect(isWebServiceBrowserDevToolsShortcut(input({ key: 'i', meta: true, alt: true }))).toBe(true);
    expect(isWebServiceBrowserDevToolsShortcut(input({ key: 'I', control: true, shift: true }))).toBe(true);
  });

  it('rejects key-up, modified F12, and unrelated shortcuts', () => {
    expect(isWebServiceBrowserDevToolsShortcut(input({ type: 'keyUp', key: 'F12' }))).toBe(false);
    expect(isWebServiceBrowserDevToolsShortcut(input({ key: 'F12', shift: true }))).toBe(false);
    expect(isWebServiceBrowserDevToolsShortcut(input({ key: 'i', control: true }))).toBe(false);
  });
});
