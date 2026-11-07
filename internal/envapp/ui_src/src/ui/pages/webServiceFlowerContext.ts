import type { PortForward, ManagedService } from './EnvPortForwardsPage';

/** Explicit product facts only: no settings, entrance tokens or runtime internals. */
export function managedServiceFlowerContext(service: ManagedService) {
  const release = service.release_status.current_release;
  return {
    id: service.service_id,
    label: service.name,
    resourceKey: `managed_service:${service.service_id}`,
    state: {
      resource_kind: 'managed_web_service',
      runtime_ref: 'local:local',
      binding: { owner: 'managed_service', resourceId: service.service_id },
      service_id: service.service_id,
      description: service.description,
      deployment: service.deployment,
      template_id: service.template_id,
      status: service.status ?? service.observed_state,
      workspace: {
        path: service.workspace_path,
        role: 'configured_service_working_directory',
      },
      runtime_port: service.runtime_port,
      ...(release
        ? {
            release: {
              kind: release.kind,
              source: release.source,
              version: release.version,
              tag: release.tag,
              platform: release.platform,
            },
          }
        : {}),
    },
  };
}

export function portForwardFlowerContext(forward: PortForward) {
  // Entrance parameters and URL credentials must never enter a reference.
  const appPath = forward.default_app_path || '/';
  const url = new URL(appPath === '/' ? forward.target_url : new URL(appPath, forward.target_url));
  return {
    id: forward.forward_id,
    label: forward.name || url.host,
    resourceKey: `port_forward:${forward.forward_id}`,
    state: {
      resource_kind: 'port_forward',
      runtime_ref: 'local:local',
      forward_id: forward.forward_id,
      description: forward.description,
      target: `${url.origin}${url.pathname}`,
      status: forward.health.status,
    },
  };
}
