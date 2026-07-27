import { describe, expect, it } from 'vitest';
import type { TerminalSessionInfo } from '@floegence/floeterm-terminal-web/sessions';

import {
  deriveTerminalSessionChrome,
  TERMINAL_REMOTE_OPENING_SPINNER_MS,
} from './terminalSessionChrome';

function session(patch: Partial<TerminalSessionInfo> = {}): TerminalSessionInfo {
  return {
    id: 'session-1',
    name: 'Terminal',
    workingDir: '/workspace/redeven',
    createdAtMs: 1,
    lastActiveAtMs: 2,
    isActive: true,
    foregroundCommand: { phase: 'idle', displayName: '', revision: 1, updatedAtMs: 1 },
    outputActivity: { phase: 'settled', revision: 1, updatedAtMs: 1 },
    executionContext: {
      location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '', source: 'shell_integration' },
      application: { kind: 'shell', identity: '', displayName: '' },
      revision: 1,
      updatedAtMs: 1,
    },
    workState: { phase: 'unknown', source: '', contextRevision: 0, foregroundCommandRevision: 0, revision: 0, updatedAtMs: 0 },
    ...patch,
  };
}

const derive = (value: TerminalSessionInfo, extras: Record<string, unknown> = {}) => deriveTerminalSessionChrome({
  session: value,
  directoryTitle: 'redeven',
  fallbackTitle: 'Terminal',
  ...extras,
});

describe('deriveTerminalSessionChrome', () => {
  it('keeps local idle sessions quiet and allows local path capabilities', () => {
    expect(derive(session())).toMatchObject({
      title: 'redeven',
      subtitle: '/workspace/redeven',
      avatar: { kind: 'initial' },
      status: 'none',
      canUseLocalPath: true,
      processRunning: false,
    });
  });

  it('fails closed when execution context is missing or unknown', () => {
    for (const executionContext of [
      undefined,
      {
        location: { kind: 'unknown', phase: 'unknown', label: '', authority: '', workingDirectory: '', source: 'unknown' },
        application: { kind: 'unknown', identity: '', displayName: '' },
        revision: 0,
        updatedAtMs: 0,
      },
    ] as const) {
      expect(derive(session({ executionContext }))).toMatchObject({
        localWorkingDir: '',
        canUseLocalPath: false,
        remote: false,
      });
    }
  });

  it('requires authoritative ready shell integration before granting local path capabilities', () => {
    for (const location of [
      { kind: 'local', phase: 'opening', label: '', authority: '', workingDirectory: '', source: 'shell_integration' },
      { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '', source: 'foreground_candidate' },
    ] as const) {
      expect(derive(session({
        executionContext: {
          location,
          application: { kind: 'shell', identity: '', displayName: '' },
          revision: 2,
          updatedAtMs: 2,
        },
      }))).toMatchObject({
        localWorkingDir: '',
        canUseLocalPath: false,
        remote: false,
      });
    }
  });

  it('keeps a confirmed ordinary foreground process independent from output and attention', () => {
    expect(derive(session(), {
      foregroundDisplayName: 'top',
      foregroundRunning: true,
      outputStreaming: true,
      unread: true,
    })).toMatchObject({
      title: 'top',
      processRunning: true,
      status: 'wave',
      statusSource: 'output',
      attention: 'unread',
    });
    expect(derive(session(), {
      foregroundDisplayName: 'top',
      foregroundRunning: true,
      unread: true,
    })).toMatchObject({
      processRunning: true,
      status: 'unread',
      attention: 'unread',
    });
  });

  it('caps SSH opening animation without pretending the connection is ready', () => {
    const ssh = session({
      executionContext: {
        location: { kind: 'remote', phase: 'opening', label: 'SSH', authority: '', workingDirectory: '', source: 'foreground_candidate' },
        application: { kind: 'shell', identity: '', displayName: '' },
        revision: 2,
        updatedAtMs: 2,
      },
    });
    expect(derive(ssh, { nowMs: 1_500, remoteOpeningObservedAtMs: 1_000 })).toMatchObject({
      title: 'SSH', avatar: { kind: 'link' }, status: 'spinner', processRunning: false, remotePhase: 'opening', canUseLocalPath: false,
    });
    expect(derive(ssh, {
      nowMs: 1_000 + TERMINAL_REMOTE_OPENING_SPINNER_MS,
      remoteOpeningObservedAtMs: 1_000,
    })).toMatchObject({
      title: 'SSH', avatar: { kind: 'link' }, status: 'none', remotePhase: 'opening', canUseLocalPath: false,
    });
  });

  it('presents ready SSH identity and remote path without granting local Files access', () => {
    const chrome = derive(session({
      executionContext: {
        location: { kind: 'remote', phase: 'ready', label: 'root@host', authority: 'host', workingDirectory: '/root/project', source: 'osc7' },
        application: { kind: 'shell', identity: '', displayName: '' },
        revision: 3,
        updatedAtMs: 3,
      },
    }));
    expect(chrome).toMatchObject({
      title: 'root@host',
      subtitle: '/root/project',
      displayPath: '/root/project',
      localWorkingDir: '',
      avatar: { kind: 'link' },
      status: 'none',
      canUseLocalPath: false,
    });
  });

  it('keeps Agent identity stable while semantic work controls the status slot', () => {
    const codex = session({
      executionContext: {
        location: { kind: 'remote', phase: 'ready', label: 'root@host', authority: 'host', workingDirectory: '/root/project', source: 'osc7' },
        application: { kind: 'agent_cli', identity: 'codex', displayName: 'Codex' },
        revision: 4,
        updatedAtMs: 4,
      },
      workState: { phase: 'working', source: 'semantic', contextRevision: 4, foregroundCommandRevision: 1, revision: 2, updatedAtMs: 5 },
    });
    expect(derive(codex, { foregroundRunning: true })).toMatchObject({
      title: 'Codex', subtitle: 'root@host · /root/project', subtitleIcon: 'link',
      avatar: { kind: 'agent', identity: 'codex' }, status: 'wave', processRunning: false,
    });
    expect(derive({
      ...codex,
      workState: { ...codex.workState!, phase: 'waiting_user', revision: 3 },
    })).toMatchObject({ title: 'Codex', status: 'attention' });
    expect(derive({
      ...codex,
      workState: { ...codex.workState!, phase: 'idle', revision: 4 },
      outputActivity: { phase: 'streaming', revision: 7, updatedAtMs: 7 },
    })).toMatchObject({ title: 'Codex', status: 'none' });
  });

  it('projects an Agent identity accepted by the upstream context normalizer without a local whitelist', () => {
    expect(derive(session({
      executionContext: {
        location: {
          kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/workspace/redeven', source: 'shell_integration',
        },
        application: { kind: 'agent_cli', identity: 'kilo', displayName: 'Kilo Code' },
        revision: 5,
        updatedAtMs: 5,
      },
    }))).toMatchObject({
      title: 'Kilo Code',
      avatar: { kind: 'agent', identity: 'kilo' },
    });
  });

  it('uses output only as an unknown-semantic fallback and keeps unread lower priority', () => {
    expect(derive(session({ outputActivity: { phase: 'streaming', revision: 2, updatedAtMs: 2 } }), { unread: true }))
      .toMatchObject({ status: 'wave', statusSource: 'output' });
    expect(derive(session(), { unread: true })).toMatchObject({ status: 'unread' });
  });

  it('ignores semantic work whose context or foreground revision fence is stale', () => {
    const stale = session({
      executionContext: {
        location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/workspace/redeven', source: 'shell_integration' },
        application: { kind: 'agent_cli', identity: 'claude', displayName: 'Claude Code' },
        revision: 6,
        updatedAtMs: 6,
      },
      foregroundCommand: { phase: 'running', displayName: 'claude', revision: 7, updatedAtMs: 7 },
      workState: { phase: 'working', source: 'semantic', contextRevision: 5, foregroundCommandRevision: 7, revision: 8, updatedAtMs: 8 },
      outputActivity: { phase: 'settled', revision: 9, updatedAtMs: 9 },
    });

    expect(derive(stale)).toMatchObject({ title: 'Claude Code', status: 'none' });
    expect(derive({
      ...stale,
      workState: { ...stale.workState!, contextRevision: 6, foregroundCommandRevision: 6, revision: 9 },
      outputActivity: { phase: 'streaming', revision: 10, updatedAtMs: 10 },
    })).toMatchObject({ status: 'wave', statusSource: 'output' });
  });
});
