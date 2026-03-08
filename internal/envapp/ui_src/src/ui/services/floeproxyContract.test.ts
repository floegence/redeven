import { describe, expect, it } from 'vitest';

import {
  CODE_SPACE_ID_ENV_UI,
  FLOE_APP_AGENT,
  FLOE_APP_CODE,
  FLOE_APP_PORT_FORWARD,
  SESSION_KIND_CODEAPP,
  SESSION_KIND_PORTFORWARD,
  isEnvAppTarget,
  sessionKindForLauncherApp,
} from './floeproxyContract';

describe('floeproxyContract', () => {
  it('maps launcher floe_app to a stable session kind', () => {
    expect(sessionKindForLauncherApp(FLOE_APP_CODE)).toBe(SESSION_KIND_CODEAPP);
    expect(sessionKindForLauncherApp(FLOE_APP_PORT_FORWARD)).toBe(SESSION_KIND_PORTFORWARD);
  });

  it('rejects unsupported launcher apps', () => {
    expect(() => sessionKindForLauncherApp(FLOE_APP_AGENT)).toThrow('Unsupported floe_app');
    expect(() => sessionKindForLauncherApp('com.example.app')).toThrow('Unsupported floe_app');
  });

  it('recognizes the reserved env app target', () => {
    expect(isEnvAppTarget(FLOE_APP_AGENT, CODE_SPACE_ID_ENV_UI)).toBe(true);
    expect(isEnvAppTarget(FLOE_APP_CODE, CODE_SPACE_ID_ENV_UI)).toBe(false);
    expect(isEnvAppTarget(FLOE_APP_AGENT, 'cs1')).toBe(false);
  });
});
