import type { DesktopPreferences } from './desktopPreferences';

export const ENV_TOKEN_ENV_NAME = 'REDEVEN_DESKTOP_ENV_TOKEN';

export type DesktopAgentSpawnPlan = Readonly<{
  args: string[];
  env: NodeJS.ProcessEnv;
  password_stdin: string;
  uses_pending_bootstrap: boolean;
}>;

export function buildDesktopAgentArgs(preferences: DesktopPreferences): string[] {
  const args = [
    'run',
    '--mode',
    'desktop',
    '--desktop-managed',
    '--local-ui-bind',
    preferences.local_ui_bind,
  ];

  if (String(preferences.local_ui_password ?? '') !== '') {
    args.push('--password-stdin');
  }

  if (preferences.pending_bootstrap) {
    args.push(
      '--controlplane',
      preferences.pending_bootstrap.controlplane_url,
      '--env-id',
      preferences.pending_bootstrap.env_id,
      '--env-token-env',
      ENV_TOKEN_ENV_NAME,
    );
  }

  return args;
}

export function buildDesktopAgentEnvironment(
  preferences: DesktopPreferences,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
  };

  if (preferences.pending_bootstrap) {
    env[ENV_TOKEN_ENV_NAME] = preferences.pending_bootstrap.env_token;
  } else {
    delete env[ENV_TOKEN_ENV_NAME];
  }

  return env;
}

export function buildDesktopAgentSpawnPlan(
  startupReportFile: string,
  preferences: DesktopPreferences,
  baseEnv: NodeJS.ProcessEnv = process.env,
): DesktopAgentSpawnPlan {
  const args = buildDesktopAgentArgs(preferences);
  const env = buildDesktopAgentEnvironment(preferences, baseEnv);
  const usesPendingBootstrap = preferences.pending_bootstrap !== null;
  const passwordStdin = String(preferences.local_ui_password ?? '');
  args.push('--startup-report-file', startupReportFile);
  return {
    args,
    env,
    password_stdin: passwordStdin,
    uses_pending_bootstrap: usesPendingBootstrap,
  };
}
