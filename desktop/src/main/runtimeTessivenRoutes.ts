// These routes share the local Runtime transport, never a renderer-supplied host.
export const TESSIVEN_RUNTIME_BASE = '/_redeven_proxy/api/tessiven';
const canvas = '[A-Za-z0-9][A-Za-z0-9_.-]{0,127}';
const noQuery = (url: URL) => url.search === '';
const query =
  (allowed: Record<string, (value: string) => boolean>) => (url: URL) =>
    [...url.searchParams.keys()].every(
      (key) =>
        key in allowed &&
        url.searchParams.getAll(key).length === 1 &&
        allowed[key]!(url.searchParams.get(key)!),
    );
export const TESSIVEN_RUNTIME_ROUTES = [
  {
    path: `${TESSIVEN_RUNTIME_BASE}/schema`,
    methods: ['GET'],
    allowsQuery: noQuery,
  },
  {
    path: `${TESSIVEN_RUNTIME_BASE}/validate`,
    methods: ['POST'],
    allowsQuery: noQuery,
  },
  {
    path: `${TESSIVEN_RUNTIME_BASE}/resources`,
    methods: ['POST'],
    allowsQuery: noQuery,
  },
  {
    path: `${TESSIVEN_RUNTIME_BASE}/events`,
    methods: ['GET'],
    allowsQuery: noQuery,
  },
  {
    path: `${TESSIVEN_RUNTIME_BASE}/canvases`,
    methods: ['GET', 'POST'],
    allowsQuery: query({
      query: (value) => value.length <= 512,
      cursor: (value) => value.length <= 128,
      archived: (value) => value === 'true' || value === 'false',
    }),
  },
  {
    path: new RegExp(`^${TESSIVEN_RUNTIME_BASE}/canvases/${canvas}$`),
    methods: ['GET'],
    allowsQuery: noQuery,
  },
  {
    path: new RegExp(`^${TESSIVEN_RUNTIME_BASE}/canvases/${canvas}/versions$`),
    methods: ['GET', 'POST'],
    allowsQuery: query({ before: (value) => /^[1-9][0-9]{0,14}$/.test(value) }),
  },
  {
    path: new RegExp(
      `^${TESSIVEN_RUNTIME_BASE}/canvases/${canvas}/versions/(latest|[1-9][0-9]{0,14})$`,
    ),
    methods: ['GET'],
    allowsQuery: noQuery,
  },
  {
    path: new RegExp(
      `^${TESSIVEN_RUNTIME_BASE}/canvases/${canvas}/(rename|duplicate|restore|archive)$`,
    ),
    methods: ['POST'],
    allowsQuery: noQuery,
  },
] as const;
export const isTessivenRuntimePath = (path: string) =>
  path.startsWith(`${TESSIVEN_RUNTIME_BASE}/`);
