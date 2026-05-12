package workbenchlayout

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

type Store struct {
	db *sql.DB
}

type Service struct {
	store *Store

	mu          sync.Mutex
	nextSubID   int
	subscribers map[int]chan Event
}

func Open(path string) (*Service, error) {
	db, err := sqliteutil.Open(path, schemaSpec())
	if err != nil {
		return nil, err
	}
	return &Service{
		store:       &Store{db: db},
		subscribers: make(map[int]chan Event),
	}, nil
}

func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	for id, ch := range s.subscribers {
		close(ch)
		delete(s.subscribers, id)
	}
	s.mu.Unlock()
	if s.store == nil || s.store.db == nil {
		return nil
	}
	return s.store.db.Close()
}

func (s *Service) Snapshot(ctx context.Context) (Snapshot, error) {
	if s == nil || s.store == nil {
		return Snapshot{}, errors.New("workbench layout service not initialized")
	}
	return s.store.snapshot(ctx)
}

func (s *Service) Subscribe(ctx context.Context, afterSeq int64) ([]Event, <-chan Event, error) {
	if s == nil || s.store == nil {
		return nil, nil, errors.New("workbench layout service not initialized")
	}
	if afterSeq < 0 {
		afterSeq = 0
	}
	baseline, err := s.store.eventsAfter(ctx, afterSeq)
	if err != nil {
		return nil, nil, err
	}
	ch := make(chan Event, 32)
	s.mu.Lock()
	s.nextSubID++
	subID := s.nextSubID
	s.subscribers[subID] = ch
	s.mu.Unlock()

	if ctx != nil {
		go func() {
			<-ctx.Done()
			s.removeSubscriber(subID)
		}()
	}

	return baseline, ch, nil
}

func (s *Service) Replace(ctx context.Context, req PutLayoutRequest) (Snapshot, error) {
	if s == nil || s.store == nil {
		return Snapshot{}, errors.New("workbench layout service not initialized")
	}
	snapshot, event, err := s.store.replace(ctx, req)
	if err != nil {
		return Snapshot{}, err
	}
	s.broadcast(event)
	return snapshot, nil
}

func (s *Service) PutWidgetState(ctx context.Context, widgetID string, req PutWidgetStateRequest) (WidgetState, error) {
	if s == nil || s.store == nil {
		return WidgetState{}, errors.New("workbench layout service not initialized")
	}
	state, event, err := s.store.putWidgetState(ctx, widgetID, req)
	if err != nil {
		return WidgetState{}, err
	}
	s.broadcast(event)
	return state, nil
}

func (s *Service) OpenPreview(ctx context.Context, req OpenPreviewRequest) (OpenPreviewResponse, error) {
	if s == nil || s.store == nil {
		return OpenPreviewResponse{}, errors.New("workbench layout service not initialized")
	}
	resp, events, err := s.store.openPreview(ctx, req)
	if err != nil {
		return OpenPreviewResponse{}, err
	}
	s.broadcastEvents(events)
	return resp, nil
}

func (s *Service) AppendTerminalSession(ctx context.Context, widgetID string, sessionID string) (WidgetState, error) {
	if s == nil || s.store == nil {
		return WidgetState{}, errors.New("workbench layout service not initialized")
	}
	state, event, err := s.store.appendTerminalSession(ctx, widgetID, sessionID)
	if err != nil {
		return WidgetState{}, err
	}
	s.broadcast(event)
	return state, nil
}

func (s *Service) RemoveTerminalSession(ctx context.Context, widgetID string, sessionID string) (WidgetState, error) {
	if s == nil || s.store == nil {
		return WidgetState{}, errors.New("workbench layout service not initialized")
	}
	state, event, err := s.store.removeTerminalSession(ctx, widgetID, sessionID)
	if err != nil {
		return WidgetState{}, err
	}
	s.broadcast(event)
	return state, nil
}

func (s *Service) PruneTerminalSessions(ctx context.Context, liveSessionIDs []string) ([]WidgetState, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("workbench layout service not initialized")
	}
	states, events, err := s.store.pruneTerminalSessions(ctx, liveSessionIDs)
	if err != nil {
		return nil, err
	}
	s.broadcastEvents(events)
	return states, nil
}

func (s *Service) RemoveTerminalSessionFromAllWidgets(ctx context.Context, sessionID string) ([]WidgetState, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("workbench layout service not initialized")
	}
	states, events, err := s.store.removeTerminalSessionFromAllWidgets(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	s.broadcastEvents(events)
	return states, nil
}

func (s *Service) removeSubscriber(id int) {
	s.mu.Lock()
	ch, ok := s.subscribers[id]
	if ok {
		delete(s.subscribers, id)
		close(ch)
	}
	s.mu.Unlock()
}

func (s *Service) broadcastEvents(events []Event) {
	for _, event := range events {
		s.broadcast(event)
	}
}

func (s *Service) broadcast(event Event) {
	if event.Seq <= 0 {
		return
	}
	s.mu.Lock()
	for id, ch := range s.subscribers {
		select {
		case ch <- event:
		default:
			close(ch)
			delete(s.subscribers, id)
		}
	}
	s.mu.Unlock()
}

func (s *Store) snapshot(ctx context.Context) (Snapshot, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Snapshot{}, err
	}
	defer func() { _ = tx.Rollback() }()

	snapshot, err := snapshotTx(ctx, tx)
	if err != nil {
		return Snapshot{}, err
	}
	if err := tx.Commit(); err != nil {
		return Snapshot{}, err
	}
	return snapshot, nil
}

func (s *Store) replace(ctx context.Context, req PutLayoutRequest) (Snapshot, Event, error) {
	nowUnixMs := time.Now().UnixMilli()
	normalizedReq, err := normalizePutLayoutRequest(req, nowUnixMs)
	if err != nil {
		return Snapshot{}, Event{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Snapshot{}, Event{}, err
	}
	defer func() { _ = tx.Rollback() }()

	current, err := snapshotTx(ctx, tx)
	if err != nil {
		return Snapshot{}, Event{}, err
	}

	if current.Revision != normalizedReq.BaseRevision {
		if snapshotsEqualLayout(current, normalizedReq) {
			if err := tx.Commit(); err != nil {
				return Snapshot{}, Event{}, err
			}
			return current, Event{}, nil
		}
		return Snapshot{}, Event{}, &RevisionConflictError{CurrentRevision: current.Revision}
	}

	if snapshotsEqualLayout(current, normalizedReq) {
		if err := tx.Commit(); err != nil {
			return Snapshot{}, Event{}, err
		}
		return current, Event{}, nil
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM workbench_layout_widgets`); err != nil {
		return Snapshot{}, Event{}, err
	}
	for _, widget := range normalizedReq.Widgets {
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO workbench_layout_widgets(
  widget_id,
  widget_type,
  x,
  y,
  width,
  height,
  z_index,
  created_at_unix_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			widget.WidgetID,
			widget.WidgetType,
			widget.X,
			widget.Y,
			widget.Width,
			widget.Height,
			widget.ZIndex,
			widget.CreatedAtUnixMs,
		); err != nil {
			return Snapshot{}, Event{}, err
		}
	}

	if err := replaceStickyNotesTx(ctx, tx, normalizedReq.StickyNotes); err != nil {
		return Snapshot{}, Event{}, err
	}
	if err := replaceTextAnnotationsTx(ctx, tx, normalizedReq.Annotations); err != nil {
		return Snapshot{}, Event{}, err
	}
	if err := replaceBackgroundLayersTx(ctx, tx, normalizedReq.BackgroundLayers); err != nil {
		return Snapshot{}, Event{}, err
	}

	deletedWidgetIDs := removedWidgetIDs(current.Widgets, normalizedReq.Widgets)
	if err := deleteWidgetStatesTx(ctx, tx, deletedWidgetIDs); err != nil {
		return Snapshot{}, Event{}, err
	}

	seq, err := insertEventRowTx(ctx, tx, EventTypeLayoutReplaced, nowUnixMs)
	if err != nil {
		return Snapshot{}, Event{}, err
	}
	if err := updateSnapshotHeadTx(ctx, tx, current.Revision+1, seq, nowUnixMs); err != nil {
		return Snapshot{}, Event{}, err
	}

	nextSnapshot, err := snapshotTx(ctx, tx)
	if err != nil {
		return Snapshot{}, Event{}, err
	}
	payload, err := json.Marshal(nextSnapshot)
	if err != nil {
		return Snapshot{}, Event{}, err
	}
	if err := updateEventPayloadTx(ctx, tx, seq, payload); err != nil {
		return Snapshot{}, Event{}, err
	}

	if err := tx.Commit(); err != nil {
		return Snapshot{}, Event{}, err
	}

	return nextSnapshot, Event{
		Seq:             seq,
		Type:            EventTypeLayoutReplaced,
		CreatedAtUnixMs: nowUnixMs,
		Payload:         payload,
	}, nil
}

func (s *Store) putWidgetState(ctx context.Context, widgetID string, req PutWidgetStateRequest) (WidgetState, Event, error) {
	nowUnixMs := time.Now().UnixMilli()
	normalizedReq, err := normalizePutWidgetStateRequest(widgetID, req)
	if err != nil {
		return WidgetState{}, Event{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return WidgetState{}, Event{}, err
	}
	defer func() { _ = tx.Rollback() }()

	actualWidgetType, err := loadWidgetTypeByIDTx(ctx, tx, widgetID)
	if err != nil {
		return WidgetState{}, Event{}, err
	}
	if actualWidgetType != normalizedReq.WidgetType {
		return WidgetState{}, Event{}, &WidgetTypeMismatchError{
			WidgetID:     widgetID,
			ExpectedType: actualWidgetType,
			ActualType:   normalizedReq.WidgetType,
		}
	}

	current, err := loadWidgetStateByIDTx(ctx, tx, widgetID)
	if err != nil {
		return WidgetState{}, Event{}, err
	}

	currentRevision := int64(0)
	if current != nil {
		currentRevision = current.Revision
	}
	if currentRevision != normalizedReq.BaseRevision {
		if current != nil && widgetStateDataEqual(current.State, normalizedReq.State) {
			if err := tx.Commit(); err != nil {
				return WidgetState{}, Event{}, err
			}
			return *current, Event{}, nil
		}
		return WidgetState{}, Event{}, &WidgetStateRevisionConflictError{
			WidgetID:        widgetID,
			CurrentRevision: currentRevision,
		}
	}
	if current != nil && widgetStateDataEqual(current.State, normalizedReq.State) {
		if err := tx.Commit(); err != nil {
			return WidgetState{}, Event{}, err
		}
		return *current, Event{}, nil
	}

	nextState := WidgetState{
		WidgetID:        widgetID,
		WidgetType:      actualWidgetType,
		Revision:        currentRevision + 1,
		UpdatedAtUnixMs: nowUnixMs,
		State:           normalizedReq.State,
	}
	event, err := upsertWidgetStateTx(ctx, tx, nextState)
	if err != nil {
		return WidgetState{}, Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return WidgetState{}, Event{}, err
	}
	return nextState, event, nil
}

func (s *Store) openPreview(ctx context.Context, req OpenPreviewRequest) (OpenPreviewResponse, []Event, error) {
	nowUnixMs := time.Now().UnixMilli()
	normalizedReq, err := normalizeOpenPreviewRequest(req, nowUnixMs)
	if err != nil {
		return OpenPreviewResponse{}, nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OpenPreviewResponse{}, nil, err
	}
	defer func() { _ = tx.Rollback() }()

	current, err := snapshotTx(ctx, tx)
	if err != nil {
		return OpenPreviewResponse{}, nil, err
	}

	widget, created, err := resolveOpenPreviewWidget(current, normalizedReq, nowUnixMs)
	if err != nil {
		return OpenPreviewResponse{}, nil, err
	}
	if created {
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO workbench_layout_widgets(
  widget_id,
  widget_type,
  x,
  y,
  width,
  height,
  z_index,
  created_at_unix_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			widget.WidgetID,
			widget.WidgetType,
			widget.X,
			widget.Y,
			widget.Width,
			widget.Height,
			widget.ZIndex,
			widget.CreatedAtUnixMs,
		); err != nil {
			return OpenPreviewResponse{}, nil, err
		}
	}

	desiredState := WidgetStateData{
		Kind: WidgetStateKindPreview,
		Item: &normalizedReq.Item,
	}
	currentState, err := loadWidgetStateByIDTx(ctx, tx, widget.WidgetID)
	if err != nil {
		return OpenPreviewResponse{}, nil, err
	}
	currentRevision := int64(0)
	if currentState != nil {
		currentRevision = currentState.Revision
	}
	nextState := WidgetState{
		WidgetID:        widget.WidgetID,
		WidgetType:      WidgetTypePreview,
		Revision:        currentRevision + 1,
		UpdatedAtUnixMs: nowUnixMs,
		State:           desiredState,
	}

	events := make([]Event, 0, 1)
	if created {
		if err := upsertWidgetStateRowTx(ctx, tx, nextState); err != nil {
			return OpenPreviewResponse{}, nil, err
		}
		seq, err := insertEventRowTx(ctx, tx, EventTypeLayoutReplaced, nowUnixMs)
		if err != nil {
			return OpenPreviewResponse{}, nil, err
		}
		if err := updateSnapshotHeadTx(ctx, tx, current.Revision+1, seq, nowUnixMs); err != nil {
			return OpenPreviewResponse{}, nil, err
		}
		nextSnapshot, err := snapshotTx(ctx, tx)
		if err != nil {
			return OpenPreviewResponse{}, nil, err
		}
		payload, err := json.Marshal(nextSnapshot)
		if err != nil {
			return OpenPreviewResponse{}, nil, err
		}
		if err := updateEventPayloadTx(ctx, tx, seq, payload); err != nil {
			return OpenPreviewResponse{}, nil, err
		}
		if err := tx.Commit(); err != nil {
			return OpenPreviewResponse{}, nil, err
		}
		events = append(events, Event{
			Seq:             seq,
			Type:            EventTypeLayoutReplaced,
			CreatedAtUnixMs: nowUnixMs,
			Payload:         payload,
		})
		return OpenPreviewResponse{
			RequestID:   normalizedReq.RequestID,
			WidgetID:    widget.WidgetID,
			Created:     true,
			Snapshot:    nextSnapshot,
			WidgetState: nextState,
		}, events, nil
	}

	if currentState != nil && widgetStateDataEqual(currentState.State, desiredState) {
		if err := tx.Commit(); err != nil {
			return OpenPreviewResponse{}, nil, err
		}
		return OpenPreviewResponse{
			RequestID:   normalizedReq.RequestID,
			WidgetID:    widget.WidgetID,
			Created:     false,
			Snapshot:    current,
			WidgetState: *currentState,
		}, nil, nil
	}

	event, err := upsertWidgetStateTx(ctx, tx, nextState)
	if err != nil {
		return OpenPreviewResponse{}, nil, err
	}
	nextSnapshot, err := snapshotTx(ctx, tx)
	if err != nil {
		return OpenPreviewResponse{}, nil, err
	}
	if err := tx.Commit(); err != nil {
		return OpenPreviewResponse{}, nil, err
	}
	events = append(events, event)
	return OpenPreviewResponse{
		RequestID:   normalizedReq.RequestID,
		WidgetID:    widget.WidgetID,
		Created:     false,
		Snapshot:    nextSnapshot,
		WidgetState: nextState,
	}, events, nil
}

func (s *Store) appendTerminalSession(ctx context.Context, widgetID string, sessionID string) (WidgetState, Event, error) {
	nowUnixMs := time.Now().UnixMilli()
	normalizedSessionIDs := normalizeSessionIDs([]string{sessionID})
	if len(normalizedSessionIDs) != 1 {
		return WidgetState{}, Event{}, &ValidationError{Message: "session_id is required"}
	}
	sessionID = normalizedSessionIDs[0]

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return WidgetState{}, Event{}, err
	}
	defer func() { _ = tx.Rollback() }()

	actualWidgetType, err := loadWidgetTypeByIDTx(ctx, tx, widgetID)
	if err != nil {
		return WidgetState{}, Event{}, err
	}
	if actualWidgetType != WidgetTypeTerminal {
		return WidgetState{}, Event{}, &WidgetTypeMismatchError{
			WidgetID:     widgetID,
			ExpectedType: WidgetTypeTerminal,
			ActualType:   actualWidgetType,
		}
	}

	current, err := loadWidgetStateByIDTx(ctx, tx, widgetID)
	if err != nil {
		return WidgetState{}, Event{}, err
	}
	nextSessionIDs := []string{sessionID}
	nextRevision := int64(1)
	if current != nil {
		if current.State.Kind != WidgetStateKindTerminal {
			return WidgetState{}, Event{}, &WidgetTypeMismatchError{
				WidgetID:     widgetID,
				ExpectedType: WidgetTypeTerminal,
				ActualType:   current.WidgetType,
			}
		}
		nextSessionIDs = append([]string{}, current.State.SessionIDs...)
		for _, existing := range nextSessionIDs {
			if existing == sessionID {
				if err := tx.Commit(); err != nil {
					return WidgetState{}, Event{}, err
				}
				return *current, Event{}, nil
			}
		}
		nextSessionIDs = append(nextSessionIDs, sessionID)
		nextRevision = current.Revision + 1
	}
	var currentState *WidgetStateData
	if current != nil {
		currentState = &current.State
	}

	nextState := WidgetState{
		WidgetID:        widgetID,
		WidgetType:      WidgetTypeTerminal,
		Revision:        nextRevision,
		UpdatedAtUnixMs: nowUnixMs,
		State:           terminalStateData(nextSessionIDs, currentState),
	}
	event, err := upsertWidgetStateTx(ctx, tx, nextState)
	if err != nil {
		return WidgetState{}, Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return WidgetState{}, Event{}, err
	}
	return nextState, event, nil
}

func (s *Store) removeTerminalSession(ctx context.Context, widgetID string, sessionID string) (WidgetState, Event, error) {
	nowUnixMs := time.Now().UnixMilli()
	normalizedSessionIDs := normalizeSessionIDs([]string{sessionID})
	if len(normalizedSessionIDs) != 1 {
		return WidgetState{}, Event{}, &ValidationError{Message: "session_id is required"}
	}
	sessionID = normalizedSessionIDs[0]

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return WidgetState{}, Event{}, err
	}
	defer func() { _ = tx.Rollback() }()

	actualWidgetType, err := loadWidgetTypeByIDTx(ctx, tx, widgetID)
	if err != nil {
		return WidgetState{}, Event{}, err
	}
	if actualWidgetType != WidgetTypeTerminal {
		return WidgetState{}, Event{}, &WidgetTypeMismatchError{
			WidgetID:     widgetID,
			ExpectedType: WidgetTypeTerminal,
			ActualType:   actualWidgetType,
		}
	}

	current, err := loadWidgetStateByIDTx(ctx, tx, widgetID)
	if err != nil {
		return WidgetState{}, Event{}, err
	}
	if current == nil {
		nextState := WidgetState{
			WidgetID:        widgetID,
			WidgetType:      WidgetTypeTerminal,
			Revision:        1,
			UpdatedAtUnixMs: nowUnixMs,
			State:           terminalStateData(nil, nil),
		}
		event, err := upsertWidgetStateTx(ctx, tx, nextState)
		if err != nil {
			return WidgetState{}, Event{}, err
		}
		if err := tx.Commit(); err != nil {
			return WidgetState{}, Event{}, err
		}
		return nextState, event, nil
	}

	nextSessionIDs := make([]string, 0, len(current.State.SessionIDs))
	changed := false
	for _, existing := range current.State.SessionIDs {
		if existing == sessionID {
			changed = true
			continue
		}
		nextSessionIDs = append(nextSessionIDs, existing)
	}
	if !changed {
		if err := tx.Commit(); err != nil {
			return WidgetState{}, Event{}, err
		}
		return *current, Event{}, nil
	}

	nextState := WidgetState{
		WidgetID:        widgetID,
		WidgetType:      WidgetTypeTerminal,
		Revision:        current.Revision + 1,
		UpdatedAtUnixMs: nowUnixMs,
		State:           terminalStateData(nextSessionIDs, &current.State),
	}
	event, err := upsertWidgetStateTx(ctx, tx, nextState)
	if err != nil {
		return WidgetState{}, Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return WidgetState{}, Event{}, err
	}
	return nextState, event, nil
}

func (s *Store) pruneTerminalSessions(ctx context.Context, liveSessionIDs []string) ([]WidgetState, []Event, error) {
	live := sessionIDSet(liveSessionIDs)
	return s.updateTerminalStates(ctx, func(sessionID string) bool {
		_, ok := live[sessionID]
		return ok
	})
}

func (s *Store) removeTerminalSessionFromAllWidgets(ctx context.Context, sessionID string) ([]WidgetState, []Event, error) {
	normalizedSessionIDs := normalizeSessionIDs([]string{sessionID})
	if len(normalizedSessionIDs) != 1 {
		return nil, nil, &ValidationError{Message: "session_id is required"}
	}
	sessionID = normalizedSessionIDs[0]
	return s.updateTerminalStates(ctx, func(existing string) bool {
		return existing != sessionID
	})
}

func (s *Store) updateTerminalStates(ctx context.Context, keepSession func(string) bool) ([]WidgetState, []Event, error) {
	nowUnixMs := time.Now().UnixMilli()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(
		ctx,
		`SELECT widget_id, widget_type, revision, state_json, updated_at_unix_ms
FROM workbench_widget_states
WHERE widget_type = ?
ORDER BY widget_id ASC`,
		WidgetTypeTerminal,
	)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	currentStates := make([]WidgetState, 0)
	for rows.Next() {
		state, err := scanWidgetStateRow(rows)
		if err != nil {
			return nil, nil, err
		}
		if state.State.Kind != WidgetStateKindTerminal {
			continue
		}
		currentStates = append(currentStates, state)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	updatedStates := make([]WidgetState, 0)
	events := make([]Event, 0)
	for _, current := range currentStates {
		nextSessionIDs := filterSessionIDs(current.State.SessionIDs, keepSession)
		if sessionIDsEqual(current.State.SessionIDs, nextSessionIDs) {
			continue
		}
		nextState := WidgetState{
			WidgetID:        current.WidgetID,
			WidgetType:      WidgetTypeTerminal,
			Revision:        current.Revision + 1,
			UpdatedAtUnixMs: nowUnixMs,
			State:           terminalStateData(nextSessionIDs, &current.State),
		}
		event, err := upsertWidgetStateTx(ctx, tx, nextState)
		if err != nil {
			return nil, nil, err
		}
		updatedStates = append(updatedStates, nextState)
		events = append(events, event)
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	return updatedStates, events, nil
}

func resolveOpenPreviewWidget(snapshot Snapshot, req OpenPreviewRequest, nowUnixMs int64) (WidgetLayout, bool, error) {
	previewWidgets := previewWidgetsByLatest(snapshot.Widgets)
	if req.OpenStrategy == OpenPreviewStrategySameFileOrCreate {
		stateByWidgetID := make(map[string]WidgetState, len(snapshot.WidgetStates))
		for _, state := range snapshot.WidgetStates {
			stateByWidgetID[state.WidgetID] = state
		}
		for _, widget := range previewWidgets {
			state, ok := stateByWidgetID[widget.WidgetID]
			if !ok || state.WidgetType != WidgetTypePreview || state.State.Kind != WidgetStateKindPreview || state.State.Item == nil {
				continue
			}
			if state.State.Item.Path == req.Item.Path {
				return widget, false, nil
			}
		}
	}
	if req.OpenStrategy == OpenPreviewStrategyFocusLatestOrCreate && len(previewWidgets) > 0 {
		return previewWidgets[0], false, nil
	}
	widget, err := newPreviewWidget(snapshot.Widgets, req.Viewport, nowUnixMs)
	if err != nil {
		return WidgetLayout{}, false, err
	}
	return widget, true, nil
}

func previewWidgetsByLatest(widgets []WidgetLayout) []WidgetLayout {
	next := make([]WidgetLayout, 0)
	for _, widget := range widgets {
		if widget.WidgetType == WidgetTypePreview {
			next = append(next, widget)
		}
	}
	sort.Slice(next, func(left int, right int) bool {
		if next[left].ZIndex != next[right].ZIndex {
			return next[left].ZIndex > next[right].ZIndex
		}
		if next[left].CreatedAtUnixMs != next[right].CreatedAtUnixMs {
			return next[left].CreatedAtUnixMs > next[right].CreatedAtUnixMs
		}
		return next[left].WidgetID > next[right].WidgetID
	})
	return next
}

func newPreviewWidget(widgets []WidgetLayout, hint OpenPreviewViewportHint, nowUnixMs int64) (WidgetLayout, error) {
	width := normalizePositiveFloat(hint.DefaultWidth, DefaultPreviewWidgetWidth)
	height := normalizePositiveFloat(hint.DefaultHeight, DefaultPreviewWidgetHeight)
	x := 96 + float64(len(widgets))*32
	y := 72 + float64(len(widgets))*28
	if hint.CenterX != nil && hint.CenterY != nil {
		x = *hint.CenterX - width/2
		y = *hint.CenterY - height/2
	}
	maxZ := 0
	widgetIDs := make(map[string]struct{}, len(widgets))
	for _, widget := range widgets {
		if widget.ZIndex > maxZ {
			maxZ = widget.ZIndex
		}
		widgetIDs[widget.WidgetID] = struct{}{}
	}
	widgetID, err := uniquePreviewWidgetID(widgetIDs)
	if err != nil {
		return WidgetLayout{}, err
	}
	return WidgetLayout{
		WidgetID:        widgetID,
		WidgetType:      WidgetTypePreview,
		X:               x,
		Y:               y,
		Width:           width,
		Height:          height,
		ZIndex:          maxZ + 1,
		CreatedAtUnixMs: nowUnixMs,
	}, nil
}

func uniquePreviewWidgetID(existing map[string]struct{}) (string, error) {
	for range 32 {
		token, err := randomWorkbenchIDToken()
		if err != nil {
			return "", err
		}
		id := fmt.Sprintf("widget-preview-%s", token)
		if _, ok := existing[id]; !ok {
			return id, nil
		}
	}
	return "", errors.New("unable to allocate unique preview widget id")
}

func randomWorkbenchIDToken() (string, error) {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]byte, 0, 16)
	for i := 0; i < 16; i++ {
		out = append(out, alphabet[int(buf[i])%len(alphabet)])
	}
	return string(out), nil
}

func (s *Store) eventsAfter(ctx context.Context, afterSeq int64) ([]Event, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT seq, event_type, payload_json, created_at_unix_ms
FROM workbench_layout_events
WHERE seq > ?
ORDER BY seq ASC`,
		afterSeq,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]Event, 0)
	for rows.Next() {
		var event Event
		var payload string
		if err := rows.Scan(&event.Seq, &event.Type, &payload, &event.CreatedAtUnixMs); err != nil {
			return nil, err
		}
		event.Payload = json.RawMessage(payload)
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func snapshotTx(ctx context.Context, tx *sql.Tx) (Snapshot, error) {
	var snapshot Snapshot
	if err := tx.QueryRowContext(
		ctx,
		`SELECT revision, seq, updated_at_unix_ms
FROM workbench_layout_snapshot
WHERE singleton = 1`,
	).Scan(&snapshot.Revision, &snapshot.Seq, &snapshot.UpdatedAtUnixMs); err != nil {
		return Snapshot{}, err
	}

	widgetRows, err := tx.QueryContext(
		ctx,
		`SELECT widget_id, widget_type, x, y, width, height, z_index, created_at_unix_ms
FROM workbench_layout_widgets
ORDER BY z_index ASC, created_at_unix_ms ASC, widget_id ASC`,
	)
	if err != nil {
		return Snapshot{}, err
	}
	defer widgetRows.Close()

	snapshot.Widgets = make([]WidgetLayout, 0)
	for widgetRows.Next() {
		var widget WidgetLayout
		if err := widgetRows.Scan(
			&widget.WidgetID,
			&widget.WidgetType,
			&widget.X,
			&widget.Y,
			&widget.Width,
			&widget.Height,
			&widget.ZIndex,
			&widget.CreatedAtUnixMs,
		); err != nil {
			return Snapshot{}, err
		}
		snapshot.Widgets = append(snapshot.Widgets, widget)
	}
	if err := widgetRows.Err(); err != nil {
		return Snapshot{}, err
	}

	stickyNotes, err := loadStickyNotesTx(ctx, tx)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot.StickyNotes = stickyNotes

	annotations, err := loadTextAnnotationsTx(ctx, tx)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot.Annotations = annotations

	backgroundLayers, err := loadBackgroundLayersTx(ctx, tx)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot.BackgroundLayers = backgroundLayers

	stateRows, err := tx.QueryContext(
		ctx,
		`SELECT widget_id, widget_type, revision, state_json, updated_at_unix_ms
FROM workbench_widget_states
ORDER BY widget_id ASC`,
	)
	if err != nil {
		return Snapshot{}, err
	}
	defer stateRows.Close()

	snapshot.WidgetStates = make([]WidgetState, 0)
	for stateRows.Next() {
		state, err := scanWidgetStateRow(stateRows)
		if err != nil {
			return Snapshot{}, err
		}
		snapshot.WidgetStates = append(snapshot.WidgetStates, state)
	}
	if err := stateRows.Err(); err != nil {
		return Snapshot{}, err
	}

	return snapshot, nil
}

func loadWidgetTypeByIDTx(ctx context.Context, tx *sql.Tx, widgetID string) (string, error) {
	var widgetType string
	err := tx.QueryRowContext(
		ctx,
		`SELECT widget_type FROM workbench_layout_widgets WHERE widget_id = ?`,
		strings.TrimSpace(widgetID),
	).Scan(&widgetType)
	if errors.Is(err, sql.ErrNoRows) {
		return "", &WidgetNotFoundError{WidgetID: widgetID}
	}
	if err != nil {
		return "", err
	}
	return widgetType, nil
}

func loadWidgetStateByIDTx(ctx context.Context, tx *sql.Tx, widgetID string) (*WidgetState, error) {
	row := tx.QueryRowContext(
		ctx,
		`SELECT widget_id, widget_type, revision, state_json, updated_at_unix_ms
FROM workbench_widget_states
WHERE widget_id = ?`,
		strings.TrimSpace(widgetID),
	)
	var (
		stateJSON string
		state     WidgetState
	)
	if err := row.Scan(&state.WidgetID, &state.WidgetType, &state.Revision, &stateJSON, &state.UpdatedAtUnixMs); errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	data := WidgetStateData{}
	if err := json.Unmarshal([]byte(stateJSON), &data); err != nil {
		return nil, err
	}
	normalizedData, err := normalizeWidgetStateData(state.WidgetType, data)
	if err != nil {
		return nil, err
	}
	state.State = normalizedData
	return &state, nil
}

func scanWidgetStateRow(scanner interface {
	Scan(dest ...any) error
}) (WidgetState, error) {
	var (
		stateJSON string
		state     WidgetState
	)
	if err := scanner.Scan(&state.WidgetID, &state.WidgetType, &state.Revision, &stateJSON, &state.UpdatedAtUnixMs); err != nil {
		return WidgetState{}, err
	}
	data := WidgetStateData{}
	if err := json.Unmarshal([]byte(stateJSON), &data); err != nil {
		return WidgetState{}, err
	}
	normalizedData, err := normalizeWidgetStateData(state.WidgetType, data)
	if err != nil {
		return WidgetState{}, err
	}
	state.State = normalizedData
	return state, nil
}

func loadStickyNotesTx(ctx context.Context, tx *sql.Tx) ([]StickyNote, error) {
	rows, err := tx.QueryContext(
		ctx,
		`SELECT id, kind, body, color, x, y, width, height, z_index, created_at_unix_ms, updated_at_unix_ms
FROM workbench_layout_sticky_notes
ORDER BY z_index ASC, created_at_unix_ms ASC, id ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notes := make([]StickyNote, 0)
	for rows.Next() {
		var note StickyNote
		if err := rows.Scan(
			&note.ID,
			&note.Kind,
			&note.Body,
			&note.Color,
			&note.X,
			&note.Y,
			&note.Width,
			&note.Height,
			&note.ZIndex,
			&note.CreatedAtUnixMs,
			&note.UpdatedAtUnixMs,
		); err != nil {
			return nil, err
		}
		normalized, err := normalizeStickyNote(note, note.UpdatedAtUnixMs)
		if err != nil {
			return nil, err
		}
		notes = append(notes, normalized)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return notes, nil
}

func loadTextAnnotationsTx(ctx context.Context, tx *sql.Tx) ([]TextAnnotation, error) {
	rows, err := tx.QueryContext(
		ctx,
		`SELECT id, kind, text, font_family, font_size, font_weight, color, align, x, y, width, height, z_index, created_at_unix_ms, updated_at_unix_ms
FROM workbench_layout_annotations
ORDER BY z_index ASC, created_at_unix_ms ASC, id ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	annotations := make([]TextAnnotation, 0)
	for rows.Next() {
		var annotation TextAnnotation
		if err := rows.Scan(
			&annotation.ID,
			&annotation.Kind,
			&annotation.Text,
			&annotation.FontFamily,
			&annotation.FontSize,
			&annotation.FontWeight,
			&annotation.Color,
			&annotation.Align,
			&annotation.X,
			&annotation.Y,
			&annotation.Width,
			&annotation.Height,
			&annotation.ZIndex,
			&annotation.CreatedAtUnixMs,
			&annotation.UpdatedAtUnixMs,
		); err != nil {
			return nil, err
		}
		normalized, err := normalizeTextAnnotation(annotation, annotation.UpdatedAtUnixMs)
		if err != nil {
			return nil, err
		}
		annotations = append(annotations, normalized)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return annotations, nil
}

func loadBackgroundLayersTx(ctx context.Context, tx *sql.Tx) ([]BackgroundLayer, error) {
	rows, err := tx.QueryContext(
		ctx,
		`SELECT id, name, fill, opacity, material, x, y, width, height, z_index, created_at_unix_ms, updated_at_unix_ms
FROM workbench_layout_background_layers
ORDER BY z_index ASC, created_at_unix_ms ASC, id ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	layers := make([]BackgroundLayer, 0)
	for rows.Next() {
		var layer BackgroundLayer
		if err := rows.Scan(
			&layer.ID,
			&layer.Name,
			&layer.Fill,
			&layer.Opacity,
			&layer.Material,
			&layer.X,
			&layer.Y,
			&layer.Width,
			&layer.Height,
			&layer.ZIndex,
			&layer.CreatedAtUnixMs,
			&layer.UpdatedAtUnixMs,
		); err != nil {
			return nil, err
		}
		normalized, err := normalizeBackgroundLayer(layer, layer.UpdatedAtUnixMs)
		if err != nil {
			return nil, err
		}
		layers = append(layers, normalized)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return layers, nil
}

func upsertWidgetStateTx(ctx context.Context, tx *sql.Tx, state WidgetState) (Event, error) {
	if err := upsertWidgetStateRowTx(ctx, tx, state); err != nil {
		return Event{}, err
	}

	seq, err := insertEventRowTx(ctx, tx, EventTypeWidgetStateUpserted, state.UpdatedAtUnixMs)
	if err != nil {
		return Event{}, err
	}
	if err := updateSnapshotTimestampTx(ctx, tx, seq, state.UpdatedAtUnixMs); err != nil {
		return Event{}, err
	}
	payload, err := json.Marshal(state)
	if err != nil {
		return Event{}, err
	}
	if err := updateEventPayloadTx(ctx, tx, seq, payload); err != nil {
		return Event{}, err
	}
	return Event{
		Seq:             seq,
		Type:            EventTypeWidgetStateUpserted,
		CreatedAtUnixMs: state.UpdatedAtUnixMs,
		Payload:         payload,
	}, nil
}

func upsertWidgetStateRowTx(ctx context.Context, tx *sql.Tx, state WidgetState) error {
	stateJSON, err := json.Marshal(state.State)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO workbench_widget_states(widget_id, widget_type, revision, state_json, updated_at_unix_ms)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(widget_id) DO UPDATE SET
  widget_type = excluded.widget_type,
  revision = excluded.revision,
  state_json = excluded.state_json,
  updated_at_unix_ms = excluded.updated_at_unix_ms`,
		state.WidgetID,
		state.WidgetType,
		state.Revision,
		string(stateJSON),
		state.UpdatedAtUnixMs,
	); err != nil {
		return err
	}
	return nil
}

func insertEventRowTx(ctx context.Context, tx *sql.Tx, eventType string, nowUnixMs int64) (int64, error) {
	result, err := tx.ExecContext(
		ctx,
		`INSERT INTO workbench_layout_events(event_type, payload_json, created_at_unix_ms) VALUES (?, ?, ?)`,
		eventType,
		"",
		nowUnixMs,
	)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func updateEventPayloadTx(ctx context.Context, tx *sql.Tx, seq int64, payload []byte) error {
	_, err := tx.ExecContext(
		ctx,
		`UPDATE workbench_layout_events SET payload_json = ? WHERE seq = ?`,
		string(payload),
		seq,
	)
	return err
}

func updateSnapshotHeadTx(ctx context.Context, tx *sql.Tx, revision int64, seq int64, updatedAtUnixMs int64) error {
	_, err := tx.ExecContext(
		ctx,
		`UPDATE workbench_layout_snapshot
SET revision = ?, seq = ?, updated_at_unix_ms = ?
WHERE singleton = 1`,
		revision,
		seq,
		updatedAtUnixMs,
	)
	return err
}

func updateSnapshotTimestampTx(ctx context.Context, tx *sql.Tx, seq int64, updatedAtUnixMs int64) error {
	var currentRevision int64
	if err := tx.QueryRowContext(
		ctx,
		`SELECT revision FROM workbench_layout_snapshot WHERE singleton = 1`,
	).Scan(&currentRevision); err != nil {
		return err
	}
	return updateSnapshotHeadTx(ctx, tx, currentRevision, seq, updatedAtUnixMs)
}

func replaceStickyNotesTx(ctx context.Context, tx *sql.Tx, notes []StickyNote) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM workbench_layout_sticky_notes`); err != nil {
		return err
	}
	for _, note := range notes {
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO workbench_layout_sticky_notes(
  id,
  kind,
  body,
  color,
  x,
  y,
  width,
  height,
  z_index,
  created_at_unix_ms,
  updated_at_unix_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			note.ID,
			note.Kind,
			note.Body,
			note.Color,
			note.X,
			note.Y,
			note.Width,
			note.Height,
			note.ZIndex,
			note.CreatedAtUnixMs,
			note.UpdatedAtUnixMs,
		); err != nil {
			return err
		}
	}
	return nil
}

func replaceTextAnnotationsTx(ctx context.Context, tx *sql.Tx, annotations []TextAnnotation) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM workbench_layout_annotations`); err != nil {
		return err
	}
	for _, annotation := range annotations {
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO workbench_layout_annotations(
  id,
  kind,
  text,
  font_family,
  font_size,
  font_weight,
  color,
  align,
  x,
  y,
  width,
  height,
  z_index,
  created_at_unix_ms,
  updated_at_unix_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			annotation.ID,
			annotation.Kind,
			annotation.Text,
			annotation.FontFamily,
			annotation.FontSize,
			annotation.FontWeight,
			annotation.Color,
			annotation.Align,
			annotation.X,
			annotation.Y,
			annotation.Width,
			annotation.Height,
			annotation.ZIndex,
			annotation.CreatedAtUnixMs,
			annotation.UpdatedAtUnixMs,
		); err != nil {
			return err
		}
	}
	return nil
}

func replaceBackgroundLayersTx(ctx context.Context, tx *sql.Tx, layers []BackgroundLayer) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM workbench_layout_background_layers`); err != nil {
		return err
	}
	for _, layer := range layers {
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO workbench_layout_background_layers(
  id,
  name,
  fill,
  opacity,
  material,
  x,
  y,
  width,
  height,
  z_index,
  created_at_unix_ms,
  updated_at_unix_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			layer.ID,
			layer.Name,
			layer.Fill,
			layer.Opacity,
			layer.Material,
			layer.X,
			layer.Y,
			layer.Width,
			layer.Height,
			layer.ZIndex,
			layer.CreatedAtUnixMs,
			layer.UpdatedAtUnixMs,
		); err != nil {
			return err
		}
	}
	return nil
}

func sessionIDSet(values []string) map[string]struct{} {
	normalized := normalizeSessionIDs(values)
	out := make(map[string]struct{}, len(normalized))
	for _, id := range normalized {
		out[id] = struct{}{}
	}
	return out
}

func filterSessionIDs(values []string, keep func(string) bool) []string {
	normalized := normalizeSessionIDs(values)
	if len(normalized) == 0 {
		return []string{}
	}
	next := make([]string, 0, len(normalized))
	for _, sessionID := range normalized {
		if keep == nil || keep(sessionID) {
			next = append(next, sessionID)
		}
	}
	return next
}

func sessionIDsEqual(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func deleteWidgetStatesTx(ctx context.Context, tx *sql.Tx, widgetIDs []string) error {
	if len(widgetIDs) == 0 {
		return nil
	}
	placeholders := make([]string, 0, len(widgetIDs))
	args := make([]any, 0, len(widgetIDs))
	for _, widgetID := range widgetIDs {
		placeholders = append(placeholders, "?")
		args = append(args, widgetID)
	}
	_, err := tx.ExecContext(
		ctx,
		fmt.Sprintf("DELETE FROM workbench_widget_states WHERE widget_id IN (%s)", strings.Join(placeholders, ",")),
		args...,
	)
	return err
}

func removedWidgetIDs(previous []WidgetLayout, next []WidgetLayout) []string {
	if len(previous) == 0 {
		return nil
	}
	nextIDs := make(map[string]struct{}, len(next))
	for _, widget := range next {
		nextIDs[widget.WidgetID] = struct{}{}
	}
	removed := make([]string, 0)
	for _, widget := range previous {
		if _, ok := nextIDs[widget.WidgetID]; ok {
			continue
		}
		removed = append(removed, widget.WidgetID)
	}
	return removed
}
