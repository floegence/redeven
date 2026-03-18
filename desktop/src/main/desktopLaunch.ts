import type { DesktopPreferences } from './desktopPreferences';

export const LOCAL_UI_PASSWORD_ENV_NAME = 'REDEVEN_DESKTOP_LOCAL_UI_PASSWORD';
export const ENV_TOKEN_ENV_NAME = 'REDEVEN_DESKTOP_ENV_TOKEN';

export type DesktopAgentSpawnPlan = Readonly<{
  args: string[];
  env: NodeJS.ProcessEnv;
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
    args.push('--password-env', LOCAL_UI_PASSWORD_ENV_NAME);
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

  if (String(preferences.local_ui_password ?? '') !== '') {
    env[LOCAL_UI_PASSWORD_ENV_NAME] = preferences.local_ui_password;
  } else {
    delete env[LOCAL_UI_PASSWORD_ENV_NAME];
  }

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
  args.push('--startup-report-file', startupReportFile);
  return {
    args,
    env,
    uses_pending_bootstrap: usesPendingBootstrap,
  };
}
