import {
  desktopGatewaySourceID,
  type DesktopEnvironmentSource,
  type DesktopGatewaySource,
} from '../shared/desktopGateway';
import { desktopControlPlaneKey, type DesktopControlPlaneSummary } from '../shared/controlPlaneProvider';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function localEnvironmentSource(label = 'Local Environment'): DesktopEnvironmentSource {
  return {
    kind: 'local',
    source_id: 'local',
    label: compact(label) || 'Local Environment',
  };
}

export function providerEnvironmentSource(
  controlPlane: DesktopControlPlaneSummary,
): DesktopEnvironmentSource | null {
  try {
    return {
      kind: 'provider',
      source_id: desktopControlPlaneKey(
        controlPlane.provider.provider_origin,
        controlPlane.provider.provider_id,
      ),
      label: compact(controlPlane.display_label)
        || compact(controlPlane.provider.display_name)
        || controlPlane.provider.provider_origin,
    };
  } catch {
    return null;
  }
}

export function gatewayEnvironmentSource(
  gateway: Pick<DesktopGatewaySource, 'gateway_id' | 'display_name'>,
): DesktopEnvironmentSource | null {
  const sourceID = desktopGatewaySourceID(gateway.gateway_id);
  if (!sourceID) {
    return null;
  }
  return {
    kind: 'gateway',
    source_id: sourceID,
    label: compact(gateway.display_name) || gateway.gateway_id,
  };
}

export type EnvironmentSourceRegistryInput = Readonly<{
  localLabel?: string;
  controlPlanes?: readonly DesktopControlPlaneSummary[];
  gatewaySources?: readonly DesktopGatewaySource[];
}>;

export function buildEnvironmentSourceRegistry(
  input: EnvironmentSourceRegistryInput = {},
): readonly DesktopEnvironmentSource[] {
  const byID = new Map<string, DesktopEnvironmentSource>();
  const add = (source: DesktopEnvironmentSource | null) => {
    if (!source?.source_id) {
      return;
    }
    byID.set(source.source_id, source);
  };

  add(localEnvironmentSource(input.localLabel));
  for (const controlPlane of input.controlPlanes ?? []) {
    add(providerEnvironmentSource(controlPlane));
  }
  for (const gateway of input.gatewaySources ?? []) {
    add(gatewayEnvironmentSource(gateway));
  }

  return [...byID.values()].sort((left, right) => (
    sourceKindRank(left.kind) - sourceKindRank(right.kind)
    || left.label.toLowerCase().localeCompare(right.label.toLowerCase())
    || left.source_id.localeCompare(right.source_id)
  ));
}

function sourceKindRank(kind: DesktopEnvironmentSource['kind']): number {
  switch (kind) {
    case 'local':
      return 0;
    case 'provider':
      return 1;
    case 'gateway':
      return 2;
  }
}
