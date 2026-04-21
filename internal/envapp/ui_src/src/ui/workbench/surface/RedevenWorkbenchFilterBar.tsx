import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
  type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { Motion } from 'solid-motionone';
import { Layers, Plus } from '@floegence/floe-webapp-core/icons';
import { startPointerSession, type PointerSessionController } from '@floegence/floe-webapp-core/ui';
import type {
  WorkbenchWidgetDefinition,
  WorkbenchWidgetItem,
  WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';

import { startWorkbenchHotInteraction } from './workbenchHotInteraction';
import { WORKBENCH_EASING_OUT, WORKBENCH_MOTION_DURATION_FAST } from './workbenchMotion';

export interface RedevenWorkbenchFilterBarProps {
  widgetDefinitions: readonly WorkbenchWidgetDefinition[];
  widgets: readonly WorkbenchWidgetItem[];
  filters: Record<WorkbenchWidgetType, boolean>;
  /** Solo a single widget type — only this type remains visible. */
  onSoloFilter: (type: WorkbenchWidgetType) => void;
  /** Reset filters so every widget type is visible again. */
  onShowAll: () => void;
  /**
   * Called when the user drags a widget pill onto the canvas to create a
   * new widget of that type. Coordinates are in client space (clientX/Y).
   */
  onCreateAt?: (type: WorkbenchWidgetType, clientX: number, clientY: number) => void;
}

interface DragState {
  type: WorkbenchWidgetType;
  label: string;
  icon: Component<{ class?: string }>;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  clientX: number;
  clientY: number;
  moved: boolean;
  overCanvas: boolean;
  stopInteraction: () => void;
}

const DRAG_THRESHOLD_PX = 5;
const CANVAS_FRAME_SELECTOR = '[data-floe-workbench-canvas-frame="true"]';

function isOverCanvas(clientX: number, clientY: number): boolean {
  const frame = document.querySelector(CANVAS_FRAME_SELECTOR);
  if (!(frame instanceof HTMLElement)) return false;
  const rect = frame.getBoundingClientRect();
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

interface DockItemProps {
  type: WorkbenchWidgetType;
  label: string;
  icon: Component<{ class?: string }>;
  active: boolean;
  /** -1 = hovered, ±1 = adjacent (with -2 sentinel for left neighbor). */
  hoverOffset: number;
  isDragging: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onSolo: () => void;
  onDragBegin: (event: PointerEvent, type: WorkbenchWidgetType, label: string, icon: Component<{ class?: string }>) => void;
}

function DockItem(props: DockItemProps) {
  const tileMotion = () => {
    if (props.hoverOffset === -1) return { scale: 1.26, y: -6, x: 0 };
    if (props.hoverOffset === 1) return { scale: 1.08, y: -2, x: 5 };
    if (props.hoverOffset === -2) return { scale: 1.08, y: -2, x: -5 };
    return { scale: 1, y: 0, x: 0 };
  };

  const isHovered = () => props.hoverOffset === -1;

  const handlePointerDown: JSX.EventHandler<HTMLButtonElement, PointerEvent> = (event) => {
    if (event.button !== 0) return;
    props.onDragBegin(event, props.type, props.label, props.icon);
  };

  return (
    <button
      type="button"
      class="workbench-dock__item"
      classList={{
        'is-active': props.active,
        'is-hovered': isHovered(),
        'is-source-dragging': props.isDragging,
      }}
      aria-label={`${props.label} — click to solo, drag to canvas to create`}
      aria-pressed={props.active}
      onPointerEnter={() => props.onEnter()}
      onPointerLeave={() => props.onLeave()}
      onPointerDown={handlePointerDown}
    >
      <Motion.span
        class="workbench-dock__tile"
        animate={tileMotion()}
        transition={{ duration: WORKBENCH_MOTION_DURATION_FAST, easing: WORKBENCH_EASING_OUT }}
      >
        {(() => {
          const Icon = props.icon;
          return <Icon class="workbench-dock__icon" />;
        })()}
      </Motion.span>
      <Motion.span
        class="workbench-dock__tooltip"
        animate={{ opacity: isHovered() ? 1 : 0, y: isHovered() ? -6 : 0 }}
        transition={{ duration: WORKBENCH_MOTION_DURATION_FAST, easing: WORKBENCH_EASING_OUT }}
      >
        {props.label}
      </Motion.span>
    </button>
  );
}

export function RedevenWorkbenchFilterBar(props: RedevenWorkbenchFilterBarProps) {
  const [hoveredIndex, setHoveredIndex] = createSignal<number | null>(null);
  const [dragState, setDragState] = createSignal<DragState | null>(null);

  let dragSession: PointerSessionController | undefined;

  onCleanup(() => {
    dragSession?.stop({ reason: 'manual_stop', commit: false });
    dragSession = undefined;
    const current = dragState();
    current?.stopInteraction();
  });

  const allActive = createMemo(() =>
    props.widgetDefinitions.every((entry) => props.filters[entry.type])
  );

  // "All" pill = slot 0; widget types = slots 1..N.
  const offsetFor = (slot: number): number => {
    const hovered = hoveredIndex();
    if (hovered === null) return 0;
    if (hovered === slot) return -1;
    if (hovered === slot + 1) return -2;
    if (hovered === slot - 1) return 1;
    return 0;
  };

  const finalizeDrag = (commitDrop: boolean) => {
    const current = dragState();
    if (!current) return;

    const isClick = !current.moved;
    current.stopInteraction();
    setDragState(null);
    dragSession = undefined;

    if (isClick) {
      // No movement → treat as solo click.
      props.onSoloFilter(current.type);
      return;
    }

    if (commitDrop && current.overCanvas) {
      props.onCreateAt?.(current.type, current.clientX, current.clientY);
    }
  };

  const beginDragGesture = (
    event: PointerEvent,
    type: WorkbenchWidgetType,
    label: string,
    icon: Component<{ class?: string }>
  ) => {
    event.preventDefault();
    dragSession?.stop({ reason: 'manual_stop', commit: false });

    setDragState({
      type,
      label,
      icon,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
      overCanvas: false,
      stopInteraction: startWorkbenchHotInteraction({ kind: 'drag', cursor: 'grabbing' }),
    });

    const handleMove = (next: PointerEvent) => {
      setDragState((current) => {
        if (!current || current.pointerId !== next.pointerId) return current;
        const dx = next.clientX - current.startClientX;
        const dy = next.clientY - current.startClientY;
        const moved =
          current.moved ||
          Math.abs(dx) > DRAG_THRESHOLD_PX ||
          Math.abs(dy) > DRAG_THRESHOLD_PX;
        return {
          ...current,
          clientX: next.clientX,
          clientY: next.clientY,
          moved,
          overCanvas: moved && isOverCanvas(next.clientX, next.clientY),
        };
      });
    };

    dragSession = startPointerSession({
      pointerEvent: event,
      captureEl: event.currentTarget as HTMLElement,
      onMove: handleMove,
      onEnd: ({ commit }) => finalizeDrag(commit),
    });
  };

  const draggingType = (): WorkbenchWidgetType | null => dragState()?.type ?? null;

  return (
    <>
      <div
        class="workbench-dock"
        data-floe-canvas-interactive="true"
        onPointerLeave={() => setHoveredIndex(null)}
      >
        <button
          type="button"
          class="workbench-dock__item"
          classList={{ 'is-active': allActive(), 'is-hovered': hoveredIndex() === 0 }}
          aria-label="Show all widgets"
          aria-pressed={allActive()}
          onPointerEnter={() => setHoveredIndex(0)}
          onPointerLeave={() =>
            setHoveredIndex((current) => (current === 0 ? null : current))
          }
          onClick={() => props.onShowAll()}
        >
          <Motion.span
            class="workbench-dock__tile"
            animate={{
              scale: hoveredIndex() === 0 ? 1.26 : 1,
              y: hoveredIndex() === 0 ? -6 : 0,
              x: hoveredIndex() === 1 ? -5 : 0,
            }}
            transition={{ duration: WORKBENCH_MOTION_DURATION_FAST, easing: WORKBENCH_EASING_OUT }}
          >
            <Layers class="workbench-dock__icon" />
          </Motion.span>
          <Motion.span
            class="workbench-dock__tooltip"
            animate={{
              opacity: hoveredIndex() === 0 ? 1 : 0,
              y: hoveredIndex() === 0 ? -6 : 0,
            }}
            transition={{ duration: WORKBENCH_MOTION_DURATION_FAST, easing: WORKBENCH_EASING_OUT }}
          >
            Show all widgets
          </Motion.span>
        </button>
        <span class="workbench-dock__divider" aria-hidden="true" />
        <For each={props.widgetDefinitions}>
          {(entry, index) => {
            const slot = () => index() + 1;
            return (
              <DockItem
                type={entry.type}
                label={entry.label}
                icon={entry.icon}
                active={props.filters[entry.type]}
                hoverOffset={offsetFor(slot())}
                isDragging={draggingType() === entry.type}
                onEnter={() => setHoveredIndex(slot())}
                onLeave={() =>
                  setHoveredIndex((current) => (current === slot() ? null : current))
                }
                onSolo={() => props.onSoloFilter(entry.type)}
                onDragBegin={beginDragGesture}
              />
            );
          }}
        </For>
      </div>

      <Show when={(dragState()?.moved ?? false) as boolean}>
        <DragGhost state={dragState} />
      </Show>
    </>
  );
}

interface DragGhostProps {
  /**
   * Passed as an accessor so the ghost component is mounted *once* at drag
   * start and updates via fine-grained reactivity on each pointermove —
   * instead of being re-created from scratch when the reactive `when`
   * object identity changes each frame.
   */
  state: () => DragState | null;
}

function DragGhost(props: DragGhostProps) {
  // Anchor offset: +14px right, -56px up of the cursor. Applying it here
  // inside the transform keeps positioning on the GPU composite layer and
  // avoids any layout reads on pointermove.
  const transform = () => {
    const state = props.state();
    if (!state) return 'translate3d(0px, 0px, 0)';
    return `translate3d(${state.clientX + 14}px, ${state.clientY - 56}px, 0)`;
  };

  const overCanvas = () => props.state()?.overCanvas ?? false;
  const label = () => props.state()?.label ?? '';
  const Icon = () => props.state()?.icon;

  return (
    <Portal>
      <div
        class="workbench-dock-ghost"
        classList={{ 'is-over-canvas': overCanvas() }}
        style={{ transform: transform() }}
        aria-hidden="true"
      >
        <div class="workbench-dock-ghost__halo" />
        <div class="workbench-dock-ghost__card">
          <div class="workbench-dock-ghost__icon">
            <Show when={Icon()}>
              {(Comp) => {
                const C = Comp();
                return <C class="w-4 h-4" />;
              }}
            </Show>
          </div>
          <div class="workbench-dock-ghost__copy">
            <div class="workbench-dock-ghost__title">{label()}</div>
            <div class="workbench-dock-ghost__hint">
              <Plus class="w-3 h-3" />
              <span>{overCanvas() ? 'Drop to create' : 'Drag onto canvas'}</span>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
