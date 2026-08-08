export type FlowerComposerReferenceKind = 'file' | 'directory';

export type FlowerComposerReferenceCandidate = Readonly<{
  kind: FlowerComposerReferenceKind;
  label: string;
  path: string;
  relativeParent: string;
}>;

export type FlowerComposerReferenceDirectoryEntry = Readonly<{
  name: string;
  path: string;
  isDirectory: boolean;
}>;

export type FlowerComposerReferenceIndexLimits = Readonly<{
  maxDepth: number;
  maxDirectories: number;
  maxCandidates: number;
  maxEntriesPerDirectory: number;
  maxPathLength: number;
  maxResults: number;
}>;

export type FlowerComposerReferenceSearchInput = Readonly<{
  cacheKey: string;
  rootPath: string;
  query: string;
}>;

type SearchIdentity = Readonly<{
  cacheKey: string;
  rootPath: string;
}>;

export type FlowerComposerReferenceSearchState =
  | Readonly<{ status: 'idle'; generation: number }>
  | Readonly<{
    status: 'loading';
    generation: number;
    input: FlowerComposerReferenceSearchInput;
    candidates: readonly FlowerComposerReferenceCandidate[];
  }>
  | Readonly<{
    status: 'ready' | 'empty';
    generation: number;
    input: FlowerComposerReferenceSearchInput;
    candidates: readonly FlowerComposerReferenceCandidate[];
  }>
  | Readonly<{
    status: 'error';
    generation: number;
    input: FlowerComposerReferenceSearchInput;
    candidates: readonly FlowerComposerReferenceCandidate[];
    error: unknown;
  }>;

export type FlowerComposerReferenceIndexController = Readonly<{
  current: () => FlowerComposerReferenceSearchState;
  search: (
    input: FlowerComposerReferenceSearchInput,
  ) => Promise<FlowerComposerReferenceSearchState | undefined>;
  invalidate: (cacheKey?: string) => void;
  softAbort: () => void;
  dispose: () => void;
}>;

const DEFAULT_LIMITS: FlowerComposerReferenceIndexLimits = {
  maxDepth: 8,
  maxDirectories: 256,
  maxCandidates: 2_000,
  maxEntriesPerDirectory: 500,
  maxPathLength: 4_096,
  maxResults: 12,
};

const DEFAULT_SKIP_DIRECTORY_NAMES = new Set([
  '.git',
  '.cache',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);

type CacheEntry = Readonly<{
  candidates: readonly FlowerComposerReferenceCandidate[];
  expiresAt: number;
}>;

type ScanControl = {
  aborted: boolean;
};

type InflightScan = Readonly<{
  identity: SearchIdentity;
  control: ScanControl;
  promise: Promise<readonly FlowerComposerReferenceCandidate[] | undefined>;
}>;

function positiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return fallback;
  return Math.max(1, Math.trunc(value!));
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || (value ?? -1) < 0) return fallback;
  return Math.max(0, Math.trunc(value!));
}

function normalizeLimits(
  input: Partial<FlowerComposerReferenceIndexLimits> | undefined,
): FlowerComposerReferenceIndexLimits {
  return {
    maxDepth: nonNegativeInteger(input?.maxDepth, DEFAULT_LIMITS.maxDepth),
    maxDirectories: positiveInteger(input?.maxDirectories, DEFAULT_LIMITS.maxDirectories),
    maxCandidates: positiveInteger(input?.maxCandidates, DEFAULT_LIMITS.maxCandidates),
    maxEntriesPerDirectory: positiveInteger(
      input?.maxEntriesPerDirectory,
      DEFAULT_LIMITS.maxEntriesPerDirectory,
    ),
    maxPathLength: positiveInteger(input?.maxPathLength, DEFAULT_LIMITS.maxPathLength),
    maxResults: positiveInteger(input?.maxResults, DEFAULT_LIMITS.maxResults),
  };
}

export function normalizeFlowerComposerReferencePath(value: string): string {
  const slashPath = value.trim().replace(/\\/gu, '/');
  if (!slashPath) return '';
  const drive = slashPath.match(/^[A-Za-z]:/u)?.[0] ?? '';
  const absolute = slashPath.startsWith('/') || Boolean(drive);
  const remainder = drive ? slashPath.slice(drive.length) : slashPath;
  const parts: string[] = [];
  for (const part of remainder.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  const prefix = drive ? `${drive}/` : absolute ? '/' : '';
  const normalized = prefix + parts.join('/');
  if (normalized === '' && absolute) return prefix;
  if (normalized === `${drive}/`) return normalized;
  return normalized.replace(/\/$/u, '') || '/';
}

function pathName(path: string): string {
  const normalized = normalizeFlowerComposerReferencePath(path);
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function joinPath(parent: string, child: string): string {
  return normalizeFlowerComposerReferencePath(`${parent.replace(/[\\/]$/u, '')}/${child}`);
}

function isWithinRoot(path: string, rootPath: string): boolean {
  return path === rootPath || path.startsWith(`${rootPath.replace(/\/$/u, '')}/`);
}

function relativePath(path: string, rootPath: string): string {
  if (path === rootPath) return '';
  return path.slice(rootPath.replace(/\/$/u, '').length + 1);
}

function parentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '' : path.slice(0, index);
}

function candidateKey(candidate: FlowerComposerReferenceCandidate): string {
  return `${candidate.kind}:${candidate.path}`;
}

function compareStable(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function fuzzySubsequenceScore(value: string, query: string): number | undefined {
  let queryIndex = 0;
  let first = -1;
  let last = -1;
  let gaps = 0;
  for (let index = 0; index < value.length && queryIndex < query.length; index += 1) {
    if (value[index] !== query[queryIndex]) continue;
    if (first === -1) first = index;
    if (last !== -1) gaps += index - last - 1;
    last = index;
    queryIndex += 1;
  }
  if (queryIndex !== query.length) return undefined;
  return (first < 0 ? 0 : first) + gaps + Math.max(0, value.length - query.length);
}

type RankedCandidate = Readonly<{
  candidate: FlowerComposerReferenceCandidate;
  matchRank: number;
  matchScore: number;
  depth: number;
  stablePath: string;
}>;

function rankCandidate(
  candidate: FlowerComposerReferenceCandidate,
  query: string,
  rootPath: string,
): RankedCandidate | undefined {
  const label = candidate.label.toLowerCase();
  const relative = relativePath(candidate.path, rootPath).toLowerCase();
  const normalizedQuery = query.trim().replace(/\\/gu, '/').toLowerCase();
  const depth = relative ? relative.split('/').length : 0;
  const stablePath = `${relative}\u0000${candidate.kind}`;

  if (!normalizedQuery) {
    return { candidate, matchRank: 0, matchScore: 0, depth, stablePath };
  }
  if (label === normalizedQuery) {
    return { candidate, matchRank: 0, matchScore: 0, depth, stablePath };
  }
  if (label.startsWith(normalizedQuery)) {
    return {
      candidate,
      matchRank: 1,
      matchScore: label.length - normalizedQuery.length,
      depth,
      stablePath,
    };
  }
  const labelIndex = label.indexOf(normalizedQuery);
  if (labelIndex !== -1) {
    return { candidate, matchRank: 2, matchScore: labelIndex, depth, stablePath };
  }
  const pathScore = fuzzySubsequenceScore(relative, normalizedQuery);
  if (pathScore === undefined) return undefined;
  return { candidate, matchRank: 3, matchScore: pathScore, depth, stablePath };
}

export function rankFlowerComposerReferenceCandidates(
  candidates: readonly FlowerComposerReferenceCandidate[],
  query: string,
  rootPath: string,
  maxResults = DEFAULT_LIMITS.maxResults,
): readonly FlowerComposerReferenceCandidate[] {
  const normalizedRoot = normalizeFlowerComposerReferencePath(rootPath);
  return candidates
    .map((candidate) => rankCandidate(candidate, query, normalizedRoot))
    .filter((candidate): candidate is RankedCandidate => Boolean(candidate))
    .sort((left, right) => (
      left.matchRank - right.matchRank
      || left.matchScore - right.matchScore
      || left.depth - right.depth
      || compareStable(left.stablePath, right.stablePath)
    ))
    .slice(0, positiveInteger(maxResults, DEFAULT_LIMITS.maxResults))
    .map((ranked) => ranked.candidate);
}

async function scanReferenceCandidates(args: {
  rootPath: string;
  listDirectory: (
    path: string,
  ) => Promise<readonly FlowerComposerReferenceDirectoryEntry[]>;
  limits: FlowerComposerReferenceIndexLimits;
  skipDirectoryNames: ReadonlySet<string>;
  control: ScanControl;
}): Promise<readonly FlowerComposerReferenceCandidate[]> {
  const rootPath = normalizeFlowerComposerReferencePath(args.rootPath);
  if (!rootPath) throw new Error('Flower reference search requires a working directory.');
  const queue: Array<Readonly<{ path: string; depth: number }>> = [{ path: rootPath, depth: 0 }];
  const visited = new Set<string>();
  const candidates = new Map<string, FlowerComposerReferenceCandidate>();
  let listedDirectories = 0;

  while (
    queue.length > 0
    && listedDirectories < args.limits.maxDirectories
    && candidates.size < args.limits.maxCandidates
    && !args.control.aborted
  ) {
    const directory = queue.shift();
    if (!directory || visited.has(directory.path)) continue;
    visited.add(directory.path);
    listedDirectories += 1;

    let entries: readonly FlowerComposerReferenceDirectoryEntry[];
    try {
      entries = await args.listDirectory(directory.path);
    } catch (error) {
      if (directory.depth === 0) throw error;
      continue;
    }
    if (args.control.aborted) return [];

    const ordered = Array.from(entries ?? [])
      .slice(0, args.limits.maxEntriesPerDirectory)
      .sort((left, right) => (
        compareStable(String(left.name), String(right.name))
        || compareStable(String(left.path), String(right.path))
      ));

    for (const entry of ordered) {
      if (candidates.size >= args.limits.maxCandidates) break;
      const fallbackName = String(entry.name ?? '').trim();
      const rawPath = String(entry.path ?? '').trim();
      const normalizedPath = normalizeFlowerComposerReferencePath(
        rawPath || joinPath(directory.path, fallbackName),
      );
      const name = pathName(normalizedPath);
      if (
        !name
        || normalizedPath.length > args.limits.maxPathLength
        || !isWithinRoot(normalizedPath, rootPath)
        || normalizedPath === directory.path
      ) {
        continue;
      }

      const kind: FlowerComposerReferenceKind = entry.isDirectory ? 'directory' : 'file';
      if (kind === 'directory' && args.skipDirectoryNames.has(name.toLowerCase())) continue;
      if (kind === 'directory' && visited.has(normalizedPath)) continue;
      const relative = relativePath(normalizedPath, rootPath);
      const candidate: FlowerComposerReferenceCandidate = {
        kind,
        label: name,
        path: normalizedPath,
        relativeParent: parentPath(relative),
      };
      candidates.set(candidateKey(candidate), candidate);

      if (
        kind === 'directory'
        && directory.depth < args.limits.maxDepth
        && !visited.has(normalizedPath)
      ) {
        queue.push({ path: normalizedPath, depth: directory.depth + 1 });
      }
    }
  }

  return Array.from(candidates.values());
}

function sameIdentity(left: SearchIdentity, right: SearchIdentity): boolean {
  return left.cacheKey === right.cacheKey && left.rootPath === right.rootPath;
}

function searchInputIdentity(input: FlowerComposerReferenceSearchInput): SearchIdentity {
  return {
    cacheKey: input.cacheKey,
    rootPath: normalizeFlowerComposerReferencePath(input.rootPath),
  };
}

export function createFlowerComposerReferenceIndex(args: {
  listDirectory: (
    path: string,
  ) => Promise<readonly FlowerComposerReferenceDirectoryEntry[]>;
  ttlMs?: number;
  limits?: Partial<FlowerComposerReferenceIndexLimits>;
  skipDirectoryNames?: readonly string[];
  now?: () => number;
  onStateChange?: (state: FlowerComposerReferenceSearchState) => void;
}): FlowerComposerReferenceIndexController {
  const limits = normalizeLimits(args.limits);
  const ttlMs = positiveInteger(args.ttlMs, 15_000);
  const now = args.now ?? Date.now;
  const skipDirectoryNames = new Set(
    (args.skipDirectoryNames ?? Array.from(DEFAULT_SKIP_DIRECTORY_NAMES))
      .map((name) => name.toLowerCase()),
  );
  const cache = new Map<string, CacheEntry>();
  let inflight: InflightScan | undefined;
  let generation = 0;
  let disposed = false;
  let activeIdentity: SearchIdentity | undefined;
  let state: FlowerComposerReferenceSearchState = { status: 'idle', generation };

  const cacheID = (identity: SearchIdentity) => `${identity.cacheKey}\u0000${identity.rootPath}`;
  const publish = (next: FlowerComposerReferenceSearchState) => {
    state = next;
    args.onStateChange?.(next);
    return next;
  };
  const abortInflight = () => {
    if (inflight) inflight.control.aborted = true;
    inflight = undefined;
  };

  const search = async (
    input: FlowerComposerReferenceSearchInput,
  ): Promise<FlowerComposerReferenceSearchState | undefined> => {
    if (disposed) return undefined;
    const requestGeneration = ++generation;
    const normalizedInput = {
      ...input,
      rootPath: normalizeFlowerComposerReferencePath(input.rootPath),
    };
    const identity = searchInputIdentity(normalizedInput);
    if (activeIdentity && !sameIdentity(activeIdentity, identity)) abortInflight();
    activeIdentity = identity;

    const id = cacheID(identity);
    const cached = cache.get(id);
    if (cached && cached.expiresAt > now()) {
      const candidates = rankFlowerComposerReferenceCandidates(
        cached.candidates,
        normalizedInput.query,
        normalizedInput.rootPath,
        limits.maxResults,
      );
      return publish({
        status: candidates.length > 0 ? 'ready' : 'empty',
        generation: requestGeneration,
        input: normalizedInput,
        candidates,
      });
    }
    if (cached) cache.delete(id);

    publish({
      status: 'loading',
      generation: requestGeneration,
      input: normalizedInput,
      candidates: state.status !== 'idle' ? state.candidates : [],
    });

    if (!inflight || !sameIdentity(inflight.identity, identity)) {
      const control: ScanControl = { aborted: false };
      const promise = scanReferenceCandidates({
        rootPath: identity.rootPath,
        listDirectory: args.listDirectory,
        limits,
        skipDirectoryNames,
        control,
      }).then((candidates) => {
        if (!control.aborted) {
          cache.set(id, { candidates, expiresAt: now() + ttlMs });
        }
        return control.aborted ? undefined : candidates;
      });
      inflight = { identity, control, promise };
    }

    const requestScan = inflight;
    try {
      const scanned = await requestScan.promise;
      if (
        disposed
        || requestGeneration !== generation
        || !activeIdentity
        || !sameIdentity(activeIdentity, identity)
        || !scanned
      ) {
        return undefined;
      }
      const candidates = rankFlowerComposerReferenceCandidates(
        scanned,
        normalizedInput.query,
        normalizedInput.rootPath,
        limits.maxResults,
      );
      return publish({
        status: candidates.length > 0 ? 'ready' : 'empty',
        generation: requestGeneration,
        input: normalizedInput,
        candidates,
      });
    } catch (error) {
      if (
        disposed
        || requestGeneration !== generation
        || !activeIdentity
        || !sameIdentity(activeIdentity, identity)
        || requestScan.control.aborted
      ) {
        return undefined;
      }
      return publish({
        status: 'error',
        generation: requestGeneration,
        input: normalizedInput,
        candidates: [],
        error,
      });
    } finally {
      if (inflight === requestScan) inflight = undefined;
    }
  };

  const reset = (cacheKey?: string) => {
    generation += 1;
    if (cacheKey === undefined) {
      cache.clear();
      abortInflight();
      activeIdentity = undefined;
    } else {
      for (const key of cache.keys()) {
        if (key.startsWith(`${cacheKey}\u0000`)) cache.delete(key);
      }
      if (inflight?.identity.cacheKey === cacheKey) abortInflight();
      if (activeIdentity?.cacheKey === cacheKey) activeIdentity = undefined;
    }
    publish({ status: 'idle', generation });
  };
  const softAbort = () => {
    generation += 1;
    abortInflight();
    activeIdentity = undefined;
    publish({ status: 'idle', generation });
  };

  return {
    current: () => state,
    search,
    invalidate: reset,
    softAbort,
    dispose: () => {
      disposed = true;
      reset();
    },
  };
}
