import { For, createUniqueId, type Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

const RUN_INDICATOR_NODES = [
  { x: 20.64, y: 8.04 },
  { x: 10.18, y: 22.6 },
  { x: 32.11, y: 22.49 },
  { x: 13.61, y: 30.61 },
  { x: 23.74, y: 30.98 },
  { x: 20, y: 20 },
] as const;

const TO_CENTER_CONNECTIONS = [
  [0, 5],
  [1, 5],
  [2, 5],
  [3, 5],
  [4, 5],
] as const;

const TO_CENTER_DELAYS_SECONDS = [0, 0.22, 0.44, 0.66, 0.88] as const;

const SIDE_CONNECTIONS = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 4],
  [3, 4],
] as const;

const SIDE_DELAYS_MS = [120, 210, 300, 150, 240] as const;
const NODE_DELAYS_MS = [0, 200, 400, 600, 800, 100] as const;

export interface FlowerMessageRunIndicatorProps {
  phaseLabel?: string;
  class?: string;
}

export const FlowerMessageRunIndicator: Component<FlowerMessageRunIndicatorProps> = (props) => {
  const filterId = `flower-message-run-indicator-${createUniqueId()}`;
  const label = () => String(props.phaseLabel ?? '').trim() || 'Working...';

  return (
    <div class={cn('flower-message-run-indicator', props.class)} role="status" aria-live="polite">
      <div class="flower-message-run-indicator-surface">
        <svg class="flower-message-run-indicator-graph" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <defs>
            <filter id={filterId}>
              <feGaussianBlur stdDeviation="1" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g stroke="var(--primary)" stroke-width="0.8" fill="none">
            <For each={TO_CENTER_CONNECTIONS}>
              {([from, to], index) => (
                <line
                  x1={RUN_INDICATOR_NODES[from].x}
                  y1={RUN_INDICATOR_NODES[from].y}
                  x2={RUN_INDICATOR_NODES[to].x}
                  y2={RUN_INDICATOR_NODES[to].y}
                  pathLength="1"
                  stroke-dasharray="1"
                  stroke-dashoffset="1"
                  class="flower-message-run-indicator-center-line"
                  style={{ 'animation-delay': `${TO_CENTER_DELAYS_SECONDS[index()]}s` }}
                />
              )}
            </For>

            <For each={SIDE_CONNECTIONS}>
              {([from, to], index) => (
                <line
                  x1={RUN_INDICATOR_NODES[from].x}
                  y1={RUN_INDICATOR_NODES[from].y}
                  x2={RUN_INDICATOR_NODES[to].x}
                  y2={RUN_INDICATOR_NODES[to].y}
                  class="flower-message-run-indicator-side-line"
                  style={{ 'animation-delay': `${SIDE_DELAYS_MS[index()]}ms` }}
                />
              )}
            </For>
          </g>

          <g>
            <For each={TO_CENTER_CONNECTIONS}>
              {([from, to], index) => (
                <circle r="1.2" fill="var(--primary)" opacity="0.8">
                  <animateMotion
                    dur="1.05s"
                    repeatCount="indefinite"
                    begin={`${TO_CENTER_DELAYS_SECONDS[index()]}s`}
                    path={`M${RUN_INDICATOR_NODES[from].x},${RUN_INDICATOR_NODES[from].y} L${RUN_INDICATOR_NODES[to].x},${RUN_INDICATOR_NODES[to].y}`}
                  />
                </circle>
              )}
            </For>
          </g>

          <g filter={`url(#${filterId})`}>
            <For each={RUN_INDICATOR_NODES}>
              {(node, index) => (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={index() === 5 ? 2.5 : 2}
                  fill="var(--primary)"
                  class="flower-message-run-indicator-node"
                  style={{ 'animation-delay': `${NODE_DELAYS_MS[index()]}ms` }}
                />
              )}
            </For>
          </g>
        </svg>

        <span class="flower-message-run-indicator-label">{label()}</span>

        <div class="flower-message-run-indicator-bars" aria-hidden="true">
          <span class="flower-message-run-indicator-bar" style={{ 'animation-delay': '0ms' }} />
          <span class="flower-message-run-indicator-bar" style={{ 'animation-delay': '100ms' }} />
          <span class="flower-message-run-indicator-bar" style={{ 'animation-delay': '200ms' }} />
          <span class="flower-message-run-indicator-bar" style={{ 'animation-delay': '300ms' }} />
        </div>
      </div>
    </div>
  );
};
