import type {
  FlowerCompanionPresenceProjection,
  FlowerCompanionProgressKind,
  FlowerCompanionPriorityStatus,
} from '../../../../flower_ui/src';

type ActiveStatus = Extract<FlowerCompanionPriorityStatus, 'running' | 'queued'>;

export type ActivityFlowerSummaryCopy = Readonly<{
  lead: Readonly<Record<ActiveStatus, string>>;
  withTitle: (lead: string, title: string) => string;
  withTitleAndMore: (lead: string, title: string, count: number) => string;
  withoutTitle: (status: ActiveStatus, count: number) => string;
  secondaryWorking: (count: number) => string;
  readyToAsk: string;
  unavailable: string;
}>;

export type ActivityFlowerSummary = Readonly<{
  visualText: string;
  accessibleText: string;
  presentationStatus: FlowerCompanionPriorityStatus;
  progressKind?: FlowerCompanionProgressKind;
  progressIdentity?: string;
  ephemeralKind?: 'completion';
}>;

export function presentActivityFlowerSummary(
  presence: FlowerCompanionPresenceProjection,
  copy: ActivityFlowerSummaryCopy,
): ActivityFlowerSummary {
  if (presence.priority_status === 'idle') {
    return { visualText: '', accessibleText: copy.readyToAsk, presentationStatus: 'idle' };
  }
  if (presence.priority_status === 'unavailable') {
    return { visualText: '', accessibleText: copy.unavailable, presentationStatus: 'unavailable' };
  }
  if (presence.priority_status !== 'running' && presence.priority_status !== 'queued') {
    return { visualText: '', accessibleText: copy.readyToAsk, presentationStatus: 'idle' };
  }

  const status = presence.priority_status;
  const count = Math.max(1, Math.floor(presence.priority_count));
  const title = String(presence.priority_thread_title ?? '').trim();
  const progress = status === 'running'
    ? String(presence.priority_thread_progress ?? '').trim()
    : '';
  const lead = progress || copy.lead[status];
  const visualText = status === 'running' && progress
    ? progress
    : title
    ? count > 1
      ? copy.withTitleAndMore(lead, title, count - 1)
      : copy.withTitle(lead, title)
    : progress && count === 1
      ? progress
      : copy.withoutTitle(status, count);
  const backgroundRunningCount = status === 'running'
    ? Math.max(0, count - 1)
    : Math.max(0, Math.floor(presence.running_count));

  return {
    visualText,
    presentationStatus: status,
    ...(status === 'running' && progress
      ? {
          progressKind: presence.priority_thread_progress_kind ?? 'status',
          ...(presence.priority_thread_progress_identity
            ? { progressIdentity: presence.priority_thread_progress_identity }
            : {}),
        }
      : {}),
    accessibleText: backgroundRunningCount > 0
      ? `${visualText}. ${copy.secondaryWorking(backgroundRunningCount)}`
      : visualText,
  };
}

export function presentActivityFlowerCompletion(
  completed: string,
  title: string | undefined,
  copy: Pick<ActivityFlowerSummaryCopy, 'withTitle'>,
): ActivityFlowerSummary {
  const canonicalCompleted = completed.trim();
  const canonicalTitle = String(title ?? '').trim();
  const visualText = canonicalTitle
    ? copy.withTitle(canonicalCompleted, canonicalTitle)
    : canonicalCompleted;
  return {
    visualText,
    accessibleText: visualText,
    presentationStatus: 'completed',
    ephemeralKind: 'completion',
  };
}
