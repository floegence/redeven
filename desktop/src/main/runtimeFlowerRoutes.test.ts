import { describe, expect, it } from 'vitest';
import type { RuntimeFlowerRequestMethod } from '../shared/runtimeFlowerIPC';
import { runtimeFlowerMethodAllowed, runtimeFlowerPath } from './runtimeFlowerRoutes';

const base = '/_redeven_proxy/api/ai/computer';

describe('Desktop computer management routes', () => {
  it('allows bounded file previews with exactly one path and the inert preview flag', () => {
    const path = '/_redeven_proxy/api/fs/file?path=%2Fproject%2Freport.html&preview=1';
    expect(runtimeFlowerPath(path)).toBe(path);
    expect(runtimeFlowerMethodAllowed(path, 'GET')).toBe(true);
    expect(runtimeFlowerMethodAllowed(path, 'POST')).toBe(false);
    for (const suffix of ['?path=x', '?path=x&preview=0', '?path=x&preview=1&preview=1', '?path=x&preview=1&secret=y']) {
      expect(() => runtimeFlowerPath('/_redeven_proxy/api/fs/file' + suffix)).toThrow();
    }
  });
  it.each<[string, RuntimeFlowerRequestMethod[]]>([
    ['/environment', ['GET']], ['/candidates', ['POST']], ['/candidates?thread_id=thread-1', ['GET']], ['/select', ['POST']], ['/reveal', ['POST']],
    ['/targets', ['GET']], ['/tabs', ['POST']], ['/disconnect', ['POST']],
    ['/target?thread_id=thread-1', ['GET']], ['/target', ['PUT']],
    ['/access?thread_id=thread-1', ['GET', 'PUT']],
    ['/managed/browser', ['GET', 'PUT', 'POST']],
    ['/managed/profiles', ['GET', 'POST']], ['/managed/tabs?profile_id=profile-1', ['GET']],
    ['/extension/setup', ['POST']], ['/extension/open', ['POST']], ['/extension/status', ['GET']],
    ['/extension/tabs?profile_id=profile-1', ['GET']],
  ])('admits %s only through its declared methods', (suffix, methods) => {
    const path = base + suffix;
    expect(runtimeFlowerPath(path)).toBe(path);
    for (const method of ['GET', 'PUT', 'POST', 'PATCH', 'DELETE'] as const) {
      expect(runtimeFlowerMethodAllowed(path, method)).toBe(methods.includes(method));
    }
  });

  it.each([
    '/environment?thread_id=a', '/candidates?thread_id=', '/candidates?thread_id=a&thread_id=b', '/candidates?thread_id=a&cdp_url=x', '/select?thread_id=a', '/reveal?target_id=a',
    '/access', '/access?thread_id=', '/access?thread_id=a&thread_id=b',
    '/access?thread_id=a&target_id=b', '/access?thread_id=%20',
    '/access?thread_id=' + 'a'.repeat(513), '/target?profile_id=a',
    '/target?thread_id=a#fragment', '/targets?thread_id=a',
    '/managed/browser?source=upload', '/managed/browser/chunk',
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


describe('Flower extensions management routes', () => {
  it.each<[string, RuntimeFlowerRequestMethod[]]>([
    ['mcp', ['GET', 'PUT', 'DELETE']], ['mcp/check', ['POST']],
    ['skills', ['GET', 'POST', 'DELETE']], ['skills/sources', ['GET']], ['skills/reload', ['POST']],
    ['skills/toggles', ['PUT']], ['skills/reinstall', ['POST']], ['skills/import/github', ['POST']], ['skills/import/github/validate', ['POST']],
    ['skills/browse/tree?skill_path=%2Fskills%2Freview&dir=', ['GET']], ['skills/browse/file?skill_path=%2Fskills%2Freview&file=SKILL.md', ['GET']],
  ])('allows only the declared methods for %s', (suffix, methods) => {
    const path = '/_redeven_proxy/api/ai/' + suffix;
    expect(runtimeFlowerPath(path)).toBe(path);
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) expect(runtimeFlowerMethodAllowed(path, method)).toBe(methods.includes(method));
  });
  it.each(['mcp?secret=x', 'mcp/arbitrary', 'skills/browse/tree?skill_path=x&dir=&dir=y', 'skills/browse/file?skill_path=x&file=y&encoding=base64', 'skills/browse/file?file=x', 'skills/browse/tree?skill_path=&dir=', 'skills/browse/tree?skill_path=x&dir=' + 'x'.repeat(8193)])('rejects undeclared extension paths and queries: %s', suffix => {
    expect(() => runtimeFlowerPath('/_redeven_proxy/api/ai/' + suffix)).toThrow();
  });
});
