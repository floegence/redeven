import { describe, expect, it, vi } from 'vitest';
import { reopenEnvironmentPage } from './windowNavigation';

function location(pathname: string, origin = 'https://env.example.test') {
  return { origin, pathname, href: `${origin}${pathname}`, reload: vi.fn(), assign: vi.fn() };
}

describe('reopenEnvironmentPage', () => {
  it('restarts the same-origin bootstrap that owns the expired connection', () => {
    const parent = { location: location('/_redeven_boot/') };
    const win = { location: location('/_redeven_proxy/env/'), parent };
    reopenEnvironmentPage(win as unknown as Window);
    expect(parent.location.reload).toHaveBeenCalledOnce();
    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it.each(['cross-origin', 'unrelated-page', 'standalone'])('does not navigate an %s owner', (kind) => {
    const parent = { location: location('/dashboard', 'https://other.example.test') };
    const win = { location: location('/env/'), parent: parent as unknown };
    if (kind === 'cross-origin') Object.defineProperty(parent, 'location', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
    if (kind === 'unrelated-page') parent.location.origin = win.location.origin;
    if (kind === 'standalone') win.parent = win;
    reopenEnvironmentPage(win as unknown as Window);
    expect(win.location.reload).toHaveBeenCalledOnce();
  });
});
