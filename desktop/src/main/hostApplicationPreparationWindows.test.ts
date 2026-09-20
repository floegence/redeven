import { describe, expect, it } from 'vitest';
import { HostApplicationPreparationWindows } from './hostApplicationPreparationWindows';
import { hostApplicationPreparationDocument, validHostApplicationPreparationView } from '../shared/hostApplicationPreparation';

describe('application preparation ownership', () => {
  const registry = () => new HostApplicationPreparationWindows<{ open: boolean }>(win => win.open, win => { win.open = false; });
  it('deduplicates one application and refuses claims from another document', () => {
    const windows = registry();
    const first = windows.reserve('alice:document1', 'editor', () => ({ open: true }));
    expect(windows.reserve('alice:document1', 'editor', () => { throw Error('duplicate'); })).toBe(first);
    expect(windows.claim('alice:document2', first.id)).toBeNull();
    expect(windows.claim('alice:document1', first.id)).toBe(first.window);
    expect(windows.claim('alice:document1', first.id)).toBeNull();
  });
  it('retires pending opening when the initiator navigates or a user closes the window', () => {
    const windows = registry();
    const first = windows.reserve('document1', 'editor', () => ({ open: true }));
    const other = windows.reserve('document2', 'editor', () => ({ open: true }));
    windows.releaseOwner('document1');
    expect(first.window.open).toBe(false);
    expect(windows.claim('document1', first.id)).toBeNull();
    expect(other.window.open).toBe(true);
    other.window.open = false;
    expect(windows.claim('document2', other.id)).toBeNull();
  });
  it('keeps application content inert and restricts icons and progress', () => {
    const view = { title: '<script>bad()</script>', icon: '', locale: 'en', heading: 'Preparing', detail: '<b>data</b>', progress: 0.25 };
    expect(validHostApplicationPreparationView(view)).toBe(true);
    expect(validHostApplicationPreparationView({ ...view, icon: 'https://example.com/icon' })).toBe(false);
    expect(validHostApplicationPreparationView({ ...view, progress: Infinity })).toBe(false);
    const document = hostApplicationPreparationDocument(view, { background: 'white', foreground: 'black', muted: 'gray', primary: 'blue', border: 'gray', colorScheme: 'light' });
    expect(document).not.toContain('<script>');
    expect(document).toContain('&lt;b&gt;data&lt;/b&gt;');
    expect(document).toContain('aria-valuenow="25"');
    expect(document).toContain('prefers-reduced-motion');
  });
});
