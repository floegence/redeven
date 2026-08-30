import { createEffect, createMemo, onCleanup } from 'solid-js';
import { useResolvedFloeConfig, useTheme } from '@floegence/floe-webapp-core';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { getThemeColors } from '@floegence/floeterm-terminal-web';
import '@fontsource/iosevka/400.css';

import type { TerminalSessionInfo } from '../protocol/redeven_v1/sdk/terminal';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { createRedevenTerminalLiveBundle, createTerminalConnId } from '../services/terminalTransport';
import { ensureTerminalPreferencesInitialized, resolveTerminalUserTheme, useTerminalPreferences } from '../services/terminalPreferences';
import { resolveTerminalFontFamily } from './TerminalSettingsDialog';
import { TerminalSessionRuntime } from './TerminalSessionRuntime';

export type ContainerExecTerminalProps = Readonly<{
  sessionID: string;
  name: string;
  active: () => boolean;
  onSessionGone?: () => void;
}>;

export function ContainerExecTerminal(props: ContainerExecTerminalProps) {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const theme = useTheme();
  const floe = useResolvedFloeConfig();
  const connID = createTerminalConnId();
  const live = createRedevenTerminalLiveBundle(rpc, () => protocol.session?.(), connID);
  ensureTerminalPreferencesInitialized(floe.persist);
  const preferences = useTerminalPreferences();
  const createdAt = Date.now();

  createEffect(() => {
    live.transport.syncConnectionEpoch(protocol.session?.() ?? null);
  });

  onCleanup(() => live.transport.dispose());

  const connected = () => protocol.status() === 'connected' && Boolean(protocol.session?.());
  const session = createMemo<TerminalSessionInfo>(() => ({
    id: props.sessionID,
    name: props.name,
    workingDir: '/',
    createdAtMs: createdAt,
    lastActiveAtMs: createdAt,
    isActive: true,
    groupId: '',
  }));
  const terminalTheme = createMemo(() => {
    const selected = resolveTerminalUserTheme(preferences.userTheme());
    return getThemeColors(selected === 'system' ? (theme.resolvedTheme() === 'light' ? 'light' : 'dark') : selected) as Record<string, string>;
  });

  return (
    <div class="container-exec-terminal-surface">
      <TerminalSessionRuntime
        session={session()}
        variant="panel"
        active={props.active}
        connected={connected}
        protocolClient={() => protocol.session?.()}
        viewActive={props.active}
        autoFocus={props.active}
        themeColors={terminalTheme}
        fontSize={preferences.fontSize}
        fontFamily={() => resolveTerminalFontFamily(preferences.fontFamilyId())}
        agentHomePathAbs={() => '/'}
        canOpenFilePreview={() => false}
        bottomInsetPx={() => 0}
        connId={connID}
        transport={live.transport}
        eventSource={live.eventSource}
        registerViewport={() => undefined}
        registerSurfaceElement={() => undefined}
        registerActions={() => undefined}
        onSessionGone={props.onSessionGone}
      />
    </div>
  );
}
