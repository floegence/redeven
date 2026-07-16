import type { ConfigEnv } from 'vite';

export const REDEVEN_ENVAPP_ENABLE_PLUGIN_UI_ENV = 'REDEVEN_ENVAPP_ENABLE_PLUGIN_UI';

export function resolveEnvAppPluginUIEnabled(
  command: ConfigEnv['command'],
  explicitValue: string | undefined,
): boolean {
  return command === 'serve' || explicitValue === '1';
}
