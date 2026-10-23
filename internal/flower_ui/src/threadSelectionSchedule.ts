/** Present visible selection feedback before transcript work; hidden documents cannot await rAF. */
export function scheduleThreadSelectionCommit(options: Readonly<{
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  presented: () => void;
  commit: () => void;
}>): () => void {
  let active = true;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (frame) options.cancelFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
    frame = 0; timer = undefined;
  };
  const cancel = () => { active = false; clear(); options.document.removeEventListener('visibilitychange', visibility); };
  const commit = () => { if (!active) return; cancel(); options.commit(); };
  const afterFrame = () => {
    frame = 0;
    if (!active) return;
    options.presented();
    timer = setTimeout(commit, 0);
  };
  const schedule = () => {
    clear();
    if (options.document.visibilityState === 'hidden') timer = setTimeout(commit, 0);
    // The second callback runs after the first feedback rendering opportunity.
    // Commit in a task so expensive transcript work cannot consume that paint.
    else frame = options.requestFrame(() => { frame = options.requestFrame(afterFrame); });
  };
  const visibility = () => { if (active) schedule(); };
  options.document.addEventListener('visibilitychange', visibility);
  schedule();
  return cancel;
}
