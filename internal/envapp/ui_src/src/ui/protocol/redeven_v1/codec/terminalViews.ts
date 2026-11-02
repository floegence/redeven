import type { JsonValue } from '@floegence/flowersec-core';
import type { TerminalViewSnapshot, TerminalViewPutRequest, TerminalViewDeleteRequest, TerminalViewsUpdateRequest } from '../sdk/terminalViews';
import type { wire_terminal_view_snapshot_resp, wire_terminal_view_put_req, wire_terminal_view_delete_req, wire_terminal_views_update_req } from '../wire/terminalViews';
export function fromWireTerminalViewSnapshot(value: wire_terminal_view_snapshot_resp): TerminalViewSnapshot {
  if (!Number.isSafeInteger(value.revision) || value.revision < 1 || value.views.length > 64) throw new Error('Invalid terminal view catalog');
  const ids = new Set<string>();
  const views = value.views.map(view => {
    if (view.layout_json.length > 65536) throw new Error('Invalid terminal view layout');
    const layout: JsonValue = JSON.parse(view.layout_json);
    if (!view.id || ids.has(view.id) || !view.name.trim() || !Number.isSafeInteger(view.revision) || view.revision < 1 || view.revision > value.revision || !layout || typeof layout !== 'object' || Array.isArray(layout)) throw new Error('Invalid terminal view');
    ids.add(view.id);
    return { id: view.id, name: view.name, layout, revision: view.revision, createdAtMs: view.created_at_ms, updatedAtMs: view.updated_at_ms };
  });
  return { revision: value.revision, views };
}
export function toWireTerminalViewPutRequest(req: TerminalViewPutRequest): wire_terminal_view_put_req {
  return { id: req.id, name: req.name, layout_json: JSON.stringify(req.layout), base_revision: req.baseRevision };
}
export function toWireTerminalViewDeleteRequest(req: TerminalViewDeleteRequest): wire_terminal_view_delete_req {
  return { id: req.id, base_revision: req.baseRevision };
}

export function toWireTerminalViewsUpdateRequest(req: TerminalViewsUpdateRequest): wire_terminal_views_update_req {
  return { changes: req.changes.map(change => 'delete' in change ? { id: change.id, base_revision: change.baseRevision, delete: true } : toWireTerminalViewPutRequest(change)) };
}
