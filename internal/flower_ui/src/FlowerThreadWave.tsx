/** Shared decorative running indicator for thread rows and history loading. */
export function FlowerThreadWave() {
  return <span class="flower-thread-wave h-2 items-center gap-0.5" aria-hidden="true">
    <span class="flower-thread-wave-bar" style="animation-delay: 0ms" />
    <span class="flower-thread-wave-bar" style="animation-delay: 180ms" />
    <span class="flower-thread-wave-bar" style="animation-delay: 360ms" />
    <span class="flower-thread-wave-bar" style="animation-delay: 540ms" />
  </span>;
}
