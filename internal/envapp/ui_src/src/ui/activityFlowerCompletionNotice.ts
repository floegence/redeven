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
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  candidateGraceMs?: number;
  noticeDurationMs?: number;
}>;

type Candidate = Readonly<{
  generation: number;
  threadID: string;
  runID: string;
  runGeneration: number;
  title?: string;
  lastActiveAt: number;
}>;

export function activityFlowerCompletionUpdatesAllowed(
  accessGateVisible: boolean,
  placement: 'collapsed' | 'expanded' | 'full_page',
): boolean {
  return !accessGateVisible && placement === 'collapsed';
}

export class ActivityFlowerCompletionNoticeController {
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private readonly candidateGraceMs: number;
  private readonly noticeDurationMs: number;
  private candidate: Candidate | null = null;
  private candidateTimer: TimerHandle | null = null;
  private noticeTimer: TimerHandle | null = null;
  private noticeGeneration = 0;
  private candidateGeneration = 0;
  private disposed = false;

  constructor(private readonly options: ActivityFlowerCompletionNoticeControllerOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    this.candidateGraceMs = options.candidateGraceMs ?? 5_000;
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
        generation: sameCandidate ? this.candidate!.generation : ++this.candidateGeneration,
        threadID: presence.priority_thread_id,
        runID: presence.priority_run_id,
        runGeneration: presence.priority_run_generation,
        ...(presence.priority_thread_title || (sameCandidate ? this.candidate?.title : undefined)
          ? { title: presence.priority_thread_title || this.candidate!.title }
          : {}),
        lastActiveAt: this.now(),
      });
    } else if (presence.running_count > 0) {
      this.dropCandidate();
    }

    const terminal = presence.terminal_transition;
    if (!terminal || !this.candidate) return;
    const matches = terminal.thread_id === this.candidate.threadID
      && terminal.run_id === this.candidate.runID
      && terminal.run_generation === this.candidate.runGeneration;
    if (!matches || this.now() - this.candidate.lastActiveAt > this.candidateGraceMs) return;
    if (terminal.outcome !== 'completed' || active) {
      this.dropCandidate();
      return;
    }
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
    if (this.candidateTimer !== null) this.clearTimer(this.candidateTimer);
    const generation = candidate.generation;
    this.candidateTimer = this.setTimer(() => {
      if (this.candidate?.generation !== generation) return;
      this.candidate = null;
      this.candidateTimer = null;
    }, this.candidateGraceMs);
  }

  private dropCandidate(): void {
    this.candidate = null;
    if (this.candidateTimer !== null) this.clearTimer(this.candidateTimer);
    this.candidateTimer = null;
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
