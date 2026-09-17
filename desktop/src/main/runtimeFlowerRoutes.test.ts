import { describe, expect, it } from 'vitest';
import type { RuntimeFlowerRequestMethod } from '../shared/runtimeFlowerIPC';
import { runtimeFlowerMethodAllowed, runtimeFlowerPath } from './runtimeFlowerRoutes';

const base = '/_redeven_proxy/api/ai/computer';

describe('Desktop computer management routes', () => {
  it.each<[string, RuntimeFlowerRequestMethod[]]>([
    ['/candidates?thread_id=thread-1', ['GET']], ['/select', ['POST']],
    ['/targets', ['GET']], ['/tabs', ['POST']], ['/disconnect', ['POST']],
    ['/target?thread_id=thread-1', ['GET']], ['/target', ['PUT']],
    ['/access?thread_id=thread-1', ['GET', 'PUT']],
    ['/managed/profiles', ['GET', 'POST']], ['/managed/tabs?profile_id=profile-1', ['GET']],
    ['/extension/setup', ['POST']], ['/extension/profiles', ['GET']],
    ['/extension/tabs?profile_id=profile-1', ['GET']],
  ])('admits %s only through its declared methods', (suffix, methods) => {
    const path = base + suffix;
    expect(runtimeFlowerPath(path)).toBe(path);
    for (const method of ['GET', 'PUT', 'POST', 'PATCH', 'DELETE'] as const) {
      expect(runtimeFlowerMethodAllowed(path, method)).toBe(methods.includes(method));
    }
  });

  it.each([
    '/candidates', '/candidates?thread_id=', '/candidates?thread_id=a&thread_id=b', '/candidates?thread_id=a&cdp_url=x', '/select?thread_id=a',
    '/access', '/access?thread_id=', '/access?thread_id=a&thread_id=b',
    '/access?thread_id=a&target_id=b', '/access?thread_id=%20',
    '/access?thread_id=' + 'a'.repeat(513), '/target?profile_id=a',
    '/target?thread_id=a#fragment', '/targets?thread_id=a',
    '/managed/tabs', '/managed/tabs?profile_id=', '/managed/tabs?profile_id=a&profile_id=b',
    '/extension/tabs?profile_id=a&command=Network.getCookies',
    '/extension/cdp', '/extension/cookies', '/targets/arbitrary',
  ])('rejects undeclared or ambiguous requests: %s', suffix => {
    expect(() => runtimeFlowerPath(base + suffix)).toThrow();
  });

  it('retains bounded private media and existing conversation routes', () => {
    const frame = base + '/private-frame?observer_id=o&viewer_revision=2&thread_id=t&interaction_id=i&frame_id=3';
    expect(runtimeFlowerPath(frame)).toBe(frame);
    expect(runtimeFlowerMethodAllowed(frame, 'GET')).toBe(true);
    expect(runtimeFlowerMethodAllowed(frame, 'POST')).toBe(false);
    expect(() => runtimeFlowerPath(frame + '&frame_id=4')).toThrow();
    expect(runtimeFlowerMethodAllowed('/_redeven_proxy/api/ai/threads/t/pin-position', 'PATCH')).toBe(true);
    expect(runtimeFlowerMethodAllowed('/_redeven_proxy/api/ai/threads/t/pin-position', 'POST')).toBe(false);
    expect(runtimeFlowerMethodAllowed('/_redeven_proxy/api/ai/threads/t?force=true', 'DELETE')).toBe(true);
    expect(runtimeFlowerMethodAllowed('/_redeven_proxy/api/ai/threads/t', 'DELETE')).toBe(false);
    expect(() => runtimeFlowerPath('/_redeven_proxy/api/ai/threads/t?force=false')).toThrow();
  });
});
