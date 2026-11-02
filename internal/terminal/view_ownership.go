package terminal

import (
	"database/sql"
	"encoding/json"
	"sort"
	"time"
)

// This is the persisted layout contract, not an interactive layout engine.
type viewLayoutNode struct {
	Type   string          `json:"type"`
	ID     string          `json:"id"`
	Axis   string          `json:"axis,omitempty"`
	Ratio  float64         `json:"ratio,omitempty"`
	First  *viewLayoutNode `json:"first,omitempty"`
	Second *viewLayoutNode `json:"second,omitempty"`
}

func viewSessionIDs(layout string) []string {
	var root viewLayoutNode
	_ = json.Unmarshal([]byte(layout), &root)
	var ids []string
	var visit func(*viewLayoutNode)
	visit = func(node *viewLayoutNode) {
		if node == nil {
			return
		}
		if node.Type == "pane" {
			ids = append(ids, node.ID)
			return
		}
		visit(node.First)
		visit(node.Second)
	}
	visit(&root)
	return ids
}
func validateViewOwnership(views map[string]TerminalView) error {
	owners := map[string]string{}
	for id, view := range views {
		for _, session := range viewSessionIDs(view.LayoutJSON) {
			if owner := owners[session]; owner != "" && owner != id {
				return errViewConflict
			}
			owners[session] = id
		}
	}
	return nil
}
func readViewsTx(tx *sql.Tx) (map[string]TerminalView, error) {
	rows, err := tx.Query("SELECT id,name,layout_json,revision,created_at_ms,updated_at_ms FROM terminal_views")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	views := map[string]TerminalView{}
	for rows.Next() {
		var v TerminalView
		if err = rows.Scan(&v.ID, &v.Name, &v.LayoutJSON, &v.Revision, &v.CreatedAtMs, &v.UpdatedAtMs); err != nil {
			return nil, err
		}
		views[v.ID] = v
	}
	return views, rows.Err()
}

// Released v1 allowed aliases. The most recently edited view keeps each session;
// older layouts collapse only duplicate leaves. Sessions and PTYs are untouched.
func migrateViewOwnership(tx *sql.Tx) error {
	views, err := readViewsTx(tx)
	if err != nil {
		return err
	}
	ordered := make([]TerminalView, 0, len(views))
	for _, view := range views {
		ordered = append(ordered, view)
	}
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].Revision != ordered[j].Revision {
			return ordered[i].Revision > ordered[j].Revision
		}
		if ordered[i].CreatedAtMs != ordered[j].CreatedAtMs {
			return ordered[i].CreatedAtMs > ordered[j].CreatedAtMs
		}
		return ordered[i].ID < ordered[j].ID
	})
	var revision uint64
	if err = tx.QueryRow("SELECT revision FROM terminal_view_catalog WHERE singleton_id=1").Scan(&revision); err != nil {
		return err
	}
	seen := map[string]bool{}
	changed := false
	for _, view := range ordered {
		var root viewLayoutNode
		if err = json.Unmarshal([]byte(view.LayoutJSON), &root); err != nil {
			return err
		}
		duplicate := false
		var prune func(*viewLayoutNode) *viewLayoutNode
		prune = func(node *viewLayoutNode) *viewLayoutNode {
			if node.Type == "pane" {
				if seen[node.ID] {
					duplicate = true
					return nil
				}
				seen[node.ID] = true
				return node
			}
			node.First = prune(node.First)
			node.Second = prune(node.Second)
			if node.First == nil {
				return node.Second
			}
			if node.Second == nil {
				return node.First
			}
			return node
		}
		next := prune(&root)
		if !duplicate {
			continue
		}
		changed = true
		if next == nil {
			_, err = tx.Exec("DELETE FROM terminal_views WHERE id=?", view.ID)
		} else {
			raw, marshalErr := json.Marshal(next)
			if marshalErr != nil {
				return marshalErr
			}
			view.LayoutJSON = string(raw)
			view.Revision = revision + 1
			view.UpdatedAtMs = max(view.UpdatedAtMs, time.Now().UnixMilli())
			err = writeViewTx(tx, view)
		}
		if err != nil {
			return err
		}
	}
	if changed {
		_, err = tx.Exec("UPDATE terminal_view_catalog SET revision=? WHERE singleton_id=1", revision+1)
	}
	return err
}
