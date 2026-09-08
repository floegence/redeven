package workbenchlayout

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// OpenPluginRequest persists product placement only. ReDevPlugin independently
// authorizes every live surface opened from this target.
type OpenPluginRequest struct {
	State    WidgetStateData         `json:"state"`
	Viewport OpenPreviewViewportHint `json:"viewport,omitempty"`
}

type OpenPluginResponse struct {
	WidgetID    string      `json:"widget_id"`
	Created     bool        `json:"created"`
	Snapshot    Snapshot    `json:"snapshot"`
	WidgetState WidgetState `json:"widget_state"`
}

func (s *Service) OpenPlugin(ctx context.Context, req OpenPluginRequest) (OpenPluginResponse, error) {
	if s == nil || s.store == nil {
		return OpenPluginResponse{}, errors.New("workbench layout service not initialized")
	}
	result, event, err := s.store.openPlugin(ctx, req)
	if err == nil {
		s.broadcast(event)
	}
	return result, err
}

func (s *Service) RemovePluginWidgets(ctx context.Context, pluginInstanceID string) (Snapshot, error) {
	if s == nil || s.store == nil {
		return Snapshot{}, errors.New("workbench layout service not initialized")
	}
	pluginInstanceID = strings.TrimSpace(pluginInstanceID)
	if pluginInstanceID == "" {
		return Snapshot{}, &ValidationError{Message: "plugin_instance_id is required"}
	}
	snapshot, event, err := s.store.removePluginWidgets(ctx, pluginInstanceID)
	if err == nil {
		s.broadcast(event)
	}
	return snapshot, err
}

func (s *Store) openPlugin(ctx context.Context, req OpenPluginRequest) (OpenPluginResponse, Event, error) {
	state, err := normalizeWidgetStateData(WidgetTypePlugin, req.State)
	if err != nil {
		return OpenPluginResponse{}, Event{}, err
	}
	now := time.Now().UnixMilli()
	if req.Viewport.DefaultWidth == 0 {
		req.Viewport.DefaultWidth = 1120
	}
	if req.Viewport.DefaultHeight == 0 {
		req.Viewport.DefaultHeight = 760
	}
	hint, err := normalizeOpenPreviewViewportHint(req.Viewport, now)
	if err != nil {
		return OpenPluginResponse{}, Event{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OpenPluginResponse{}, Event{}, err
	}
	defer func() { _ = tx.Rollback() }()
	current, err := snapshotTx(ctx, tx)
	if err != nil {
		return OpenPluginResponse{}, Event{}, err
	}
	for _, existing := range current.WidgetStates {
		if existing.WidgetType != WidgetTypePlugin || existing.State.PluginInstanceID != state.PluginInstanceID || existing.State.SurfaceID != state.SurfaceID {
			continue
		}
		if existing.State.PluginID != state.PluginID {
			return OpenPluginResponse{}, Event{}, &ValidationError{Message: "plugin target identity does not match the placed component"}
		}
		// A delayed launch must never roll a newer saved revision backwards.
		if existing.State.ExpectedManagementRevision > state.ExpectedManagementRevision || widgetStateDataEqual(existing.State, state) {
			if err := tx.Commit(); err != nil {
				return OpenPluginResponse{}, Event{}, err
			}
			return OpenPluginResponse{WidgetID: existing.WidgetID, Snapshot: current, WidgetState: existing}, Event{}, nil
		}
		existing.State, existing.Revision, existing.UpdatedAtUnixMs = state, existing.Revision+1, now
		event, err := upsertWidgetStateTx(ctx, tx, existing)
		if err != nil {
			return OpenPluginResponse{}, Event{}, err
		}
		snapshot, err := snapshotTx(ctx, tx)
		if err != nil {
			return OpenPluginResponse{}, Event{}, err
		}
		if err := tx.Commit(); err != nil {
			return OpenPluginResponse{}, Event{}, err
		}
		return OpenPluginResponse{WidgetID: existing.WidgetID, Snapshot: snapshot, WidgetState: existing}, event, nil
	}
	widget, err := newWorkbenchWidget(current.Widgets, hint, now, WidgetTypePlugin)
	if err != nil {
		return OpenPluginResponse{}, Event{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO workbench_layout_widgets(widget_id, widget_type, x, y, width, height, z_index, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, widget.WidgetID, widget.WidgetType, widget.X, widget.Y, widget.Width, widget.Height, widget.ZIndex, widget.CreatedAtUnixMs)
	if err != nil {
		return OpenPluginResponse{}, Event{}, err
	}
	widgetState := WidgetState{WidgetID: widget.WidgetID, WidgetType: WidgetTypePlugin, Revision: 1, UpdatedAtUnixMs: now, State: state}
	if err := upsertWidgetStateRowTx(ctx, tx, widgetState); err != nil {
		return OpenPluginResponse{}, Event{}, err
	}
	snapshot, event, err := commitPluginLayoutTx(ctx, tx, current.Revision, now)
	if err != nil {
		return OpenPluginResponse{}, Event{}, err
	}
	return OpenPluginResponse{WidgetID: widget.WidgetID, Created: true, Snapshot: snapshot, WidgetState: widgetState}, event, nil
}

func (s *Store) removePluginWidgets(ctx context.Context, pluginInstanceID string) (Snapshot, Event, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Snapshot{}, Event{}, err
	}
	defer func() { _ = tx.Rollback() }()
	current, err := snapshotTx(ctx, tx)
	if err != nil {
		return Snapshot{}, Event{}, err
	}
	var ids []string
	for _, state := range current.WidgetStates {
		if state.WidgetType == WidgetTypePlugin && state.State.PluginInstanceID == pluginInstanceID {
			ids = append(ids, state.WidgetID)
		}
	}
	if len(ids) == 0 {
		if err := tx.Commit(); err != nil {
			return Snapshot{}, Event{}, err
		}
		return current, Event{}, nil
	}
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `DELETE FROM workbench_layout_widgets WHERE widget_id = ?`, id); err != nil {
			return Snapshot{}, Event{}, err
		}
	}
	if err := deleteWidgetStatesTx(ctx, tx, ids); err != nil {
		return Snapshot{}, Event{}, err
	}
	return commitPluginLayoutTx(ctx, tx, current.Revision, time.Now().UnixMilli())
}

func commitPluginLayoutTx(ctx context.Context, tx *sql.Tx, revision, now int64) (Snapshot, Event, error) {
	seq, err := insertEventRowTx(ctx, tx, EventTypeLayoutReplaced, now)
	if err != nil {
		return Snapshot{}, Event{}, err
	}
	if err := updateSnapshotHeadTx(ctx, tx, revision+1, seq, now); err != nil {
		return Snapshot{}, Event{}, err
	}
	snapshot, err := snapshotTx(ctx, tx)
	if err != nil {
		return Snapshot{}, Event{}, err
	}
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return Snapshot{}, Event{}, err
	}
	if err := updateEventPayloadTx(ctx, tx, seq, payload); err != nil {
		return Snapshot{}, Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return Snapshot{}, Event{}, err
	}
	return snapshot, Event{Seq: seq, Type: EventTypeLayoutReplaced, CreatedAtUnixMs: now, Payload: payload}, nil
}
