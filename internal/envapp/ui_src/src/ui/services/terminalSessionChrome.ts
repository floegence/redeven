import {
  normalizeTerminalExecutionContextInfo,
  type TerminalAgentCliIdentity,
} from '@floegence/floeterm-terminal-web/sessions';
import type { TerminalSessionInfo } from '../protocol/redeven_v1/sdk/terminal';
import { canonicalAbsolutePath } from '../utils/canonicalAbsolutePath';

export const TERMINAL_REMOTE_OPENING_SPINNER_MS = 800;

export type TerminalSessionChromeTransition = 'none' | 'creating' | 'connecting' | 'reconnecting' | 'failed';
export type TerminalSessionChromeStatus = 'none' | 'spinner' | 'wave' | 'attention' | 'unread' | 'failed';
export type TerminalSessionChromeAvatar =
  | Readonly<{ kind: 'initial' }>
  | Readonly<{ kind: 'link' }>
  | Readonly<{ kind: 'agent'; identity: TerminalAgentCliIdentity }>;

export type TerminalSessionChrome = Readonly<{
  title: string;
  subtitle: string;
  displayPath: string;
  localWorkingDir: string;
  canUseLocalPath: boolean;
  avatar: TerminalSessionChromeAvatar;
  subtitleIcon: 'none' | 'link';
  status: TerminalSessionChromeStatus;
  statusSource: 'none' | 'transition' | 'semantic' | 'output' | 'attention';
  processRunning: boolean;
  attention: 'none' | 'waiting' | 'unread';
  remote: boolean;
  remotePhase: 'unknown' | 'opening' | 'ready';
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function remoteTitle(location: ReturnType<typeof normalizeTerminalExecutionContextInfo>['location']): string {
  return compact(location?.label) || compact(location?.authority) || 'SSH';
}

export function deriveTerminalSessionChrome(input: Readonly<{
  session: TerminalSessionInfo;
  directoryTitle: string;
  fallbackTitle: string;
  foregroundDisplayName?: string;
  foregroundRunning?: boolean;
  transition?: TerminalSessionChromeTransition;
  outputStreaming?: boolean;
  unread?: boolean;
  nowMs?: number;
  remoteOpeningObservedAtMs?: number;
}>): TerminalSessionChrome {
  const session = input.session;
  const context = normalizeTerminalExecutionContextInfo(session.executionContext);
  const location = context.location;
  const application = context.application;
  const remote = location?.kind === 'remote';
  const remotePhase = remote ? location?.phase ?? 'unknown' : 'unknown';
  const transition = input.transition ?? 'none';
  const sessionWorkingDir = compact(session.workingDir);
  const canonicalDisplayWorkingDir = canonicalAbsolutePath(session.workingDir);
  const localCapabilityWorkingDir = canonicalAbsolutePath(session.localPathCapability?.workingDir);
  const canUseLocalPath = transition === 'none'
    && location?.kind === 'local'
    && location.phase === 'ready'
    && location.source === 'shell_integration'
    && Boolean(localCapabilityWorkingDir)
    && canonicalDisplayWorkingDir === localCapabilityWorkingDir;
  const localWorkingDir = canUseLocalPath ? localCapabilityWorkingDir : '';
  const remoteWorkingDir = remote ? compact(location?.workingDirectory) : '';
  const agentIdentity = application?.kind === 'agent_cli'
    ? application.identity as TerminalAgentCliIdentity
    : null;
  const agentTitle = agentIdentity ? compact(application?.displayName) : '';
  const title = agentTitle
    || (remote ? remoteTitle(location) : '')
    || compact(input.foregroundDisplayName)
    || compact(input.directoryTitle)
    || compact(input.fallbackTitle)
    || 'Terminal';
  const remoteIdentity = remoteTitle(location);
  const subtitle = remote
    ? agentIdentity
      ? [remoteIdentity, remoteWorkingDir].filter(Boolean).join(' · ')
      : remoteWorkingDir
    : sessionWorkingDir;
  const displayPath = remote ? remoteWorkingDir : sessionWorkingDir;
  const avatar: TerminalSessionChromeAvatar = agentIdentity
    ? { kind: 'agent', identity: agentIdentity }
    : remote
      ? { kind: 'link' }
      : { kind: 'initial' };
  const subtitleIcon = remote && Boolean(agentIdentity) ? 'link' : 'none';
  const processRunning = Boolean(input.foregroundRunning)
    && !remote
    && application?.kind !== 'agent_cli';
  const workState = session.workState;
  const workPhase = workState
    && workState.contextRevision === (session.executionContext?.revision ?? 0)
    && workState.foregroundCommandRevision === (session.foregroundCommand?.revision ?? 0)
      ? workState.phase
      : 'unknown';
  const attention = workPhase === 'waiting_user'
    ? 'waiting' as const
    : input.unread
      ? 'unread' as const
      : 'none' as const;

  if (transition === 'failed') {
    return {
      title, subtitle, displayPath, localWorkingDir, canUseLocalPath, subtitleIcon,
      avatar, status: 'failed', statusSource: 'transition', processRunning, attention, remote, remotePhase,
    };
  }
  if (transition === 'creating' || transition === 'connecting' || transition === 'reconnecting') {
    return {
      title, subtitle, displayPath, localWorkingDir, canUseLocalPath, subtitleIcon,
      avatar, status: 'spinner', statusSource: 'transition', processRunning, attention, remote, remotePhase,
    };
  }

  const openingObservedAtMs = Number(input.remoteOpeningObservedAtMs ?? Number.NaN);
  const nowMs = Number(input.nowMs ?? Date.now());
  if (
    remotePhase === 'opening'
    && Number.isFinite(openingObservedAtMs)
    && Number.isFinite(nowMs)
    && nowMs - openingObservedAtMs < TERMINAL_REMOTE_OPENING_SPINNER_MS
  ) {
    return {
      title, subtitle, displayPath, localWorkingDir, canUseLocalPath, subtitleIcon,
      avatar, status: 'spinner', statusSource: 'transition', processRunning, attention, remote, remotePhase,
    };
  }

  if (workPhase === 'waiting_user') {
    return {
      title, subtitle, displayPath, localWorkingDir, canUseLocalPath, subtitleIcon,
      avatar, status: 'attention', statusSource: 'semantic', processRunning, attention, remote, remotePhase,
    };
  }
  if (workPhase === 'working') {
    return {
      title, subtitle, displayPath, localWorkingDir, canUseLocalPath, subtitleIcon,
      avatar, status: 'wave', statusSource: 'semantic', processRunning, attention, remote, remotePhase,
    };
  }
  if (workPhase === 'unknown' && (input.outputStreaming || session.outputActivity?.phase === 'streaming')) {
    return {
      title, subtitle, displayPath, localWorkingDir, canUseLocalPath, subtitleIcon,
      avatar, status: 'wave', statusSource: 'output', processRunning, attention, remote, remotePhase,
    };
  }
  if (input.unread) {
    return {
      title, subtitle, displayPath, localWorkingDir, canUseLocalPath, subtitleIcon,
      avatar, status: 'unread', statusSource: 'attention', processRunning, attention, remote, remotePhase,
    };
  }
  return {
    title, subtitle, displayPath, localWorkingDir, canUseLocalPath, subtitleIcon,
    avatar, status: 'none', statusSource: 'none', processRunning, attention, remote, remotePhase,
  };
}
