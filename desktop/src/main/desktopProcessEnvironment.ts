import path from 'node:path';

export const RUNTIME_SECRET_ENV_NAMES = [
  'REDEVEN_LOCAL_UI_PASSWORD',
  'REDEVEN_BOOTSTRAP_TICKET',
  'REDEVEN_DESKTOP_BOOTSTRAP_TICKET',
] as const;

export function sanitizeDesktopChildEnvironment(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const blocked = new Set<string>([
    ...RUNTIME_SECRET_ENV_NAMES,
  ].map((name) => name.toLowerCase()));
  for (const name of Object.keys(env)) {
    if (blocked.has(name.toLowerCase())) {
      delete env[name];
    }
  }
  return env;
}

/**
 * Resolve the CLI from the same runtime bundle that Desktop is launching.
 * Keeping this contract in the child environment prevents skills and target
 * diagnostics from accidentally invoking an older binary found on PATH.
 */
export function withBundledCLIEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  executablePath: string,
): NodeJS.ProcessEnv {
  const raw = String(executablePath ?? '').trim();
  const resolved = path.resolve(raw);
  if (raw === '' || !path.isAbsolute(raw) || resolved === path.parse(resolved).root) {
    throw new Error('Bundled Redeven CLI path must be an absolute executable path.');
  }
  const directory = path.dirname(resolved);
  const existingPath = String(baseEnv.PATH ?? '').trim();
  return {
    ...baseEnv,
    REDEVEN_CLI_PATH: resolved,
    PATH: existingPath === '' ? directory : `${directory}${path.delimiter}${existingPath}`,
  };
}
