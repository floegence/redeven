// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkbenchTerminalVisualCoordinator } from './workbenchTerminalVisualCoordinator';

function createFakeCore() {
  return {
    beginVisualSuspend: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

function createSurface(): HTMLDivElement {
  const surface = document.createElement('div');
  document.body.appendChild(surface);
  return surface;
}

describe('workbench terminal visual coordinator', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('keeps registered terminals live during workbench interactions', () => {
    const coordinator = createWorkbenchTerminalVisualCoordinator();
    const core = createFakeCore();
    const surface = createSurface();

    coordinator.registerCore('widget-1', 'session-1', core as any);
    coordinator.registerSurface('widget-1', 'session-1', surface);

    const token = coordinator.beginInteraction('viewport_pan');

    expect(token.kind).toBe('viewport_pan');
    expect(core.beginVisualSuspend).not.toHaveBeenCalled();
    expect(coordinator.getDiagnostics()).toMatchObject({
      activeInteractionCount: 1,
      registeredTerminalCount: 1,
    });

    token.end();

    expect(core.beginVisualSuspend).not.toHaveBeenCalled();
    expect(coordinator.getDiagnostics()).toMatchObject({
      activeInteractionCount: 0,
      registeredTerminalCount: 1,
    });
  });

  it('tracks nested interaction release handles without touching terminal rendering', () => {
    const coordinator = createWorkbenchTerminalVisualCoordinator();
    const core = createFakeCore();

    coordinator.registerCore('widget-1', 'session-1', core as any);

    const first = coordinator.beginInteraction('widget_drag');
    const second = coordinator.beginInteraction('widget_maximize');

    expect(coordinator.getDiagnostics().activeInteractionCount).toBe(2);
    expect(core.beginVisualSuspend).not.toHaveBeenCalled();

    first.end();
    expect(coordinator.getDiagnostics().activeInteractionCount).toBe(1);

    second.end();
    expect(coordinator.getDiagnostics().activeInteractionCount).toBe(0);
    expect(core.beginVisualSuspend).not.toHaveBeenCalled();
  });

  it('ignores duplicate token endings', () => {
    const coordinator = createWorkbenchTerminalVisualCoordinator();
    const token = coordinator.beginInteraction('widget_resize');

    token.end();
    token.end();

    expect(coordinator.getDiagnostics().activeInteractionCount).toBe(0);
  });

  it('removes registrations after both the core and surface detach', () => {
    const coordinator = createWorkbenchTerminalVisualCoordinator();
    const core = createFakeCore();
    const surface = createSurface();

    coordinator.registerCore('widget-1', 'session-1', core as any);
    coordinator.registerSurface('widget-1', 'session-1', surface);
    expect(coordinator.getDiagnostics().registeredTerminalCount).toBe(1);

    coordinator.registerCore('widget-1', 'session-1', null);
    expect(coordinator.getDiagnostics().registeredTerminalCount).toBe(1);

    coordinator.registerSurface('widget-1', 'session-1', null);
    expect(coordinator.getDiagnostics().registeredTerminalCount).toBe(0);
  });

  it('tracks the selected widget only as diagnostics metadata', () => {
    const coordinator = createWorkbenchTerminalVisualCoordinator();

    coordinator.setSelectedWidgetId(' widget-2 ');

    expect(coordinator.getDiagnostics().selectedWidgetId).toBe('widget-2');
  });

  it('clears registrations and interaction state on dispose', () => {
    const coordinator = createWorkbenchTerminalVisualCoordinator();
    coordinator.registerCore('widget-1', 'session-1', createFakeCore() as any);
    coordinator.setSelectedWidgetId('widget-1');
    coordinator.beginInteraction('widget_drag');

    coordinator.dispose();

    expect(coordinator.getDiagnostics()).toEqual({
      activeInteractionCount: 0,
      registeredTerminalCount: 0,
      selectedWidgetId: '',
    });
  });
});
