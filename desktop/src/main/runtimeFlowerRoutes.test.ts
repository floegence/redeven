import { describe, expect, it } from 'vitest';
import type { RuntimeFlowerRequestMethod } from '../shared/runtimeFlowerIPC';
import { isRuntimeFlowerReadinessPath, runtimeFlowerMethodAllowed, runtimeFlowerPath } from './runtimeFlowerRoutes';

const base = '/_redeven_proxy/api/ai/computer';

it('allows only read-only, single-origin source icon requests', () => {
  const path = '/_redeven_proxy/api/flower/source-icon?origin=https%3A%2F%2Fexample.com';
  expect(runtimeFlowerPath(path)).toBe(path);
  expect(runtimeFlowerMethodAllowed(path, 'GET')).toBe(true);
  expect(runtimeFlowerMethodAllowed(path, 'POST')).toBe(false);
  for (const suffix of ['', '?origin=', '?origin=a&origin=b', '?origin=a&extra=1']) {
    expect(() => runtimeFlowerPath('/_redeven_proxy/api/flower/source-icon' + suffix)).toThrow();
  }
});

describe('Flower admitted attachment preview routes', () => {
  const upload = '/_redeven_proxy/api/ai/uploads/upl_preview';
  it.each(['turn_id=turn_1', 'queue_id=queue%3Arequest-second'])('allows scoped GET previews: %s', scope => {
    const path = `${upload}?thread_id=thread_1&${scope}&preview=1`;
    expect(runtimeFlowerPath(path)).toBe(path);
    expect(runtimeFlowerMethodAllowed(path, 'GET')).toBe(true);
    expect(runtimeFlowerMethodAllowed(path, 'DELETE')).toBe(false);
  });
  it.each([
    'preview=1', 'thread_id=thread_1&preview=1', 'thread_id=thread_1&turn_id=turn_1',
    'thread_id=thread_1&turn_id=turn_1&queue_id=queue_1&preview=1',
    'thread_id=thread_1&turn_id=turn_1&preview=1&preview=1',
    'thread_id=thread_1&thread_id=thread_2&turn_id=turn_1&preview=1',
    'thread_id=thread_1&turn_id=turn_1&preview=0',
    'thread_id=thread_1&turn_id=turn_1&preview=1&secret=x',
    'thread_id=thread_1&queue_id=&preview=1',
    'thread_id=thread_1&queue_id=queue%3Arequest%0Asecond&preview=1',
  ])('rejects incomplete or ambiguous preview scope: %s', query => {
    expect(() => runtimeFlowerPath(`${upload}?${query}`)).toThrow();
  });
});

describe('Flower model directory routes', () => {
  it.each(['', '?mode=baseline'])('allows a read-only directory query: %s', query => {
    const path = '/_redeven_proxy/api/ai/models' + query;
    expect(runtimeFlowerPath(path)).toBe(path);
    expect(runtimeFlowerMethodAllowed(path, 'GET')).toBe(true);
    expect(runtimeFlowerMethodAllowed(path, 'POST')).toBe(false);
  });
  it.each(['?mode=full', '?mode=baseline&mode=baseline', '?mode=baseline&secret=x', '?mode=%62aseline', '?other=x'])('rejects an unsupported directory query: %s', query => {
    expect(() => runtimeFlowerPath('/_redeven_proxy/api/ai/models' + query)).toThrow();
  });
});

describe('Desktop computer management routes', () => {
  it('bounds browser installation to declared methods without queries or child routes', () => {
    const path = '/_redeven_proxy/api/browser/installation';
    expect(runtimeFlowerPath(path)).toBe(path);
    for (const method of ['GET', 'PUT', 'POST', 'PATCH', 'DELETE'] as const) {
      expect(runtimeFlowerMethodAllowed(path, method)).toBe(['GET', 'PUT', 'POST'].includes(method));
    }
    for (const suffix of ['?source=upload', '/chunk', '#fragment']) expect(() => runtimeFlowerPath(path + suffix)).toThrow();
  });

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

describe('Independent context compaction route', () => {
  it('allows only the exact POST path', () => {
    const path = '/_redeven_proxy/api/ai/threads/thread-1/context/compact';
    expect(runtimeFlowerPath(path)).toBe(path);
    expect(runtimeFlowerMethodAllowed(path, 'POST')).toBe(true);
    expect(runtimeFlowerMethodAllowed(path, 'GET')).toBe(false);
    for (const suffix of ['/extra', '?force=true', '/']) expect(() => runtimeFlowerPath(path + suffix)).toThrow();
  });
});


describe('Local account lifecycle routes', () => {
  it('admits only the read-only status and explicit retry actions', () => {
    const accounts = '/_redeven_proxy/api/ai/auth/chatgpt/accounts';
    const retry = '/_redeven_proxy/api/ai/auth/chatgpt/retry';
    expect(runtimeFlowerPath(accounts)).toBe(accounts);
    expect(runtimeFlowerMethodAllowed(accounts, 'GET')).toBe(true);
    expect(runtimeFlowerMethodAllowed(accounts, 'POST')).toBe(false);
    expect(runtimeFlowerMethodAllowed(retry, 'POST')).toBe(true);
    expect(runtimeFlowerMethodAllowed(retry, 'GET')).toBe(false);
    for (const path of [accounts + '?token=x', accounts + '/x', retry + '?account_id=x']) expect(() => runtimeFlowerPath(path)).toThrow();
  });
});

it('allows exact queue edit and canonical reference commands only through declared methods', () => {
  for (const [path, method] of [
    ['/_redeven_proxy/api/ai/threads/thread/queue/queue%3Afirst', 'PATCH'],
    ['/_redeven_proxy/api/ai/threads/thread/reference-open-target', 'POST'],
  ] as const) {
    expect(runtimeFlowerPath(path)).toBe(path);
    expect(runtimeFlowerMethodAllowed(path, method)).toBe(true);
    expect(runtimeFlowerMethodAllowed(path, 'PUT')).toBe(false);
    expect(() => runtimeFlowerPath(path + '?path=arbitrary')).toThrow();
  }
});


it('allows parent-scoped child input only through the exact POST route', () => {
  const path = '/_redeven_proxy/api/ai/threads/parent/subagents/child/input';
  expect(runtimeFlowerMethodAllowed(path, 'POST')).toBe(true);
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE'] as const) expect(runtimeFlowerMethodAllowed(path, method)).toBe(false);
  for (const suffix of ['?force=true', '/extra', '/']) expect(() => runtimeFlowerPath(path + suffix)).toThrow();
});

it('allows full event reads only through the recipient POST route', () => {
 const path = '/_redeven_proxy/api/ai/threads/parent/subagent-events';
 expect(runtimeFlowerMethodAllowed(path, 'POST')).toBe(true);
 for (const method of ['GET', 'PUT', 'PATCH', 'DELETE'] as const) expect(runtimeFlowerMethodAllowed(path, method)).toBe(false);
 for (const suffix of ['?target=other', '/extra', '/']) expect(() => runtimeFlowerPath(path + suffix)).toThrow();
});


it('restricts readiness control to exact routes and methods without queries', () => {
  for (const suffix of ['', '/stop', '/retry']) {
    const path = '/_redeven_proxy/api/ai/readiness' + suffix;
    expect(isRuntimeFlowerReadinessPath(path)).toBe(true);
    expect(runtimeFlowerPath(path)).toBe(path);
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      expect(runtimeFlowerMethodAllowed(path, method)).toBe(method === (suffix ? 'POST' : 'GET'));
    }
    expect(() => runtimeFlowerPath(path + '?extra=1')).toThrow();
    expect(isRuntimeFlowerReadinessPath(path + '?extra=1')).toBe(false);
    expect(isRuntimeFlowerReadinessPath(path + '/unknown')).toBe(false);
  }
});
