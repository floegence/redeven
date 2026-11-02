import { expect, it } from 'vitest';
import { fromWireTerminalViewSnapshot, toWireTerminalViewPutRequest } from './terminalViews';
const layout = { type: 'split' as const, id: 's', axis: 'x' as const, ratio: 0.4, first: { type: 'pane' as const, id: 'a' }, second: { type: 'pane' as const, id: 'b' } };
const wireView = { id: 'view', name: 'Services', layout_json: JSON.stringify(layout), revision: 2, created_at_ms: 10, updated_at_ms: 20 };
it('round trips a published split layout across the opaque JSON wire field', () => {
  const decoded = fromWireTerminalViewSnapshot({ revision: 2, views: [wireView] });
  expect(decoded.views[0]).toMatchObject({ layout, createdAtMs: 10, updatedAtMs: 20 });
  expect(toWireTerminalViewPutRequest({ ...decoded.views[0], baseRevision: 2 })).toEqual({ id: 'view', name: 'Services', layout_json: wireView.layout_json, base_revision: 2 });
});
it.each(['{', 'null', '[]', '42'])('rejects invalid layout JSON %s', layout_json => {
  expect(() => fromWireTerminalViewSnapshot({ revision: 2, views: [{ ...wireView, layout_json }] })).toThrow();
});
it('rejects duplicate view IDs and revisions newer than their snapshot', () => {
  expect(() => fromWireTerminalViewSnapshot({ revision: 2, views: [wireView, wireView] })).toThrow();
  expect(() => fromWireTerminalViewSnapshot({ revision: 1, views: [wireView] })).toThrow();
});
