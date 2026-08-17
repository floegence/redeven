import type { AgentLatestVersion } from '../services/controlplaneApi';
import type { RuntimeMaintenanceContext } from '../services/desktopShellBridge';

export type AgentUpgradePolicy = 'self_upgrade' | 'desktop_release' | 'manual';

export type AgentUpgradeState = Readonly<{
  policy: AgentUpgradePolicy;
  allowsUpgradeAction: boolean;
  automaticPromptAllowed: boolean;
  requiresTargetVersion: boolean;
  message: string;
  releasePageURL: string;
  actionLabel: string;
  actionMethod: RuntimeMaintenanceContext['upgrade']['method'];
}>;

const DEFAULT_DESKTOP_RELEASE_MESSAGE = 'Runtime management is provided through Redeven Gateway setup. Use Desktop or your administrator\'s setup flow to install the update.';
const DEFAULT_MANUAL_MESSAGE = 'Latest version metadata is unavailable in this mode. Enter a specific release tag to update manually.';

function normalizeUpgradePolicy(latestMeta: AgentLatestVersion | null | undefined): AgentUpgradePolicy {
  const raw = String(latestMeta?.upgrade_policy ?? '').trim().toLowerCase();
  if (raw === 'self_upgrade' || raw === 'desktop_release' || raw === 'manual') {
    return raw;
  }
  return 'manual';
}

export function resolveAgentUpgradeState(
  latestMeta: AgentLatestVersion | null | undefined,
  maintenanceContext?: RuntimeMaintenanceContext | null,
): AgentUpgradeState {
  const policy = normalizeUpgradePolicy(latestMeta);
  const rawMessage = String(latestMeta?.message ?? '').trim();
  const releasePageURL = String(latestMeta?.release_page_url ?? '').trim();
  const upgradePlan = maintenanceContext?.upgrade ?? null;
  const upgradeAvailable = upgradePlan?.availability === 'available'
    && upgradePlan.method === 'gateway_supervisor';
  const actionMethod = upgradePlan?.method ?? 'manual';

  let message = upgradePlan?.message || rawMessage;
  if (!message && policy === 'desktop_release') {
    message = DEFAULT_DESKTOP_RELEASE_MESSAGE;
  }
  if (!message && policy === 'manual') {
    message = DEFAULT_MANUAL_MESSAGE;
  }

  return {
    policy,
    allowsUpgradeAction: upgradeAvailable,
    automaticPromptAllowed: policy === 'self_upgrade' && upgradeAvailable,
    requiresTargetVersion: upgradePlan?.requires_target_version ?? policy !== 'desktop_release',
    message,
    releasePageURL: upgradePlan?.release_page_url || releasePageURL,
    actionLabel: upgradePlan?.label || (policy === 'desktop_release' ? 'Manage in Desktop' : 'Update Redeven'),
    actionMethod,
  };
}
