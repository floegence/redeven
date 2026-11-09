import { fetchSessionJSON } from '../services/sessionHTTP';
export type FlowNode = {
  id: string;
  title: string;
  kind:
    | 'agent'
    | 'parallel'
    | 'tool'
    | 'condition'
    | 'join'
    | 'render'
    | 'deliver';
  depends_on: string[];
  instruction?: string;
  tool?: string;
  parameters?: unknown;
  items?: { id: string; label: string; data: unknown }[];
  items_from?: string;
  concurrency?: number;
  condition?: { node_id: string; field: string; equals: unknown };
  template?: string;
  join_policy?: 'all' | 'partial';
  minimum_success?: number;
  require_review?: boolean;
  output_schema?: unknown;
};
export type Definition = {
  title: string;
  goal: string;
  model: string;
  working_directory: string;
  nodes: FlowNode[];
  max_concurrent: number;
  timeout_seconds: number;
  allow_partial: boolean;
};
export type Workflow = {
  archived?: boolean;
  plugin?: { work_id: string; request_id: string };
  id: string;
  revision: number;
  published_version: number;
  published_revision?: number;
  definition: Definition;
  created_at: string;
  updated_at: string;
};
export type Contribution = {
  id: string;
  kind: string;
  node_id?: string;
  attempt_id?: string;
  text: string;
  data?: unknown;
  basis: number;
  revision: number;
  invalidated?: boolean;
  created_at: string;
};
export type Attempt = {
  invalidated?: boolean;
  id: string;
  node_id: string;
  item?: { id: string; label: string };
  number: number;
  thread_id?: string;
  state: string;
  error?: string;
  result?: unknown;
  context_revision: number;
};
export type Artifact = {
  invalidated?: boolean;
  id: string;
  node_id: string;
  media_type: string;
  content: string;
  digest: string;
  context_revision: number;
};
export type Run = {
  id: string;
  workflow_id: string;
  definition_version: number;
  definition: Definition;
  status: string;
  revision: number;
  context_revision: number;
  scheduled_at: string;
  attempts: Attempt[];
  contributions: Contribution[];
  artifacts: Artifact[];
};
export type Schedule = {
  version?: number;
  id: string;
  revision: number;
  enabled: boolean;
  cadence: {
    kind: string;
    interval_ms?: number;
    timezone?: string;
    hour?: number;
    minute?: number;
  };
  overlap: string;
  missed: string;
  queue_limit: number;
  next_at?: string;
};
export const base = '/_redeven_proxy/api/automation';
export const request = <T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> =>
  fetchSessionJSON<T>(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
export function layoutNodes(nodes: FlowNode[]) {
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (node: FlowNode): number => {
    if (depths.has(node.id)) return depths.get(node.id)!;
    if (visiting.has(node.id)) return 0;
    visiting.add(node.id);
    const result = Math.max(
      0,
      ...node.depends_on.map((id) => {
        const parent = nodes.find((n) => n.id === id);
        return parent ? depth(parent) + 1 : 0;
      }),
    );
    visiting.delete(node.id);
    depths.set(node.id, result);
    return result;
  };
  const counts = new Map<number, number>();
  return nodes.map((node) => {
    const column = depth(node),
      row = counts.get(column) ?? 0;
    counts.set(column, row + 1);
    return { node, x: 48 + column * 272, y: 56 + row * 144 };
  });
}
export function descendants(nodes: FlowNode[], id: string): Set<string> {
  const out = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes)
      if (!out.has(node.id) && node.depends_on.some((d) => out.has(d))) {
        out.add(node.id);
        changed = true;
      }
  }
  return out;
}
export function latestAttempts(run: Run, nodeID: string): Attempt[] {
  const out = new Map<string, Attempt>();
  for (const a of run.attempts)
    if (a.node_id === nodeID && !a.invalidated) out.set(a.item?.id ?? '', a);
  return [...out.values()];
}
export function reportDocument(content: string): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">${content}`;
}

export type RunSummary = Pick<
  Run,
  'id' | 'status' | 'definition_version' | 'revision' | 'scheduled_at'
>;
