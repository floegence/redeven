import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readDesktopActionPopoverSource(): string {
  return fs.readFileSync(path.join(__dirname, 'DesktopActionPopover.tsx'), 'utf8');
}

function readDesktopAnchoredOverlaySurfaceSource(): string {
  return fs.readFileSync(path.join(__dirname, 'DesktopAnchoredOverlaySurface.tsx'), 'utf8');
}

describe('DesktopActionPopover', () => {
  it('uses pointer and keyboard dismissal without hover or focusout-driven visibility', () => {
    const source = readDesktopActionPopoverSource();
    const overlaySource = readDesktopAnchoredOverlaySurfaceSource();

    expect(source).toContain('data-redeven-action-popover-anchor=""');
    expect(source).toContain('redeven-action-popover-frame');
    expect(source).toContain('requestAnimationFrame(() => {');
    expect(source).toContain('firstFocusableElement(popoverRef)?.focus();');
    expect(source).toContain('placement="top"');
    expect(overlaySource).toContain('data-placement-lock={props.placementLock}');
    expect(source).toContain('allowMainAxisOverflow?: boolean;');
    expect(source).toContain('allowMainAxisOverflow={props.allowMainAxisOverflow ?? true}');
    expect(source).toContain('onAnchorPointerDown?: JSX.EventHandlerUnion<HTMLSpanElement, PointerEvent>;');
    expect(source).toContain('onExitComplete?: () => void;');
    expect(source).toContain('onPointerDown={props.onAnchorPointerDown}');
    expect(source).toContain('const stopSurfacePointerDownPropagation = (event: PointerEvent) => {');
    expect(source).toContain('event.stopPropagation();');
    expect(source).toContain('onPointerDownCapture={stopSurfacePointerDownPropagation}');
    expect(source).toContain('const [closingFrameHTML, setClosingFrameHTML] = createSignal<string | null>(null);');
    expect(source).toContain('let latestFrameHTML: string | null = null;');
    expect(source).toContain('let frameObserver: MutationObserver | null = null;');
    expect(source).toContain('const captureCurrentFrameHTML = (): string | null => {');
    expect(source).toContain('setClosingFrameHTML(captureCurrentFrameHTML() ?? latestFrameHTML);');
    expect(source).toContain('setClosingFrameHTML(closingFrameHTML() ?? latestFrameHTML ?? captureCurrentFrameHTML());');
    expect(source).toContain('frameObserver = new MutationObserver(() => {');
    expect(source).toContain('clearFrameObserver();');
    expect(source).toContain('innerHTML={html()}');
    expect(source).toContain('props.onExitComplete?.();');
    expect(source).toContain('positionFrozen={closing()}');
    expect(overlaySource).toContain('positionFrozen?: boolean;');
    expect(overlaySource).toContain('if (props.positionFrozen === true) {\n      return;\n    }');
    expect(overlaySource).toContain('if (props.positionFrozen === true) {\n      clearFrame();\n      return;\n    }');
    expect(overlaySource).toContain('onPointerDownCapture?: (event: PointerEvent) => void;');
    expect(overlaySource).toContain("element.addEventListener('pointerdown', handlePointerDownCapture, true);");
    expect(overlaySource).toContain("pointerCaptureElement.removeEventListener('pointerdown', handlePointerDownCapture, true);");
    expect(source).not.toContain('placement?:');
    expect(source).not.toContain('DesktopOverlayPlacement;');
    expect(source).not.toMatch(/\bprops\.placement\b(?!Lock)/u);
    expect(source).toContain("document.addEventListener('pointerdown', handlePointerDown, true);");
    expect(source).toContain("document.removeEventListener('pointerdown', handlePointerDown, true);");
    expect(source).not.toContain("document.addEventListener('mousedown', handlePointerDown);");
    expect(source).toContain("document.addEventListener('keydown', handleKeyDown);");
    expect(source).toContain("document.addEventListener('focusin', handleFocusIn);");
    expect(source).toContain("event.key === 'Escape'");
    expect(source).not.toContain('onMouseEnter={');
    expect(source).not.toContain('onMouseLeave={');
    expect(source).not.toContain('onFocusOut={');
    expect(overlaySource).toContain('const schedulePositionSettlingUpdates = () => {');
    expect(overlaySource).toContain('followUpFrames = 4;');
    expect(overlaySource).toContain('if (followUpFrames > 0) {');
  });
});
