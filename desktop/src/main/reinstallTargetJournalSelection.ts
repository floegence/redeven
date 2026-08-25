import type { ReinstallTargetJournal } from './reinstallTargetCoordinator';

function compareReinstallTargetJournalRecency(
  left: ReinstallTargetJournal,
  right: ReinstallTargetJournal,
): number {
  if (left.updated_at_unix_ms !== right.updated_at_unix_ms) {
    return left.updated_at_unix_ms - right.updated_at_unix_ms;
  }
  return left.preflight_id.localeCompare(right.preflight_id);
}

export function currentReinstallTargetJournals(
  journals: readonly ReinstallTargetJournal[],
): readonly ReinstallTargetJournal[] {
  const currentByPhysicalTarget = new Map<string, ReinstallTargetJournal>();
  for (const journal of journals) {
    const current = currentByPhysicalTarget.get(journal.physical_target_fingerprint);
    if (!current || compareReinstallTargetJournalRecency(journal, current) > 0) {
      currentByPhysicalTarget.set(journal.physical_target_fingerprint, journal);
    }
  }
  return [...currentByPhysicalTarget.values()].sort(compareReinstallTargetJournalRecency);
}

export function currentReinstallTargetJournalForEnvironment(
  journals: readonly ReinstallTargetJournal[],
  environmentID: string,
): ReinstallTargetJournal | null {
  let current: ReinstallTargetJournal | null = null;
  for (const journal of currentReinstallTargetJournals(journals)) {
    if (
      journal.environment_id !== environmentID
      && !journal.affected_environment_ids.includes(environmentID)
    ) {
      continue;
    }
    if (!current || compareReinstallTargetJournalRecency(journal, current) > 0) {
      current = journal;
    }
  }
  return current;
}
