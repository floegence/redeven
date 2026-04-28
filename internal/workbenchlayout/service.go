package workbenchlayout

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
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
		if snapshotsEqualWidgets(current, normalizedReq.Widgets) {
			if err := tx.Commit(); err != nil {
				return Snapshot{}, Event{}, err
			}
			return current, Event{}, nil
		}
		return Snapshot{}, Event{}, &RevisionConflictError{CurrentRevision: current.Revision}
	}

	if snapshotsEqualWidgets(current, normalizedReq.Widgets) {
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

func upsertWidgetStateTx(ctx context.Context, tx *sql.Tx, state WidgetState) (Event, error) {
	stateJSON, err := json.Marshal(state.State)
	if err != nil {
		return Event{}, err
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
