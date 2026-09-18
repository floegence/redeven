import { describe, expect, it, vi } from 'vitest';
import { notifyEnvAppBootReady } from './envAppBootReady';

function browser(parentPath = '/_redeven_boot/', parentOrigin = 'https://env.example.test') {
  const parent = { location: { origin: parentOrigin, pathname: parentPath }, postMessage: vi.fn() };
  const win = { parent, location: { origin: 'https://env.example.test' } };
  return { parent, win: win as unknown as Window };
}

describe('Env App bootstrap presentation', () => {
  it('notifies only its same-origin Redeven bootstrap with a presentation-only message', () => {
    const { parent, win } = browser();
    notifyEnvAppBootReady(win);
    expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({ v: 1, type: 'redeven:env_app_ready' }, win.location.origin);
  });
  it.each(['cross-origin', 'unrelated', 'standalone'])('does not notify an %s parent', (kind) => {
    const { parent, win } = browser('/dashboard');
    if (kind === 'cross-origin') Object.defineProperty(parent, 'location', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
    if (kind === 'standalone') Object.defineProperty(win, 'parent', { value: win });
    expect(() => notifyEnvAppBootReady(win)).not.toThrow();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });
});
