import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

type EnvironmentFlowerContextActionTarget = Readonly<{
  target_id: string;
  locality: 'auto';
}>;

type EnvironmentFlowerContextActionSource = Readonly<{
  surface: 'desktop_welcome_environment_card';
  surface_id?: string;
}>;

type EnvironmentFlowerContextExecutionContext = Readonly<{
  current_target_id?: string;
  source_env_public_id?: string;
  runtime_hint: 'auto';
  session_source: 'local_runtime' | 'provider_environment' | 'ssh_environment' | 'external_local_ui' | 'runtime_gateway';
}>;

type EnvironmentFlowerContextItem = Readonly<{
  kind: 'text_snapshot';
  title: string;
  detail: string;
  content: string;
}>;

export type EnvironmentFlowerContextActionEnvelope = Readonly<{
  schema_version: 2;
  action_id: 'assistant.ask.flower';
  provider: 'flower';
  target: EnvironmentFlowerContextActionTarget;
  source: EnvironmentFlowerContextActionSource;
  execution_context: EnvironmentFlowerContextExecutionContext;
  context: readonly EnvironmentFlowerContextItem[];
  presentation: Readonly<{
    label: string;
    priority: number;
  }>;
  suggested_working_dir_abs?: string;
}>;

function environmentMetadataContent(environment: DesktopEnvironmentEntry, label: string): string {
  return [
    `Environment: ${label}`,
    `Kind: ${environment.kind}`,
    `Environment ID: ${environment.id}`,
    trimString(environment.local_ui_url) ? `Local UI URL: ${trimString(environment.local_ui_url)}` : '',
    trimString(environment.provider_origin) ? `Provider origin: ${trimString(environment.provider_origin)}` : '',
    trimString(environment.provider_id) ? `Provider ID: ${trimString(environment.provider_id)}` : '',
    trimString(environment.env_public_id) ? `Env public ID: ${trimString(environment.env_public_id)}` : '',
  ].filter(Boolean).join('\n');
}

export function environmentFlowerPrimaryTargetID(environment: DesktopEnvironmentEntry): string {
  const providerOrigin = trimString(environment.provider_origin);
  const envPublicID = trimString(environment.env_public_id);
  if (environment.kind === 'provider_environment' && providerOrigin && envPublicID) {
    return `provider:${encodeURIComponent(providerOrigin)}:env:${encodeURIComponent(envPublicID)}`;
  }
  return envPublicID
    || trimString(environment.provider_runtime_link_target?.id)
    || trimString(environment.managed_runtime_target_id)
    || trimString(environment.managed_runtime_placement_target_id)
    || trimString(environment.id);
}

function environmentSessionSource(environment: DesktopEnvironmentEntry): EnvironmentFlowerContextExecutionContext['session_source'] {
  switch (environment.kind) {
    case 'local_environment':
      return 'local_runtime';
    case 'provider_environment':
      return 'provider_environment';
    case 'ssh_environment':
      return 'ssh_environment';
    case 'gateway_environment':
      return 'runtime_gateway';
    case 'external_local_ui':
      return 'external_local_ui';
  }
}

function environmentExecutionContext(
  environment: DesktopEnvironmentEntry,
  targetID: string,
): EnvironmentFlowerContextExecutionContext {
  const envPublicID = trimString(environment.env_public_id);
  return {
    current_target_id: targetID,
    ...(envPublicID ? { source_env_public_id: envPublicID } : {}),
    runtime_hint: 'auto',
    session_source: environmentSessionSource(environment),
  };
}

function environmentContextItem(environment: DesktopEnvironmentEntry, detail: string, fallbackLabel = 'This environment'): EnvironmentFlowerContextItem {
  const label = trimString(environment.label) || fallbackLabel;
  return {
    kind: 'text_snapshot',
    title: label,
    detail,
    content: environmentMetadataContent(environment, label),
  };
}

export function buildEnvironmentFlowerContextAction(
  environment: DesktopEnvironmentEntry,
  detail: string,
  fallbackLabel = 'This environment',
): EnvironmentFlowerContextActionEnvelope {
  const targetID = environmentFlowerPrimaryTargetID(environment);
  const target: EnvironmentFlowerContextActionTarget = {
    target_id: targetID,
    locality: 'auto',
  };
  const contextItems = [environmentContextItem(environment, detail, fallbackLabel)];
  return {
    schema_version: 2,
    action_id: 'assistant.ask.flower',
    provider: 'flower',
    target,
    source: {
      surface: 'desktop_welcome_environment_card',
      surface_id: trimString(environment.id) || undefined,
    },
    execution_context: environmentExecutionContext(environment, targetID),
    context: contextItems,
    presentation: {
      label: 'Ask Flower',
      priority: 100,
    },
  };
}
