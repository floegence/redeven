import { createMemo, onCleanup, type JSX } from 'solid-js';
import {
  PluginPlatformClient,
  createPluginSurfaceScope,
  createReDevPluginSurfaceTransport,
  type FetchLike,
  type PluginSurfaceContextMenuEvent,
  type PluginSurfaceInteractionEvent,
} from '@floegence/redevplugin-ui';
import { PluginSurfaceBody } from './PluginSurfaceFrame';
import { PluginConfirmationDialog, createPluginConfirmationQueue } from './PluginConfirmationQueue';
import {
  createPluginSurfacePlacementCoordinator,
  fetchAuthenticatedReDevPlugin,
  redevPluginAPIPath,
} from './pluginPlatform';
import { authorWorkspacePath } from './pluginAuthorApi';
import { prepareCenterPluginOrigin } from '../services/pluginWebOrigin';
import type { PluginSurfaceLaunchTarget } from './pluginTypes';
export function PluginAuthorPreview(props: {
  workspaceID: string;
  target: PluginSurfaceLaunchTarget;
  visible: boolean;
  centerEntry?: boolean;
  refreshInventory: () => Promise<boolean>;
  onError: (error: unknown) => void;
  onContextMenu?: (event: PluginSurfaceContextMenuEvent) => void;
  onInteraction?: (event: PluginSurfaceInteractionEvent) => void;
  registerClose: (close: (() => Promise<boolean>) | null) => void;
}): JSX.Element {
  const workspaceID = props.workspaceID;
  const fetch: FetchLike = (input, init) => {
    const url = new URL(input, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith(`${redevPluginAPIPath}/`))
      throw new Error('Invalid author platform route');
    return fetchAuthenticatedReDevPlugin(
      `${authorWorkspacePath(workspaceID)}/platform${url.pathname}${url.search}`,
      init,
    );
  };
  const surfaceScope = createPluginSurfaceScope();
  const client = new PluginPlatformClient({
    fetch,
    surfaceScope,
    surfaceTransport: createReDevPluginSurfaceTransport({ fetch }),
  });
  const coordinator = createPluginSurfacePlacementCoordinator(client, async (request) => {
    if (props.centerEntry) await prepareCenterPluginOrigin(request);
  });
  const confirmations = createPluginConfirmationQueue();
  const target = createMemo(() => props.target);
  onCleanup(() => {
    confirmations.cancelAll();
    void coordinator.dispose().catch(props.onError);
  });
  return (
    <>
      <PluginSurfaceBody
        coordinator={coordinator}
        refreshInventory={props.refreshInventory}
        confirmationQueue={confirmations}
        target={target()}
        visible={props.visible}
        registerClose={props.registerClose}
        onRetirementError={props.onError}
        onContextMenu={props.onContextMenu}
        onInteraction={props.onInteraction}
      />
      <PluginConfirmationDialog queue={confirmations} />
    </>
  );
}
