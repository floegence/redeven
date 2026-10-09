import { TESSIVEN_RUNTIME_ROUTES } from './runtimeTessivenRoutes';
import { RUNTIME_FLOWER_COMPUTER_MEDIA_PATH, type RuntimeFlowerRequest } from '../shared/runtimeFlowerIPC';
import { runtimeFlowerDeleteQuery } from './runtimeFlowerHTTP';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

type RuntimeFlowerRoute = Readonly<{
  path: string | RegExp;
  methods: readonly RuntimeFlowerRequest['method'][];
  allowsQuery?: (parsed: URL) => boolean;
}>;

const runtimeFlowerNoQuery = (parsed: URL): boolean => parsed.search === '';
const runtimeFlowerLimitQuery = (parsed: URL): boolean => parsed.search === '' || /^\?limit=\d{1,4}$/u.test(parsed.search);
const runtimeFlowerSubagentDetailQuery = (parsed: URL): boolean => parsed.search === ''
  || /^\?after_ordinal=\d+$/u.test(parsed.search)
  || /^\?limit=\d{1,4}$/u.test(parsed.search)
  || /^\?after_ordinal=\d+&limit=\d{1,4}$/u.test(parsed.search)
  || /^\?limit=\d{1,4}&after_ordinal=\d+$/u.test(parsed.search);
const runtimeFlowerTerminalReadQuery = (parsed: URL): boolean => {
	const values = parsed.searchParams.getAll('after_seq');
	return [...parsed.searchParams.keys()].every((key) => key === 'after_seq')
		&& values.length === 1
		&& /^\d{1,18}$/u.test(values[0] ?? '');
};
const runtimeFlowerAttachmentCapabilityQuery = (parsed: URL): boolean => {
  const values = parsed.searchParams.getAll('model_id');
  return [...parsed.searchParams.keys()].every((key) => key === 'model_id')
    && values.length === 1
    && values[0]!.trim().length > 0
    && values[0]!.length <= 512;
};
const runtimeFlowerIdentifierQuery = (key: string) => (parsed: URL): boolean => {
  const values = parsed.searchParams.getAll(key);
  return [...parsed.searchParams.keys()].length === 1 && values.length === 1
    && values[0]!.trim().length > 0 && values[0]!.length <= 512;
};
const runtimeFlowerSkillBrowseQuery = (kind: 'dir' | 'file') => (parsed: URL): boolean => {
  return [...parsed.searchParams.keys()].length === 2
    && parsed.searchParams.getAll('skill_path').length === 1
    && Boolean(parsed.searchParams.get('skill_path'))
    && parsed.searchParams.getAll(kind).length === 1
    && [...parsed.searchParams.values()].every(value => value.length <= 8192);
};
const RUNTIME_FLOWER_ROUTES: readonly RuntimeFlowerRoute[] = [
  ...TESSIVEN_RUNTIME_ROUTES,
  { path: '/_redeven_proxy/api/ai/mcp', methods: ['GET', 'PUT', 'DELETE'] },
  { path: '/_redeven_proxy/api/ai/mcp/check', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/skills', methods: ['GET', 'POST', 'DELETE'] },
  { path: '/_redeven_proxy/api/ai/skills/sources', methods: ['GET'] },
  { path: '/_redeven_proxy/api/ai/skills/reload', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/skills/toggles', methods: ['PUT'] },
  { path: '/_redeven_proxy/api/ai/skills/reinstall', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/skills/import/github', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/skills/import/github/validate', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/skills/browse/tree', methods: ['GET'], allowsQuery: runtimeFlowerSkillBrowseQuery('dir') },
  { path: '/_redeven_proxy/api/ai/skills/browse/file', methods: ['GET'], allowsQuery: runtimeFlowerSkillBrowseQuery('file') },
  { path: '/_redeven_proxy/api/settings', methods: ['GET'] },
  { path: '/_redeven_proxy/api/fs/path_context', methods: ['GET'] },
  { path: '/_redeven_proxy/api/fs/list', methods: ['POST'] },
  { path: '/_redeven_proxy/api/fs/file', methods: ['GET'], allowsQuery: parsed => {
    return [...parsed.searchParams.keys()].length === 2
      && parsed.searchParams.getAll('path').length === 1
      && Boolean(parsed.searchParams.get('path'))
      && (parsed.searchParams.get('path')?.length ?? 0) <= 8192
      && parsed.searchParams.getAll('preview').length === 1
      && parsed.searchParams.get('preview') === '1';
  } },
  { path: '/_redeven_proxy/api/ai/default_permission', methods: ['PUT'] },
  { path: '/_redeven_proxy/api/ai/computer_use', methods: ['PUT'] },
  { path: '/_redeven_proxy/api/ai/computer/environment', methods: ['GET'] },
  { path: '/_redeven_proxy/api/ai/computer/managed/browser', methods: ['GET', 'PUT', 'POST'] },
  { path: '/_redeven_proxy/api/ai/computer/candidates', methods: ['GET'], allowsQuery: runtimeFlowerIdentifierQuery('thread_id') },
  { path: '/_redeven_proxy/api/ai/computer/candidates', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/computer/reveal', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/computer/select', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/computer/targets', methods: ['GET'] },
  { path: '/_redeven_proxy/api/ai/computer/tabs', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/computer/disconnect', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/computer/target', methods: ['GET'], allowsQuery: runtimeFlowerIdentifierQuery('thread_id') },
  { path: '/_redeven_proxy/api/ai/computer/target', methods: ['PUT'] },
  { path: '/_redeven_proxy/api/ai/computer/access', methods: ['GET', 'PUT'], allowsQuery: runtimeFlowerIdentifierQuery('thread_id') },
  { path: '/_redeven_proxy/api/ai/computer/managed/profiles', methods: ['GET', 'POST'] },
  { path: '/_redeven_proxy/api/ai/computer/managed/tabs', methods: ['GET'], allowsQuery: runtimeFlowerIdentifierQuery('profile_id') },
  { path: '/_redeven_proxy/api/ai/computer/extension/open', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/computer/extension/setup', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/computer/extension/status', methods: ['GET'] },
  { path: '/_redeven_proxy/api/ai/computer/extension/tabs', methods: ['GET'], allowsQuery: runtimeFlowerIdentifierQuery('profile_id') },
  { path: '/_redeven_proxy/api/ai/computer/connect', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/computer/view', methods: ['PUT'] },
  { path: '/_redeven_proxy/api/ai/computer/input', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/computer/private-frame', methods: ['GET'], allowsQuery: (parsed) => {
    const keys = ['observer_id', 'viewer_revision', 'thread_id', 'interaction_id', 'frame_id'];
    return [...parsed.searchParams.keys()].length === keys.length && keys.every(key => parsed.searchParams.getAll(key).length === 1 && Boolean(parsed.searchParams.get(key)))
      && /^\d+$/u.test(parsed.searchParams.get('viewer_revision')!) && /^\d+$/u.test(parsed.searchParams.get('frame_id')!);
  } },
  { path: RUNTIME_FLOWER_COMPUTER_MEDIA_PATH, methods: ['GET'] },
  { path: '/_redeven_proxy/api/ai/provider_bundle', methods: ['PUT'] },
  { path: '/_redeven_proxy/api/ai/current_model', methods: ['PUT'] },
  { path: '/_redeven_proxy/api/ai/models', methods: ['GET'], allowsQuery: parsed => parsed.search === '' || parsed.search === '?mode=baseline' },
  { path: '/_redeven_proxy/api/ai/model_catalog', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/storage-generation', methods: ['GET'] },
  { path: '/_redeven_proxy/api/ai/turns', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/attachments/capabilities', methods: ['GET'], allowsQuery: runtimeFlowerAttachmentCapabilityQuery },
  { path: '/_redeven_proxy/api/ai/upload-staging-scopes', methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/upload-staging-scopes\/[^/]+$/u, methods: ['DELETE'] },
  { path: '/_redeven_proxy/api/ai/uploads', methods: ['POST'] },
  { path: '/_redeven_proxy/api/ai/threads', methods: ['GET', 'POST'], allowsQuery: runtimeFlowerLimitQuery },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+$/u, methods: ['GET', 'PATCH'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+$/u, methods: ['DELETE'], allowsQuery: runtimeFlowerDeleteQuery },
  { path: '/_redeven_proxy/api/ai/flower/stream', methods: ['GET'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/subagents\/[^/]+\/detail$/u, methods: ['GET'], allowsQuery: runtimeFlowerSubagentDetailQuery },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/read$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/turns$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/fork$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/input_response$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/approvals$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/pin-position$/u, methods: ['PATCH'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/queue\/order$/u, methods: ['PATCH'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/queue\/[^/]+$/u, methods: ['DELETE'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/queue\/[^/]+\/promote$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/retry$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/threads\/[^/]+\/cancel$/u, methods: ['POST'] },
  { path: /^\/_redeven_proxy\/api\/ai\/runs\/[^/]+\/terminal\/[^/]+\/read$/u, methods: ['GET'], allowsQuery: runtimeFlowerTerminalReadQuery },
  { path: /^\/_redeven_proxy\/api\/ai\/uploads\/[^/]+$/u, methods: ['GET', 'DELETE'] },
  { path: /^\/_redeven_proxy\/api\/ai\/uploads\/[^/]+\/long_text$/u, methods: ['GET'] },
];

function runtimeFlowerRouteMatches(route: RuntimeFlowerRoute, parsed: URL): boolean {
  const pathMatches = typeof route.path === 'string' ? parsed.pathname === route.path : route.path.test(parsed.pathname);
  return pathMatches && (route.allowsQuery ?? runtimeFlowerNoQuery)(parsed);
}

function runtimeFlowerAllowedRoute(parsed: URL): RuntimeFlowerRoute | null {
  return RUNTIME_FLOWER_ROUTES.find((route) => runtimeFlowerRouteMatches(route, parsed)) ?? null;
}

export function runtimeFlowerPath(rawPath: unknown): string {
  const raw = compact(rawPath);
  if (!raw.startsWith('/')) {
    throw new Error('Flower runtime request path must be absolute.');
  }
  const parsed = new URL(raw, 'http://runtime-flower.local');
  if (parsed.origin !== 'http://runtime-flower.local' || parsed.hash || !runtimeFlowerAllowedRoute(parsed)) {
    throw new Error('Flower runtime request path is not allowed.');
  }
  return `${parsed.pathname}${parsed.search}`;
}

export function runtimeFlowerMethodAllowed(path: string, method: RuntimeFlowerRequest['method']): boolean {
  const parsed = new URL(path, 'http://runtime-flower.local');
  const route = runtimeFlowerAllowedRoute(parsed);
  return !!route && route.methods.includes(method);
}

export function runtimeFlowerMethod(rawMethod: unknown): RuntimeFlowerRequest['method'] {
  const method = compact(rawMethod).toUpperCase();
  switch (method) {
    case 'GET':
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
      return method;
    default:
      throw new Error('Flower runtime request method is not allowed.');
  }
}
