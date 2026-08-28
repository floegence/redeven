import type { FlowerCompanionPresenceProjection } from '../../../../flower_ui/src';

export type ActivityFlowerCompletionNotice = Readonly<{
  generation: number;
  threadID: string;
  runID: string;
  title?: string;
}>;

type TimerHandle = ReturnType<typeof setTimeout>;

export type ActivityFlowerCompletionNoticeControllerOptions = Readonly<{
  onChange: (notice: ActivityFlowerCompletionNotice | null) => void;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  noticeDurationMs?: number;
}>;

type Candidate = Readonly<{
  threadID: string;
  runID: string;
  runGeneration: number;
  title?: string;
}>;

export function activityFlowerCompletionUpdatesAllowed(
  accessGateVisible: boolean,
  placement: 'collapsed' | 'expanded' | 'full_page',
): boolean {
  return !accessGateVisible && placement === 'collapsed';
}

export class ActivityFlowerCompletionNoticeController {
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private readonly noticeDurationMs: number;
  private candidate: Candidate | null = null;
  private noticeTimer: TimerHandle | null = null;
  private noticeGeneration = 0;
  private disposed = false;

  constructor(private readonly options: ActivityFlowerCompletionNoticeControllerOptions) {
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    this.noticeDurationMs = options.noticeDurationMs ?? 3_800;
  }

  update(presence: FlowerCompanionPresenceProjection): void {
    if (this.disposed) return;
    const active = presence.running_count > 0 || presence.queued_count > 0;
    if (presence.priority_status === 'unavailable' || (presence.running_count === 0 && presence.queued_count > 0)) {
      this.clear();
      return;
    }
    if (active) this.clearNotice();

    const identifiedRunning = (
      presence.priority_status === 'running'
      && presence.priority_thread_id
      && presence.priority_run_id
      && presence.priority_run_generation !== undefined
    );
    if (identifiedRunning) {
      const sameCandidate = this.candidate
        && this.candidate.threadID === presence.priority_thread_id
        && this.candidate.runID === presence.priority_run_id
        && this.candidate.runGeneration === presence.priority_run_generation;
      this.armCandidate({
        threadID: presence.priority_thread_id,
        runID: presence.priority_run_id,
        runGeneration: presence.priority_run_generation,
        ...(presence.priority_thread_title || (sameCandidate ? this.candidate?.title : undefined)
          ? { title: presence.priority_thread_title || this.candidate!.title }
          : {}),
      });
    } else if (presence.running_count > 0) {
      const terminal = presence.terminal_transition;
      const terminalMatchesCandidate = Boolean(terminal && this.candidate
        && terminal.thread_id === this.candidate.threadID
        && terminal.run_id === this.candidate.runID
        && terminal.run_generation === this.candidate.runGeneration);
      if (!terminalMatchesCandidate) this.dropCandidate();
    }

    const terminal = presence.terminal_transition;
    if (!terminal || !this.candidate) return;
    const matches = terminal.thread_id === this.candidate.threadID
      && terminal.run_id === this.candidate.runID
      && terminal.run_generation === this.candidate.runGeneration;
    if (!matches) return;
    if (terminal.outcome !== 'completed') {
      this.dropCandidate();
      return;
    }
    // Typed current can reach its terminal view shortly before the canonical
    // summary leaves running. Keep the exact candidate through that
    // gap; the unchanged terminal receipt will complete it on summary update.
    if (active) return;
    this.showNotice(this.candidate);
    this.dropCandidate();
  }

  clear(): void {
    this.dropCandidate();
    this.clearNotice();
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  private armCandidate(candidate: Candidate): void {
    this.candidate = candidate;
  }

  private dropCandidate(): void {
    this.candidate = null;
  }

  private showNotice(candidate: Candidate): void {
    const generation = ++this.noticeGeneration;
    const notice: ActivityFlowerCompletionNotice = {
      generation,
      threadID: candidate.threadID,
      runID: candidate.runID,
      ...(candidate.title ? { title: candidate.title } : {}),
    };
    if (this.noticeTimer !== null) this.clearTimer(this.noticeTimer);
    this.options.onChange(notice);
    this.noticeTimer = this.setTimer(() => {
      if (generation !== this.noticeGeneration) return;
      this.noticeTimer = null;
      this.options.onChange(null);
    }, this.noticeDurationMs);
  }

  private clearNotice(): void {
    this.noticeGeneration += 1;
    if (this.noticeTimer !== null) this.clearTimer(this.noticeTimer);
    this.noticeTimer = null;
    this.options.onChange(null);
  }
}
