package workbenchlayout

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
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
	if event.Seq > 0 {
		s.broadcast(event)
	}
	return snapshot, nil
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

	result, err := tx.ExecContext(
		ctx,
		`INSERT INTO workbench_layout_events(event_type, payload_json, created_at_unix_ms) VALUES (?, ?, ?)`,
		EventTypeLayoutReplaced,
		"",
		nowUnixMs,
	)
	if err != nil {
		return Snapshot{}, Event{}, err
	}
	seq, err := result.LastInsertId()
	if err != nil {
		return Snapshot{}, Event{}, err
	}

	nextSnapshot := Snapshot{
		Seq:             seq,
		Revision:        current.Revision + 1,
		UpdatedAtUnixMs: nowUnixMs,
		Widgets:         normalizedReq.Widgets,
	}
	payload, err := json.Marshal(nextSnapshot)
	if err != nil {
		return Snapshot{}, Event{}, err
	}

	if _, err := tx.ExecContext(
		ctx,
		`UPDATE workbench_layout_events SET payload_json = ? WHERE seq = ?`,
		string(payload),
		seq,
	); err != nil {
		return Snapshot{}, Event{}, err
	}
	if _, err := tx.ExecContext(
		ctx,
		`UPDATE workbench_layout_snapshot
SET revision = ?, seq = ?, updated_at_unix_ms = ?
WHERE singleton = 1`,
		nextSnapshot.Revision,
		nextSnapshot.Seq,
		nextSnapshot.UpdatedAtUnixMs,
	); err != nil {
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

	rows, err := tx.QueryContext(
		ctx,
		`SELECT widget_id, widget_type, x, y, width, height, z_index, created_at_unix_ms
FROM workbench_layout_widgets
ORDER BY z_index ASC, created_at_unix_ms ASC, widget_id ASC`,
	)
	if err != nil {
		return Snapshot{}, err
	}
	defer rows.Close()

	snapshot.Widgets = make([]WidgetLayout, 0)
	for rows.Next() {
		var widget WidgetLayout
		if err := rows.Scan(
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
	if err := rows.Err(); err != nil {
		return Snapshot{}, err
	}

	return snapshot, nil
}
