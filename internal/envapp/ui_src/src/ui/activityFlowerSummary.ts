import type {
  FlowerCompanionPresenceProjection,
  FlowerCompanionPriorityStatus,
} from '../../../../flower_ui/src';

type SemanticStatus = Exclude<FlowerCompanionPriorityStatus, 'idle' | 'unavailable'>;

export type ActivityFlowerSummaryCopy = Readonly<{
  lead: Readonly<Record<SemanticStatus, string>>;
  withTitle: (lead: string, title: string) => string;
  withTitleAndMore: (lead: string, title: string, count: number) => string;
  withoutTitle: (status: SemanticStatus, count: number) => string;
  secondaryWorking: (count: number) => string;
  readyToAsk: string;
  unavailable: string;
}>;

export type ActivityFlowerSummary = Readonly<{
  visualText: string;
  accessibleText: string;
}>;

export function presentActivityFlowerSummary(
  presence: FlowerCompanionPresenceProjection,
  copy: ActivityFlowerSummaryCopy,
): ActivityFlowerSummary {
  if (presence.priority_status === 'idle') {
    return { visualText: '', accessibleText: copy.readyToAsk };
  }
  if (presence.priority_status === 'unavailable') {
    return { visualText: '', accessibleText: copy.unavailable };
  }

  const status = presence.priority_status;
  const count = Math.max(1, Math.floor(presence.priority_count));
  const title = String(presence.priority_thread_title ?? '').trim();
  const visualText = title
    ? count > 1
      ? copy.withTitleAndMore(copy.lead[status], title, count - 1)
      : copy.withTitle(copy.lead[status], title)
    : copy.withoutTitle(status, count);
  const backgroundRunningCount = status === 'running'
    ? 0
    : Math.max(0, Math.floor(presence.running_count));

  return {
    visualText,
    accessibleText: backgroundRunningCount > 0
      ? `${visualText}. ${copy.secondaryWorking(backgroundRunningCount)}`
      : visualText,
  };
}
