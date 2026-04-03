import { describe, expect, it } from 'vitest';

import {
  buildExternalLocalUIDesktopTarget,
  buildManagedLocalDesktopTarget,
  desktopSessionStateKeyFragment,
  externalLocalUIDesktopSessionKey,
} from './desktopTarget';

describe('desktopTarget', () => {
  it('builds the managed local session target with a stable singleton key', () => {
    expect(buildManagedLocalDesktopTarget()).toEqual({
      kind: 'managed_local',
      session_key: 'managed_local',
      environment_id: 'env_local',
      label: 'Local Environment',
    });
  });

  it('normalizes remote targets into URL-scoped session keys and labels', () => {
    expect(externalLocalUIDesktopSessionKey('  http://192.168.1.11:24000/path?q=1  ')).toBe(
      'url:http://192.168.1.11:24000/',
    );
    expect(buildExternalLocalUIDesktopTarget('http://192.168.1.11:24000/path?q=1', {
      environmentID: ' env-1 ',
      label: ' Work laptop ',
    })).toEqual({
      kind: 'external_local_ui',
      session_key: 'url:http://192.168.1.11:24000/',
      environment_id: 'env-1',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      label: 'Work laptop',
    });
  });

  it('falls back to a default URL-derived label and produces safe state-key fragments', () => {
    expect(buildExternalLocalUIDesktopTarget('http://192.168.1.12:24000/')).toEqual(
      expect.objectContaining({
        environment_id: 'http://192.168.1.12:24000/',
        label: '192.168.1.12:24000',
      }),
    );
    expect(desktopSessionStateKeyFragment('url:http://192.168.1.12:24000/')).toBe('url%3Ahttp%3A%2F%2F192.168.1.12%3A24000%2F');
  });
});
