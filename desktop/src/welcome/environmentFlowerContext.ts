import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';

type EnvironmentFlowerContextTarget = Readonly<{
  target_id: string;
  locality: 'auto';
}>;

type EnvironmentFlowerContextSource = Readonly<{
  surface: 'desktop_welcome_environment_card';
  surface_id: string;
}>;

type EnvironmentFlowerExecutionContext = Readonly<{
  current_target_id: string;
  source_env_public_id: string;
  runtime_hint: 'auto';
  session_source: 'desktop_welcome';
}>;

type EnvironmentFlowerContextItem = Readonly<{
  kind: 'text_snapshot';
  title: string;
  detail: string;
  content: string;
}>;

type EnvironmentFlowerPresentation = Readonly<{
  label: string;
  priority: number;
  status_label: 'Ready';
}>;

export type EnvironmentFlowerContextActionEnvelope = Readonly<{
  schema_version: 2;
  action_id: string;
  provider: 'desktop_welcome';
  target: EnvironmentFlowerContextTarget;
  source: EnvironmentFlowerContextSource;
  execution_context: EnvironmentFlowerExecutionContext;
  context: readonly EnvironmentFlowerContextItem[];
  presentation: EnvironmentFlowerPresentation;
}>;

export type EnvironmentFlowerContextEnvelope = Readonly<{
  id: string;
  provider: 'desktop_welcome';
  raw: EnvironmentFlowerContextActionEnvelope;
}>;

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function environmentMetadataContent(environment: DesktopEnvironmentEntry): string {
  return [
    `Environment: ${environment.label}`,
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

export function buildEnvironmentFlowerContextEnvelope(
  environment: DesktopEnvironmentEntry,
  detail: string,
): EnvironmentFlowerContextEnvelope {
  const targetID = environmentFlowerPrimaryTargetID(environment);
  const actionID = `desktop-env-${targetID}`;
  const raw = {
    schema_version: 2,
    action_id: actionID,
    provider: 'desktop_welcome',
    target: {
      target_id: targetID,
      locality: 'auto',
    },
    source: {
      surface: 'desktop_welcome_environment_card',
      surface_id: trimString(environment.id),
    },
    execution_context: {
      current_target_id: targetID,
      source_env_public_id: trimString(environment.env_public_id),
      runtime_hint: 'auto',
      session_source: 'desktop_welcome',
    },
    context: [
      {
        kind: 'text_snapshot',
        title: environment.label,
        detail,
        content: environmentMetadataContent(environment),
      },
    ],
    presentation: {
      label: environment.label,
      priority: 100,
      status_label: 'Ready',
    },
  } satisfies EnvironmentFlowerContextActionEnvelope;

  return {
    id: actionID,
    provider: 'desktop_welcome',
    raw,
  };
}
