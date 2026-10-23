import './flower-thinking-icon.css';

/** Decorative progress for the disclosure's confirmed live thinking state. */
export function FlowerThinkingIcon() {
  return (
    <span class="flower-thinking-flower" aria-hidden="true">
      {[0, 72, 144, 216, 288].map(angle => (
        <span class="flower-thinking-petal" style={{ transform: `rotate(${angle}deg)` }}>
          <span class="flower-thinking-ink" />
        </span>
      ))}
      <span class="flower-thinking-center"><span class="flower-thinking-center-ink" /></span>
    </span>
  );
}
