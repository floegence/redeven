import type { AgentLatestVersion } from '../services/controlplaneApi';

export type AgentUpgradePolicy = 'self_upgrade' | 'desktop_release' | 'manual';

export type AgentUpgradeState = Readonly<{
  policy: AgentUpgradePolicy;
  allowsUpgradeAction: boolean;
  automaticPromptAllowed: boolean;
  message: string;
  releasePageURL: string;
  actionLabel: string;
}>;

const DEFAULT_DESKTOP_RELEASE_MESSAGE = 'Managed by Redeven Desktop. Update from the desktop release instead of self-upgrade.';
const DEFAULT_MANUAL_MESSAGE = 'Latest version metadata is unavailable in this mode. Enter a specific release tag to update manually.';

function normalizeUpgradePolicy(latestMeta: AgentLatestVersion | null | undefined): AgentUpgradePolicy {
  const raw = String(latestMeta?.upgrade_policy ?? '').trim().toLowerCase();
  if (raw === 'self_upgrade' || raw === 'desktop_release' || raw === 'manual') {
    return raw;
  }
  return 'manual';
}

export function resolveAgentUpgradeState(latestMeta: AgentLatestVersion | null | undefined): AgentUpgradeState {
  const policy = normalizeUpgradePolicy(latestMeta);
  const rawMessage = String(latestMeta?.message ?? '').trim();
  const releasePageURL = String(latestMeta?.release_page_url ?? '').trim();

  let message = rawMessage;
  if (!message && policy === 'desktop_release') {
    message = DEFAULT_DESKTOP_RELEASE_MESSAGE;
  }
  if (!message && policy === 'manual') {
    message = DEFAULT_MANUAL_MESSAGE;
  }

  return {
    policy,
    allowsUpgradeAction: true,
    automaticPromptAllowed: policy === 'self_upgrade',
    message,
    releasePageURL,
    actionLabel: policy === 'desktop_release' ? 'Manage in Desktop' : 'Update Redeven',
  };
}
