// Floating browser FAB for the chat page.
// The FAB lives inside the message area and can be dragged to any edge.
import { Show, createMemo, createSignal, untrack } from 'solid-js';
import { Motion } from 'solid-motionone';
import { Folder } from '@floegence/floe-webapp-core/icons';
import { normalizePath } from './FileBrowserShared';
import { useFileBrowserSurfaceContext } from './FileBrowserSurfaceContext';

export interface ChatFileBrowserFABProps {
  workingDir: string;
  homePath?: string;
  enabled?: boolean;
  /** Ref to the container element that bounds the FAB drag area. */
  containerRef?: HTMLElement;
}

function normalizeAbsolutePath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw || !raw.startsWith('/')) return '';
  return normalizePath(raw);
}

const FAB_SIZE = 44;
const EDGE_MARGIN = 12;
export function ChatFileBrowserFAB(props: ChatFileBrowserFABProps) {
  const fileBrowserSurface = useFileBrowserSurfaceContext();
  const [fabLeft, setFabLeft] = createSignal<number | null>(null);
  const [fabTop, setFabTop] = createSignal<number | null>(null);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isSnapping, setIsSnapping] = createSignal(false);
  let dragStart: { px: number; py: number; fabLeft: number; fabTop: number } | null = null;

  const browserSeed = createMemo(() => {
    const path = normalizeAbsolutePath(props.workingDir);
    if (!path) return null;
    const homePath = normalizeAbsolutePath(props.homePath ?? '');
    return {
      path,
      homePath: homePath || undefined,
    };
  });

  function snapToEdge(left: number, top: number) {
    const ct = props.containerRef;
    if (!ct) {
      setFabLeft(left);
      setFabTop(top);
      return;
    }
    const cw = ct.clientWidth;
    const ch = ct.clientHeight;
    const clampedLeft = Math.max(EDGE_MARGIN, Math.min(left, cw - FAB_SIZE - EDGE_MARGIN));
    const clampedTop = Math.max(EDGE_MARGIN, Math.min(top, ch - FAB_SIZE - EDGE_MARGIN));

    const dLeft = clampedLeft;
    const dRight = cw - FAB_SIZE - clampedLeft;
    const dTop = clampedTop;
    const dBottom = ch - FAB_SIZE - clampedTop;
    const minDist = Math.min(dLeft, dRight, dTop, dBottom);

    let snapLeft = clampedLeft;
    let snapTop = clampedTop;
    if (minDist === dLeft) {
      snapLeft = EDGE_MARGIN;
    } else if (minDist === dRight) {
      snapLeft = cw - FAB_SIZE - EDGE_MARGIN;
    } else if (minDist === dTop) {
      snapTop = EDGE_MARGIN;
    } else {
      snapTop = ch - FAB_SIZE - EDGE_MARGIN;
    }

    setIsSnapping(true);
    setFabLeft(snapLeft);
    setFabTop(snapTop);
    requestAnimationFrame(() => {
      setTimeout(() => setIsSnapping(false), 250);
    });
  }

  function onFabPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    const button = event.currentTarget as HTMLElement;
    button.setPointerCapture(event.pointerId);

    let currentLeft = fabLeft();
    let currentTop = fabTop();
    if (currentLeft == null || currentTop == null) {
      const ct = props.containerRef;
      if (ct) {
        currentLeft = ct.clientWidth - FAB_SIZE - EDGE_MARGIN;
        currentTop = ct.clientHeight - FAB_SIZE - EDGE_MARGIN;
      } else {
        currentLeft = 0;
        currentTop = 0;
      }
      setFabLeft(currentLeft);
      setFabTop(currentTop);
    }

    dragStart = {
      px: event.clientX,
      py: event.clientY,
      fabLeft: currentLeft,
      fabTop: currentTop,
    };
  }

  function onFabPointerMove(event: PointerEvent) {
    if (!dragStart) return;
    const dx = event.clientX - dragStart.px;
    const dy = event.clientY - dragStart.py;
    if (!isDragging() && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    setIsDragging(true);

    let newLeft = dragStart.fabLeft + dx;
    let newTop = dragStart.fabTop + dy;

    const ct = props.containerRef;
    if (ct) {
      newLeft = Math.max(0, Math.min(newLeft, ct.clientWidth - FAB_SIZE));
      newTop = Math.max(0, Math.min(newTop, ct.clientHeight - FAB_SIZE));
    }

    setFabLeft(newLeft);
    setFabTop(newTop);
  }

  function onFabPointerUp(_event: PointerEvent) {
    if (!dragStart) return;
    const wasDrag = isDragging();
    dragStart = null;
    setIsDragging(false);

    if (wasDrag) {
      snapToEdge(fabLeft()!, fabTop()!);
      return;
    }

    void (async () => {
      const browser = untrack(browserSeed);
      if (!browser) return;
      await fileBrowserSurface.openBrowser(browser);
    })();
  }

  const showFab = () => (props.enabled ?? true) && !fileBrowserSurface.controller.open();

  const fabStyle = () => {
    const left = fabLeft();
    const top = fabTop();
    if (left == null || top == null) {
      return {};
    }
    return {
      left: `${left}px`,
      top: `${top}px`,
      right: 'auto',
      bottom: 'auto',
      transition: isSnapping() ? 'left 0.25s ease-out, top 0.25s ease-out' : 'none',
    };
  };

  return (
    <Show when={showFab()}>
      <div class="redeven-fab-file-browser" style={fabStyle()}>
        <Motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, easing: 'ease-out' }}
        >
          <button
            class="redeven-fab-file-browser-btn"
            title="Browse files"
            onPointerDown={onFabPointerDown}
            onPointerMove={onFabPointerMove}
            onPointerUp={onFabPointerUp}
          >
            <Folder class="w-5 h-5" />
          </button>
        </Motion.div>
      </div>
    </Show>
  );
}
