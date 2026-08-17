import type { PluginExternalPackageSecuritySummary } from './pluginTypes';

export type SecurityCategory = keyof Pick<
  PluginExternalPackageSecuritySummary,
  'permissions' | 'methods' | 'capability_contracts' | 'workers' | 'network' | 'storage' | 'secret_refs' | 'core_actions' | 'intents' | 'surfaces'
>;

export type SecurityDeclaration = {
  key: string;
  category: SecurityCategory;
  identity: string;
  facts: readonly string[];
  previousFacts?: readonly string[];
  value: unknown;
  change?: 'added' | 'changed' | 'removed';
};

export type StandardChangeSummary = {
  category: SecurityCategory;
  change: 'added' | 'changed';
  count: number;
};

export type OperationEffectGroup = 'read' | 'write' | 'execute' | 'delete' | 'admin' | 'other';
export type OperationImpactGroup = {
  effect: OperationEffectGroup;
  count: number;
  dangerousCount: number;
  preflightOnlyCount: number;
};

export const securityCategoryOrder: readonly SecurityCategory[] = [
  'permissions',
  'methods',
  'capability_contracts',
  'workers',
  'network',
  'storage',
  'secret_refs',
  'core_actions',
  'intents',
  'surfaces',
];

export function securityDeclarationIsSensitive(declaration: SecurityDeclaration): boolean {
  if (declaration.category === 'methods') {
    const method = declaration.value as PluginExternalPackageSecuritySummary['methods'][number];
    return method.dangerous || method.effect !== 'read';
  }
  if (declaration.category === 'storage') {
    const storage = declaration.value as PluginExternalPackageSecuritySummary['storage'][number];
    return storage.method_access.some((access) => access.operations.some((operation) => (
      ['write', 'put', 'insert', 'update', 'delete', 'exec'].includes(operation)
    )));
  }
  return declaration.category === 'workers'
    || declaration.category === 'network'
    || declaration.category === 'secret_refs'
    || declaration.category === 'core_actions';
}

export function securityDeclarationHighlight(declaration: SecurityDeclaration): string | undefined {
  switch (declaration.category) {
    case 'methods':
      return `effect=${(declaration.value as PluginExternalPackageSecuritySummary['methods'][number]).effect}`;
    case 'workers':
      return (declaration.value as PluginExternalPackageSecuritySummary['workers'][number]).artifact;
    case 'network':
      return list((declaration.value as PluginExternalPackageSecuritySummary['network'][number]).destinations);
    case 'secret_refs':
      return (declaration.value as PluginExternalPackageSecuritySummary['secret_refs'][number]).secret_ref;
    case 'core_actions':
      return `effect=${(declaration.value as PluginExternalPackageSecuritySummary['core_actions'][number]).effect}`;
    case 'storage':
      return (declaration.value as PluginExternalPackageSecuritySummary['storage'][number])
        .method_access.flatMap((access) => access.operations).join(', ');
    default:
      return undefined;
  }
}

export function securityDeclarations(
  current: PluginExternalPackageSecuritySummary,
  previous?: PluginExternalPackageSecuritySummary,
): readonly SecurityDeclaration[] {
  const currentRows = projectSecurityDeclarations(current);
  if (!previous) return currentRows;
  const previousRows = projectSecurityDeclarations(previous);
  const previousByKey = new Map(previousRows.map((row) => [row.key, row]));
  const currentKeys = new Set(currentRows.map((row) => row.key));
  return [
    ...currentRows.map((row) => {
      const before = previousByKey.get(row.key);
      return {
        ...row,
        ...(!before
          ? { change: 'added' as const }
          : JSON.stringify(before.value) !== JSON.stringify(row.value)
            ? { change: 'changed' as const, previousFacts: before.facts }
            : {}),
      };
    }),
    ...previousRows.filter((row) => !currentKeys.has(row.key)).map((row) => ({ ...row, change: 'removed' as const })),
  ];
}

export function projectSecurityDeclarations(summary: PluginExternalPackageSecuritySummary): SecurityDeclaration[] {
  const rows: SecurityDeclaration[] = [];
  const add = (category: SecurityCategory, identity: string, facts: readonly string[], value: unknown) => {
    rows.push({ key: `${category}:${identity}`, category, identity, facts, value });
  };
  for (const value of summary.permissions) add('permissions', value.permission_id, [`methods=${list(value.methods)}`], value);
  for (const value of summary.methods) {
    add('methods', value.method, [
      `route=${fields(value.route)}`,
      `effect=${value.effect}; execution=${value.execution}; dangerous=${value.dangerous}; preflight_only=${value.preflight_only}`,
      `required_permissions=${list(value.required_permissions)}`,
      `confirmation=${fields(value.confirmation)}`,
      ...(value.cancel ? [`cancel=${fields(value.cancel)}`] : []),
    ], value);
  }
  for (const value of summary.capability_contracts) {
    add('capability_contracts', `${value.capability_id}@${value.capability_version}`, [
      `binding_id=${value.binding_id}`,
      `contract_sha256=${value.contract_sha256}`,
    ], value);
  }
  for (const value of summary.workers) {
    add('workers', value.worker_id, [
      `artifact=${value.artifact}; mode=${value.mode}; scope=${value.scope}`,
      `memory_limit_bytes=${value.memory_limit_bytes}; idle_timeout_ms=${value.idle_timeout_ms}`,
    ], value);
  }
  for (const value of summary.network) {
    add('network', value.connector_id, [
      `transport=${value.transport}; scope=${value.scope}; auth_declared=${value.auth_declared}; tls_declared=${value.tls_declared}`,
      `destinations=${list(value.destinations)}`,
      ...value.method_access.map((access) => `method=${access.method}; operations=${list(access.operations)}; http_methods=${list(access.http_methods)}`),
    ], value);
  }
  for (const value of summary.storage) {
    add('storage', value.store_id, [
      `kind=${value.kind}; scope=${value.scope}; schema_version=${value.schema_version}`,
      `quota_bytes=${value.quota_bytes}; quota_files=${value.quota_files ?? '-'}`,
      ...value.method_access.map((access) => `method=${access.method}; operations=${list(access.operations)}`),
    ], value);
  }
  for (const value of summary.secret_refs) add('secret_refs', value.setting_key, [`secret_ref=${value.secret_ref}; scope=${value.scope}`], value);
  for (const value of summary.core_actions) add('core_actions', value.action_id, [`method=${value.method}; effect=${value.effect}`], value);
  for (const value of summary.intents) add('intents', value.intent_id, [`method=${value.method}`], value);
  for (const value of summary.surfaces) {
    add('surfaces', value.surface_id, [
      `label=${value.label}; kind=${value.kind}; intent=${value.intent}`,
      `entry=${value.entry}; icon=${value.icon ?? '-'}; default_size=${value.default_size ? `${value.default_size.width}x${value.default_size.height}` : '-'}`,
    ], value);
  }
  return rows;
}

export function operationImpactGroups(methods: PluginExternalPackageSecuritySummary['methods']): readonly OperationImpactGroup[] {
  const order: readonly OperationEffectGroup[] = ['read', 'write', 'execute', 'delete', 'admin', 'other'];
  const grouped = new Map<OperationEffectGroup, OperationImpactGroup>();
  for (const method of methods) {
    const effect = operationEffectGroup(method.effect as string);
    const current = grouped.get(effect) ?? { effect, count: 0, dangerousCount: 0, preflightOnlyCount: 0 };
    grouped.set(effect, {
      effect,
      count: current.count + 1,
      dangerousCount: current.dangerousCount + (method.dangerous ? 1 : 0),
      preflightOnlyCount: current.preflightOnlyCount + (method.preflight_only ? 1 : 0),
    });
  }
  return order.flatMap((effect) => grouped.get(effect) ?? []);
}

function operationEffectGroup(effect: string): OperationEffectGroup {
  switch (effect) {
    case 'read': return 'read';
    case 'write': return 'write';
    case 'execute': return 'execute';
    case 'delete': return 'delete';
    case 'admin': return 'admin';
    default: return 'other';
  }
}

function list(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : '-';
}

function fields(value: object): string {
  return Object.entries(value).map(([key, field]) => (
    `${key}=${Array.isArray(field) ? list(field.map(String)) : String(field)}`
  )).join('; ');
}
