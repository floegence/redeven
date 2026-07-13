export const RUNTIME_SECRET_ENV_NAMES = [
  'REDEVEN_LOCAL_UI_PASSWORD',
  'REDEVEN_BOOTSTRAP_TICKET',
  'REDEVEN_DESKTOP_BOOTSTRAP_TICKET',
] as const;

export function sanitizeDesktopChildEnvironment(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const blocked = new Set<string>(RUNTIME_SECRET_ENV_NAMES.map((name) => name.toLowerCase()));
  for (const name of Object.keys(env)) {
    if (blocked.has(name.toLowerCase())) {
      delete env[name];
    }
  }
  return env;
}
