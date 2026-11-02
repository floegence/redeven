export type wire_terminal_view = {
  id: string;
  name: string;
  layout_json: string;
  revision: number;
  created_at_ms: number;
  updated_at_ms: number;
};
export type wire_terminal_view_snapshot_resp = { revision: number; views: wire_terminal_view[] };
export type wire_terminal_view_put_req = { id: string; name: string; layout_json: string; base_revision: number };
export type wire_terminal_view_delete_req = { id: string; base_revision: number };

export type wire_terminal_views_update_req = { changes: Array<{ id: string; name?: string; layout_json?: string; base_revision: number; delete?: boolean }> };
