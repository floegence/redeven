import { describe, expect, it } from 'vitest';

import {
  dedupeNoticeKeys,
  environmentNoticeKey,
  launcherActionFailurePresentation,
  noticeKeysForProviderEnvironment,
  providerEnvironmentNoticeKey,
} from './launcherActionFeedback';

describe('launcherActionFeedback', () => {
  it('maps stale sessions to inline notices and snapshot refresh', () => {
    expect(launcherActionFailurePresentation({
      ok: false,
      code: 'session_stale',
      scope: 'environment',
      message: 'That window was already closed. Desktop refreshed the environment list.',
      should_refresh_snapshot: true,
    }, ['environment:local:default'])).toEqual({
      global_message: '',
      notice_message: 'That window was already closed. Desktop refreshed the environment list.',
      notice_tone: 'info',
      refresh_snapshot: true,
    });
  });

  it('falls back to a global message when no environment card key is available', () => {
    expect(launcherActionFailurePresentation({
      ok: false,
      code: 'control_plane_missing',
      scope: 'control_plane',
      message: 'This Control Plane is no longer saved in Desktop.',
    })).toEqual({
      global_message: 'This Control Plane is no longer saved in Desktop.',
      notice_message: 'This Control Plane is no longer saved in Desktop.',
      notice_tone: 'warning',
      refresh_snapshot: false,
    });
  });

  it('builds stable notice keys for provider environments', () => {
    expect(environmentNoticeKey('local:default')).toBe('environment:local:default');
    expect(providerEnvironmentNoticeKey('https://cp.example.invalid', 'redeven_portal', 'env_demo')).toBe(
      'provider:https://cp.example.invalid|redeven_portal|env_demo',
    );
    expect(noticeKeysForProviderEnvironment('https://cp.example.invalid', 'redeven_portal', 'env_demo')).toEqual([
      'provider:https://cp.example.invalid|redeven_portal|env_demo',
    ]);
    expect(dedupeNoticeKeys([
      '',
      'environment:local:default',
      'environment:local:default',
      'provider:https://cp.example.invalid|redeven_portal|env_demo',
    ])).toEqual([
      'environment:local:default',
      'provider:https://cp.example.invalid|redeven_portal|env_demo',
    ]);
  });
});
