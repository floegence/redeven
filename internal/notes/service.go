package notes

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	maxTopicNameRunes = 48
	maxNoteBodyRunes  = 20_000
	welcomeTopicName  = "Welcome"
	welcomeNoteBody   = "Welcome to Notes.\n\nRight-click anywhere to create or paste a note.\nClick a note to copy it, drag the canvas to navigate, and use Trash to restore deleted notes for 72 hours.\n\nPress Cmd/Ctrl + . any time to reopen Notes."
	welcomeNoteColor  = "sage"
	welcomeNoteX      = 180
	welcomeNoteY      = 120
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
	svc := &Service{
		store:       &Store{db: db},
		subscribers: make(map[int]chan Event),
	}
	if err := svc.store.ensureWelcomeSeed(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return svc, nil
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
		return Snapshot{}, errors.New("notes service not initialized")
	}
	return s.store.snapshot(ctx, time.Now().UnixMilli())
}

func (s *Service) Subscribe(ctx context.Context, afterSeq int64) ([]Event, <-chan Event, error) {
	if s == nil || s.store == nil {
		return nil, nil, errors.New("notes service not initialized")
	}
	if afterSeq < 0 {
		afterSeq = 0
	}
	baseline, err := s.store.eventsAfter(ctx, afterSeq)
	if err != nil {
		return nil, nil, err
	}
	ch := make(chan Event, 64)
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

func (s *Service) CreateTopic(ctx context.Context, req CreateTopicRequest) (Topic, error) {
	if s == nil || s.store == nil {
		return Topic{}, errors.New("notes service not initialized")
	}
	topic, event, err := s.store.createTopic(ctx, req)
	if err != nil {
		return Topic{}, err
	}
	s.broadcast(event)
	return topic, nil
}

func (s *Service) UpdateTopic(ctx context.Context, req UpdateTopicRequest) (Topic, error) {
	if s == nil || s.store == nil {
		return Topic{}, errors.New("notes service not initialized")
	}
	topic, event, err := s.store.updateTopic(ctx, req)
	if err != nil {
		return Topic{}, err
	}
	s.broadcast(event)
	return topic, nil
}

func (s *Service) DeleteTopic(ctx context.Context, topicID string) error {
	if s == nil || s.store == nil {
		return errors.New("notes service not initialized")
	}
	events, err := s.store.deleteTopic(ctx, topicID)
	if err != nil {
		return err
	}
	for _, event := range events {
		s.broadcast(event)
	}
	return nil
}

func (s *Service) CreateItem(ctx context.Context, req CreateItemRequest) (Item, error) {
	if s == nil || s.store == nil {
		return Item{}, errors.New("notes service not initialized")
	}
	item, event, err := s.store.createItem(ctx, req)
	if err != nil {
		return Item{}, err
	}
	s.broadcast(event)
	return item, nil
}

func (s *Service) UpdateItem(ctx context.Context, req UpdateItemRequest) (Item, error) {
	if s == nil || s.store == nil {
		return Item{}, errors.New("notes service not initialized")
	}
	item, event, err := s.store.updateItem(ctx, req)
	if err != nil {
		return Item{}, err
	}
	s.broadcast(event)
	return item, nil
}

func (s *Service) BringItemToFront(ctx context.Context, noteID string) (Item, error) {
	if s == nil || s.store == nil {
		return Item{}, errors.New("notes service not initialized")
	}
	item, event, err := s.store.bringItemToFront(ctx, noteID)
	if err != nil {
		return Item{}, err
	}
	s.broadcast(event)
	return item, nil
}

func (s *Service) DeleteItem(ctx context.Context, noteID string) error {
	if s == nil || s.store == nil {
		return errors.New("notes service not initialized")
	}
	event, err := s.store.deleteItem(ctx, noteID)
	if err != nil {
		return err
	}
	s.broadcast(event)
	return nil
}

func (s *Service) RestoreItem(ctx context.Context, noteID string) (Item, error) {
	if s == nil || s.store == nil {
		return Item{}, errors.New("notes service not initialized")
	}
	item, events, err := s.store.restoreItem(ctx, noteID)
	if err != nil {
		return Item{}, err
	}
	for _, event := range events {
		s.broadcast(event)
	}
	return item, nil
}

func (s *Service) ClearTrashTopic(ctx context.Context, topicID string) error {
	if s == nil || s.store == nil {
		return errors.New("notes service not initialized")
	}
	event, err := s.store.clearTrashTopic(ctx, topicID)
	if err != nil {
		return err
	}
	if event.Seq > 0 {
		s.broadcast(event)
	}
	return nil
}

func (s *Service) DeleteTrashedItemPermanently(ctx context.Context, noteID string) error {
	if s == nil || s.store == nil {
		return errors.New("notes service not initialized")
	}
	event, err := s.store.deleteTrashedItemPermanently(ctx, noteID)
	if err != nil {
		return err
	}
	if event.Seq > 0 {
		s.broadcast(event)
	}
	return nil
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

func (s *Store) snapshot(ctx context.Context, nowUnixMs int64) (Snapshot, error) {
	ctx = normalizeContext(ctx)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Snapshot{}, err
	}
	defer func() { _ = tx.Rollback() }()

	if err := purgeExpiredTrashTx(tx, nowUnixMs); err != nil {
		return Snapshot{}, err
	}
	if err := cleanupDeletedTopicsWithoutItemsTx(tx); err != nil {
		return Snapshot{}, err
	}

	seq, err := currentSeqTx(tx)
	if err != nil {
		return Snapshot{}, err
	}
	topics, err := listTopicsTx(ctx, tx)
	if err != nil {
		return Snapshot{}, err
	}
	items, err := listActiveItemsTx(ctx, tx)
	if err != nil {
		return Snapshot{}, err
	}
	trashItems, err := listTrashItemsTx(ctx, tx)
	if err != nil {
		return Snapshot{}, err
	}
	if err := tx.Commit(); err != nil {
		return Snapshot{}, err
	}

	return Snapshot{
		Seq:            seq,
		RetentionHours: RetentionHours,
		Topics:         topics,
		Items:          items,
		TrashItems:     trashItems,
	}, nil
}

func (s *Store) ensureWelcomeSeed(ctx context.Context) error {
	ctx = normalizeContext(ctx)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	nowUnixMs := time.Now().UnixMilli()
	if err := purgeExpiredTrashTx(tx, nowUnixMs); err != nil {
		return err
	}
	if err := cleanupDeletedTopicsWithoutItemsTx(tx); err != nil {
		return err
	}

	seq, err := currentSeqTx(tx)
	if err != nil {
		return err
	}
	if seq > 0 {
		return tx.Commit()
	}

	hasRows, err := notesStateExistsTx(ctx, tx)
	if err != nil {
		return err
	}
	if hasRows {
		return tx.Commit()
	}

	if err := insertWelcomeSeedTx(ctx, tx, nowUnixMs); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) eventsAfter(ctx context.Context, afterSeq int64) ([]Event, error) {
	ctx = normalizeContext(ctx)
	rows, err := s.db.QueryContext(ctx, `
SELECT seq, event_type, entity_kind, entity_id, topic_id, payload_json, created_at_unix_ms
FROM notes_events
WHERE seq > ?
ORDER BY seq ASC
`, afterSeq)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Event, 0)
	for rows.Next() {
		var ev Event
		var payload string
		if err := rows.Scan(
			&ev.Seq,
			&ev.Type,
			&ev.EntityKind,
			&ev.EntityID,
			&ev.TopicID,
			&payload,
			&ev.CreatedAtUnixMs,
		); err != nil {
			return nil, err
		}
		ev.Payload = json.RawMessage(payload)
		out = append(out, ev)
	}
	return out, rows.Err()
}

func (s *Store) createTopic(ctx context.Context, req CreateTopicRequest) (Topic, Event, error) {
	ctx = normalizeContext(ctx)
	name, err := normalizeTopicName(req.Name)
	if err != nil {
		return Topic{}, Event{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Topic{}, Event{}, err
	}
	defer func() { _ = tx.Rollback() }()

	nowUnixMs := time.Now().UnixMilli()
	if err := purgeExpiredTrashTx(tx, nowUnixMs); err != nil {
		return Topic{}, Event{}, err
	}
	if err := cleanupDeletedTopicsWithoutItemsTx(tx); err != nil {
		return Topic{}, Event{}, err
	}

	sortOrder, err := nextTopicSortOrderTx(tx)
	if err != nil {
		return Topic{}, Event{}, err
	}
	iconKey, iconAccent, err := assignedTopicDecorationTx(tx)
	if err != nil {
		return Topic{}, Event{}, err
	}

	topic := Topic{
		TopicID:         randomScopedID("topic"),
		Name:            name,
		IconKey:         iconKey,
		IconAccent:      iconAccent,
		SortOrder:       sortOrder,
		CreatedAtUnixMs: nowUnixMs,
		UpdatedAtUnixMs: nowUnixMs,
		DeletedAtUnixMs: 0,
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO notes_topics(
  topic_id, name, icon_key, icon_accent, sort_order,
  created_at_unix_ms, updated_at_unix_ms, deleted_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, 0)
`, topic.TopicID, topic.Name, topic.IconKey, topic.IconAccent, topic.SortOrder, topic.CreatedAtUnixMs, topic.UpdatedAtUnixMs); err != nil {
		return Topic{}, Event{}, err
	}

	event, err := appendEventTx(tx, eventEnvelope{
		Type:            "topic.created",
		EntityKind:      "topic",
		EntityID:        topic.TopicID,
		TopicID:         topic.TopicID,
		CreatedAtUnixMs: nowUnixMs,
		Payload: struct {
			Topic Topic `json:"topic"`
		}{Topic: topic},
	})
	if err != nil {
		return Topic{}, Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return Topic{}, Event{}, err
	}
	return topic, event, nil
}

func (s *Store) updateTopic(ctx context.Context, req UpdateTopicRequest) (Topic, Event, error) {
	ctx = normalizeContext(ctx)
	topicID := strings.TrimSpace(req.TopicID)
	if topicID == "" {
		return Topic{}, Event{}, ErrInvalidTopicID
	}
	if req.Name == nil {
		return Topic{}, Event{}, fmt.Errorf("%w: missing fields", ErrInvalidTopicName)
	}
	name, err := normalizeTopicName(*req.Name)
	if err != nil {
		return Topic{}, Event{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Topic{}, Event{}, err
	}
	defer func() { _ = tx.Rollback() }()

	topic, err := loadActiveTopicTx(ctx, tx, topicID)
	if err != nil {
		return Topic{}, Event{}, err
	}
	if topic == nil {
		return Topic{}, Event{}, ErrTopicNotFound
	}
	nowUnixMs := time.Now().UnixMilli()
	topic.Name = name
	topic.UpdatedAtUnixMs = nowUnixMs
	if _, err := tx.ExecContext(ctx, `
UPDATE notes_topics
SET name = ?, updated_at_unix_ms = ?
WHERE topic_id = ? AND deleted_at_unix_ms = 0
`, topic.Name, topic.UpdatedAtUnixMs, topic.TopicID); err != nil {
		return Topic{}, Event{}, err
	}

	event, err := appendEventTx(tx, eventEnvelope{
		Type:            "topic.updated",
		EntityKind:      "topic",
		EntityID:        topic.TopicID,
		TopicID:         topic.TopicID,
		CreatedAtUnixMs: nowUnixMs,
		Payload: struct {
			Topic Topic `json:"topic"`
		}{Topic: *topic},
	})
	if err != nil {
		return Topic{}, Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return Topic{}, Event{}, err
	}
	return *topic, event, nil
}

func (s *Store) deleteTopic(ctx context.Context, topicID string) ([]Event, error) {
	ctx = normalizeContext(ctx)
	topicID = strings.TrimSpace(topicID)
	if topicID == "" {
		return nil, ErrInvalidTopicID
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	topic, err := loadActiveTopicTx(ctx, tx, topicID)
	if err != nil {
		return nil, err
	}
	if topic == nil {
		return nil, ErrTopicNotFound
	}
	activeItems, err := listTopicActiveItemsTx(ctx, tx, topic.TopicID)
	if err != nil {
		return nil, err
	}
	trashedCount, err := countTopicTrashItemsTx(ctx, tx, topic.TopicID)
	if err != nil {
		return nil, err
	}
	nowUnixMs := time.Now().UnixMilli()
	if len(activeItems) == 0 && trashedCount == 0 {
		if _, err := tx.ExecContext(ctx, `DELETE FROM notes_topics WHERE topic_id = ?`, topic.TopicID); err != nil {
			return nil, err
		}
		event, err := appendEventTx(tx, eventEnvelope{
			Type:            "topic.removed",
			EntityKind:      "topic",
			EntityID:        topic.TopicID,
			TopicID:         topic.TopicID,
			CreatedAtUnixMs: nowUnixMs,
			Payload: struct {
				TopicID string `json:"topic_id"`
			}{TopicID: topic.TopicID},
		})
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return []Event{event}, nil
	}

	trashedItems := make([]TrashItem, 0, len(activeItems))
	for _, item := range activeItems {
		snapshotBytes, err := json.Marshal(deletedSnapshot{
			TopicID:         topic.TopicID,
			TopicName:       topic.Name,
			TopicIconKey:    topic.IconKey,
			TopicIconAccent: topic.IconAccent,
			TopicSortOrder:  topic.SortOrder,
			X:               item.X,
			Y:               item.Y,
			ZIndex:          item.ZIndex,
			StyleVersion:    item.StyleVersion,
			ColorToken:      item.ColorToken,
			SizeBucket:      item.SizeBucket,
		})
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
UPDATE notes_items
SET deleted_at_unix_ms = ?, updated_at_unix_ms = ?, deleted_snapshot_json = ?
WHERE note_id = ? AND deleted_at_unix_ms = 0
`, nowUnixMs, nowUnixMs, string(snapshotBytes), item.NoteID); err != nil {
			return nil, err
		}
		trashedItems = append(trashedItems, TrashItem{
			Item: Item{
				NoteID:          item.NoteID,
				TopicID:         item.TopicID,
				Body:            item.Body,
				PreviewText:     item.PreviewText,
				CharacterCount:  item.CharacterCount,
				SizeBucket:      item.SizeBucket,
				StyleVersion:    item.StyleVersion,
				ColorToken:      item.ColorToken,
				X:               item.X,
				Y:               item.Y,
				ZIndex:          item.ZIndex,
				CreatedAtUnixMs: item.CreatedAtUnixMs,
				UpdatedAtUnixMs: nowUnixMs,
			},
			TopicName:       topic.Name,
			TopicIconKey:    topic.IconKey,
			TopicIconAccent: topic.IconAccent,
			TopicSortOrder:  topic.SortOrder,
			DeletedAtUnixMs: nowUnixMs,
		})
	}
	topic.DeletedAtUnixMs = nowUnixMs
	topic.UpdatedAtUnixMs = nowUnixMs
	if _, err := tx.ExecContext(ctx, `
UPDATE notes_topics
SET deleted_at_unix_ms = ?, updated_at_unix_ms = ?
WHERE topic_id = ? AND deleted_at_unix_ms = 0
`, topic.DeletedAtUnixMs, topic.UpdatedAtUnixMs, topic.TopicID); err != nil {
		return nil, err
	}

	event, err := appendEventTx(tx, eventEnvelope{
		Type:            "topic.deleted",
		EntityKind:      "topic",
		EntityID:        topic.TopicID,
		TopicID:         topic.TopicID,
		CreatedAtUnixMs: nowUnixMs,
		Payload: struct {
			Topic      Topic       `json:"topic"`
			TrashItems []TrashItem `json:"trash_items"`
		}{
			Topic:      *topic,
			TrashItems: trashedItems,
		},
	})
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return []Event{event}, nil
}

func (s *Store) createItem(ctx context.Context, req CreateItemRequest) (Item, Event, error) {
	ctx = normalizeContext(ctx)
	topicID := strings.TrimSpace(req.TopicID)
	if topicID == "" {
		return Item{}, Event{}, ErrInvalidTopicID
	}
	body, err := normalizeBody(req.Body)
	if err != nil {
		return Item{}, Event{}, err
	}
	if err := validateCoordinate(req.X); err != nil {
		return Item{}, Event{}, err
	}
	if err := validateCoordinate(req.Y); err != nil {
		return Item{}, Event{}, err
	}
	colorToken, hasColor, err := normalizeOptionalColor(req.ColorToken)
	if err != nil {
		return Item{}, Event{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, Event{}, err
	}
	defer func() { _ = tx.Rollback() }()

	topic, err := loadActiveTopicTx(ctx, tx, topicID)
	if err != nil {
		return Item{}, Event{}, err
	}
	if topic == nil {
		return Item{}, Event{}, ErrTopicNotFound
	}

	nowUnixMs := time.Now().UnixMilli()
	if !hasColor {
		colorToken = randomPaletteValue(noteColorPalette)
	}
	previewText, characterCount, sizeBucket := projectionFromBody(body)
	zIndex, err := nextActiveZIndexTx(tx)
	if err != nil {
		return Item{}, Event{}, err
	}
	item := Item{
		NoteID:          randomScopedID("note"),
		TopicID:         topic.TopicID,
		Body:            body,
		PreviewText:     previewText,
		CharacterCount:  characterCount,
		SizeBucket:      sizeBucket,
		StyleVersion:    DefaultStyleVersion,
		ColorToken:      colorToken,
		X:               req.X,
		Y:               req.Y,
		ZIndex:          zIndex,
		CreatedAtUnixMs: nowUnixMs,
		UpdatedAtUnixMs: nowUnixMs,
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO notes_items(
  note_id, topic_id, body, preview_text, character_count, size_bucket,
  style_version, color_token, x, y, z_index,
  created_at_unix_ms, updated_at_unix_ms, deleted_at_unix_ms, deleted_snapshot_json
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '')
`, item.NoteID, item.TopicID, item.Body, item.PreviewText, item.CharacterCount, item.SizeBucket, item.StyleVersion, item.ColorToken, item.X, item.Y, item.ZIndex, item.CreatedAtUnixMs, item.UpdatedAtUnixMs); err != nil {
		return Item{}, Event{}, err
	}

	event, err := appendEventTx(tx, eventEnvelope{
		Type:            "item.created",
		EntityKind:      "item",
		EntityID:        item.NoteID,
		TopicID:         item.TopicID,
		CreatedAtUnixMs: nowUnixMs,
		Payload: struct {
			Item Item `json:"item"`
		}{Item: item},
	})
	if err != nil {
		return Item{}, Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return Item{}, Event{}, err
	}
	return item, event, nil
}

func (s *Store) updateItem(ctx context.Context, req UpdateItemRequest) (Item, Event, error) {
	ctx = normalizeContext(ctx)
	noteID := strings.TrimSpace(req.NoteID)
	if noteID == "" {
		return Item{}, Event{}, ErrInvalidNoteID
	}
	colorToken, hasColor, err := normalizeOptionalColor(req.ColorToken)
	if err != nil {
		return Item{}, Event{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, Event{}, err
	}
	defer func() { _ = tx.Rollback() }()

	item, err := loadActiveItemTx(ctx, tx, noteID)
	if err != nil {
		return Item{}, Event{}, err
	}
	if item == nil {
		return Item{}, Event{}, ErrNoteNotFound
	}
	if req.Body == nil && !hasColor && req.X == nil && req.Y == nil {
		return Item{}, Event{}, fmt.Errorf("%w: missing fields", ErrInvalidNoteBody)
	}

	if req.Body != nil {
		body, err := normalizeBody(*req.Body)
		if err != nil {
			return Item{}, Event{}, err
		}
		item.Body = body
		item.PreviewText, item.CharacterCount, item.SizeBucket = projectionFromBody(item.Body)
	}
	if hasColor {
		item.ColorToken = colorToken
	}
	if req.X != nil {
		if err := validateCoordinate(*req.X); err != nil {
			return Item{}, Event{}, err
		}
		item.X = *req.X
	}
	if req.Y != nil {
		if err := validateCoordinate(*req.Y); err != nil {
			return Item{}, Event{}, err
		}
		item.Y = *req.Y
	}
	item.UpdatedAtUnixMs = time.Now().UnixMilli()

	if _, err := tx.ExecContext(ctx, `
UPDATE notes_items
SET body = ?, preview_text = ?, character_count = ?, size_bucket = ?,
    color_token = ?, x = ?, y = ?, updated_at_unix_ms = ?
WHERE note_id = ? AND deleted_at_unix_ms = 0
`, item.Body, item.PreviewText, item.CharacterCount, item.SizeBucket, item.ColorToken, item.X, item.Y, item.UpdatedAtUnixMs, item.NoteID); err != nil {
		return Item{}, Event{}, err
	}

	event, err := appendEventTx(tx, eventEnvelope{
		Type:            "item.updated",
		EntityKind:      "item",
		EntityID:        item.NoteID,
		TopicID:         item.TopicID,
		CreatedAtUnixMs: item.UpdatedAtUnixMs,
		Payload: struct {
			Item Item `json:"item"`
		}{Item: *item},
	})
	if err != nil {
		return Item{}, Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return Item{}, Event{}, err
	}
	return *item, event, nil
}

func (s *Store) bringItemToFront(ctx context.Context, noteID string) (Item, Event, error) {
	ctx = normalizeContext(ctx)
	noteID = strings.TrimSpace(noteID)
	if noteID == "" {
		return Item{}, Event{}, ErrInvalidNoteID
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, Event{}, err
	}
	defer func() { _ = tx.Rollback() }()

	item, err := loadActiveItemTx(ctx, tx, noteID)
	if err != nil {
		return Item{}, Event{}, err
	}
	if item == nil {
		return Item{}, Event{}, ErrNoteNotFound
	}
	nextZ, err := nextActiveZIndexTx(tx)
	if err != nil {
		return Item{}, Event{}, err
	}
	if nextZ <= item.ZIndex {
		nextZ = item.ZIndex + 1
	}
	item.ZIndex = nextZ
	item.UpdatedAtUnixMs = time.Now().UnixMilli()
	if _, err := tx.ExecContext(ctx, `
UPDATE notes_items
SET z_index = ?, updated_at_unix_ms = ?
WHERE note_id = ? AND deleted_at_unix_ms = 0
`, item.ZIndex, item.UpdatedAtUnixMs, item.NoteID); err != nil {
		return Item{}, Event{}, err
	}
	event, err := appendEventTx(tx, eventEnvelope{
		Type:            "item.fronted",
		EntityKind:      "item",
		EntityID:        item.NoteID,
		TopicID:         item.TopicID,
		CreatedAtUnixMs: item.UpdatedAtUnixMs,
		Payload: struct {
			Item Item `json:"item"`
		}{Item: *item},
	})
	if err != nil {
		return Item{}, Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return Item{}, Event{}, err
	}
	return *item, event, nil
}

func (s *Store) deleteItem(ctx context.Context, noteID string) (Event, error) {
	ctx = normalizeContext(ctx)
	noteID = strings.TrimSpace(noteID)
	if noteID == "" {
		return Event{}, ErrInvalidNoteID
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Event{}, err
	}
	defer func() { _ = tx.Rollback() }()

	item, err := loadActiveItemTx(ctx, tx, noteID)
	if err != nil {
		return Event{}, err
	}
	if item == nil {
		return Event{}, ErrNoteNotFound
	}
	topic, err := loadTopicTx(ctx, tx, item.TopicID)
	if err != nil {
		return Event{}, err
	}
	if topic == nil {
		return Event{}, ErrTopicNotFound
	}

	nowUnixMs := time.Now().UnixMilli()
	snapshotBytes, err := json.Marshal(deletedSnapshot{
		TopicID:         topic.TopicID,
		TopicName:       topic.Name,
		TopicIconKey:    topic.IconKey,
		TopicIconAccent: topic.IconAccent,
		TopicSortOrder:  topic.SortOrder,
		X:               item.X,
		Y:               item.Y,
		ZIndex:          item.ZIndex,
		StyleVersion:    item.StyleVersion,
		ColorToken:      item.ColorToken,
		SizeBucket:      item.SizeBucket,
	})
	if err != nil {
		return Event{}, err
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE notes_items
SET deleted_at_unix_ms = ?, updated_at_unix_ms = ?, deleted_snapshot_json = ?
WHERE note_id = ? AND deleted_at_unix_ms = 0
`, nowUnixMs, nowUnixMs, string(snapshotBytes), item.NoteID); err != nil {
		return Event{}, err
	}
	trashItem := TrashItem{
		Item: Item{
			NoteID:          item.NoteID,
			TopicID:         item.TopicID,
			Body:            item.Body,
			PreviewText:     item.PreviewText,
			CharacterCount:  item.CharacterCount,
			SizeBucket:      item.SizeBucket,
			StyleVersion:    item.StyleVersion,
			ColorToken:      item.ColorToken,
			X:               item.X,
			Y:               item.Y,
			ZIndex:          item.ZIndex,
			CreatedAtUnixMs: item.CreatedAtUnixMs,
			UpdatedAtUnixMs: nowUnixMs,
		},
		TopicName:       topic.Name,
		TopicIconKey:    topic.IconKey,
		TopicIconAccent: topic.IconAccent,
		TopicSortOrder:  topic.SortOrder,
		DeletedAtUnixMs: nowUnixMs,
	}
	event, err := appendEventTx(tx, eventEnvelope{
		Type:            "item.deleted",
		EntityKind:      "item",
		EntityID:        item.NoteID,
		TopicID:         item.TopicID,
		CreatedAtUnixMs: nowUnixMs,
		Payload: struct {
			TrashItem TrashItem `json:"trash_item"`
		}{TrashItem: trashItem},
	})
	if err != nil {
		return Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return Event{}, err
	}
	return event, nil
}

func (s *Store) restoreItem(ctx context.Context, noteID string) (Item, []Event, error) {
	ctx = normalizeContext(ctx)
	noteID = strings.TrimSpace(noteID)
	if noteID == "" {
		return Item{}, nil, ErrInvalidNoteID
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, nil, err
	}
	defer func() { _ = tx.Rollback() }()

	item, deletedAtUnixMs, snapshot, err := loadDeletedItemWithSnapshotTx(ctx, tx, noteID)
	if err != nil {
		return Item{}, nil, err
	}
	if item == nil {
		return Item{}, nil, ErrNoteNotFound
	}
	topic, err := loadTopicTx(ctx, tx, snapshot.TopicID)
	if err != nil {
		return Item{}, nil, err
	}
	if topic == nil {
		return Item{}, nil, ErrTopicNotFound
	}
	nowUnixMs := time.Now().UnixMilli()
	var events []Event
	var restoredTopic *Topic
	if topic.DeletedAtUnixMs > 0 {
		topic.Name = snapshot.TopicName
		topic.IconKey = snapshot.TopicIconKey
		topic.IconAccent = snapshot.TopicIconAccent
		topic.SortOrder = snapshot.TopicSortOrder
		topic.DeletedAtUnixMs = 0
		topic.UpdatedAtUnixMs = nowUnixMs
		if _, err := tx.ExecContext(ctx, `
UPDATE notes_topics
SET name = ?, icon_key = ?, icon_accent = ?, sort_order = ?, deleted_at_unix_ms = 0, updated_at_unix_ms = ?
WHERE topic_id = ?
`, topic.Name, topic.IconKey, topic.IconAccent, topic.SortOrder, topic.UpdatedAtUnixMs, topic.TopicID); err != nil {
			return Item{}, nil, err
		}
		restoredTopic = topic
	}

	item.TopicID = snapshot.TopicID
	item.X = snapshot.X
	item.Y = snapshot.Y
	item.ZIndex = snapshot.ZIndex
	item.StyleVersion = snapshot.StyleVersion
	item.ColorToken = snapshot.ColorToken
	item.SizeBucket = snapshot.SizeBucket
	item.UpdatedAtUnixMs = nowUnixMs
	item.PreviewText, item.CharacterCount, _ = projectionFromBody(item.Body)
	if _, err := tx.ExecContext(ctx, `
UPDATE notes_items
SET topic_id = ?, x = ?, y = ?, z_index = ?, style_version = ?, color_token = ?, size_bucket = ?,
    preview_text = ?, character_count = ?, updated_at_unix_ms = ?, deleted_at_unix_ms = 0, deleted_snapshot_json = ''
WHERE note_id = ? AND deleted_at_unix_ms = ?
`, item.TopicID, item.X, item.Y, item.ZIndex, item.StyleVersion, item.ColorToken, item.SizeBucket, item.PreviewText, item.CharacterCount, item.UpdatedAtUnixMs, item.NoteID, deletedAtUnixMs); err != nil {
		return Item{}, nil, err
	}

	if restoredTopic != nil {
		event, err := appendEventTx(tx, eventEnvelope{
			Type:            "topic.restored",
			EntityKind:      "topic",
			EntityID:        restoredTopic.TopicID,
			TopicID:         restoredTopic.TopicID,
			CreatedAtUnixMs: nowUnixMs,
			Payload: struct {
				Topic Topic `json:"topic"`
			}{Topic: *restoredTopic},
		})
		if err != nil {
			return Item{}, nil, err
		}
		events = append(events, event)
	}
	event, err := appendEventTx(tx, eventEnvelope{
		Type:            "item.restored",
		EntityKind:      "item",
		EntityID:        item.NoteID,
		TopicID:         item.TopicID,
		CreatedAtUnixMs: nowUnixMs,
		Payload: struct {
			Item Item `json:"item"`
		}{Item: *item},
	})
	if err != nil {
		return Item{}, nil, err
	}
	events = append(events, event)
	if err := tx.Commit(); err != nil {
		return Item{}, nil, err
	}
	return *item, events, nil
}

func (s *Store) clearTrashTopic(ctx context.Context, topicID string) (Event, error) {
	ctx = normalizeContext(ctx)
	topicID = strings.TrimSpace(topicID)
	if topicID == "" {
		return Event{}, ErrInvalidTopicID
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Event{}, err
	}
	defer func() { _ = tx.Rollback() }()

	deletedIDs, err := listDeletedItemIDsByTopicTx(ctx, tx, topicID)
	if err != nil {
		return Event{}, err
	}
	if len(deletedIDs) == 0 {
		return Event{}, nil
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM notes_items WHERE topic_id = ? AND deleted_at_unix_ms > 0`, topicID); err != nil {
		return Event{}, err
	}
	topicRemoved := false
	topic, err := loadTopicTx(ctx, tx, topicID)
	if err != nil {
		return Event{}, err
	}
	if topic != nil && topic.DeletedAtUnixMs > 0 {
		hasItems, err := topicHasAnyItemsTx(ctx, tx, topicID)
		if err != nil {
			return Event{}, err
		}
		if !hasItems {
			if _, err := tx.ExecContext(ctx, `DELETE FROM notes_topics WHERE topic_id = ?`, topicID); err != nil {
				return Event{}, err
			}
			topicRemoved = true
		}
	}
	nowUnixMs := time.Now().UnixMilli()
	event, err := appendEventTx(tx, eventEnvelope{
		Type:            "trash.topic_cleared",
		EntityKind:      "trash",
		EntityID:        topicID,
		TopicID:         topicID,
		CreatedAtUnixMs: nowUnixMs,
		Payload: struct {
			TopicID      string   `json:"topic_id"`
			DeletedIDs   []string `json:"deleted_ids"`
			TopicRemoved bool     `json:"topic_removed"`
		}{
			TopicID:      topicID,
			DeletedIDs:   deletedIDs,
			TopicRemoved: topicRemoved,
		},
	})
	if err != nil {
		return Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return Event{}, err
	}
	return event, nil
}

func (s *Store) deleteTrashedItemPermanently(ctx context.Context, noteID string) (Event, error) {
	ctx = normalizeContext(ctx)
	noteID = strings.TrimSpace(noteID)
	if noteID == "" {
		return Event{}, ErrInvalidNoteID
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Event{}, err
	}
	defer func() { _ = tx.Rollback() }()

	item, _, snapshot, err := loadDeletedItemWithSnapshotTx(ctx, tx, noteID)
	if err != nil {
		return Event{}, err
	}
	if item == nil {
		return Event{}, ErrNoteNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM notes_items WHERE note_id = ? AND deleted_at_unix_ms > 0`, noteID); err != nil {
		return Event{}, err
	}

	topicID := strings.TrimSpace(snapshot.TopicID)
	if topicID == "" {
		topicID = strings.TrimSpace(item.TopicID)
	}
	topicRemoved := false
	if topicID != "" {
		topic, err := loadTopicTx(ctx, tx, topicID)
		if err != nil {
			return Event{}, err
		}
		if topic != nil && topic.DeletedAtUnixMs > 0 {
			hasItems, err := topicHasAnyItemsTx(ctx, tx, topicID)
			if err != nil {
				return Event{}, err
			}
			if !hasItems {
				if _, err := tx.ExecContext(ctx, `DELETE FROM notes_topics WHERE topic_id = ?`, topicID); err != nil {
					return Event{}, err
				}
				topicRemoved = true
			}
		}
	}

	nowUnixMs := time.Now().UnixMilli()
	event, err := appendEventTx(tx, eventEnvelope{
		Type:            "item.removed",
		EntityKind:      "item",
		EntityID:        noteID,
		TopicID:         topicID,
		CreatedAtUnixMs: nowUnixMs,
		Payload: struct {
			NoteID       string `json:"note_id"`
			TopicID      string `json:"topic_id"`
			TopicRemoved bool   `json:"topic_removed"`
		}{
			NoteID:       noteID,
			TopicID:      topicID,
			TopicRemoved: topicRemoved,
		},
	})
	if err != nil {
		return Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return Event{}, err
	}
	return event, nil
}

type eventEnvelope struct {
	Type            string
	EntityKind      string
	EntityID        string
	TopicID         string
	CreatedAtUnixMs int64
	Payload         any
}

func appendEventTx(tx *sql.Tx, env eventEnvelope) (Event, error) {
	payload, err := json.Marshal(env.Payload)
	if err != nil {
		return Event{}, err
	}
	result, err := tx.Exec(`
INSERT INTO notes_events(event_type, entity_kind, entity_id, topic_id, payload_json, created_at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?)
`, env.Type, env.EntityKind, env.EntityID, strings.TrimSpace(env.TopicID), string(payload), env.CreatedAtUnixMs)
	if err != nil {
		return Event{}, err
	}
	seq, err := result.LastInsertId()
	if err != nil {
		return Event{}, err
	}
	return Event{
		Seq:             seq,
		Type:            env.Type,
		EntityKind:      env.EntityKind,
		EntityID:        env.EntityID,
		TopicID:         strings.TrimSpace(env.TopicID),
		CreatedAtUnixMs: env.CreatedAtUnixMs,
		Payload:         json.RawMessage(payload),
	}, nil
}

func insertWelcomeSeedTx(ctx context.Context, tx *sql.Tx, nowUnixMs int64) error {
	sortOrder, err := nextTopicSortOrderTx(tx)
	if err != nil {
		return err
	}
	iconKey, iconAccent, err := assignedTopicDecorationTx(tx)
	if err != nil {
		return err
	}

	topic := Topic{
		TopicID:         randomScopedID("topic"),
		Name:            welcomeTopicName,
		IconKey:         iconKey,
		IconAccent:      iconAccent,
		SortOrder:       sortOrder,
		CreatedAtUnixMs: nowUnixMs,
		UpdatedAtUnixMs: nowUnixMs,
		DeletedAtUnixMs: 0,
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO notes_topics(
  topic_id, name, icon_key, icon_accent, sort_order,
  created_at_unix_ms, updated_at_unix_ms, deleted_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, 0)
`, topic.TopicID, topic.Name, topic.IconKey, topic.IconAccent, topic.SortOrder, topic.CreatedAtUnixMs, topic.UpdatedAtUnixMs); err != nil {
		return err
	}
	if _, err := appendEventTx(tx, eventEnvelope{
		Type:            "topic.created",
		EntityKind:      "topic",
		EntityID:        topic.TopicID,
		TopicID:         topic.TopicID,
		CreatedAtUnixMs: nowUnixMs,
		Payload: struct {
			Topic Topic `json:"topic"`
		}{Topic: topic},
	}); err != nil {
		return err
	}

	body, err := normalizeBody(welcomeNoteBody)
	if err != nil {
		return err
	}
	previewText, characterCount, sizeBucket := projectionFromBody(body)
	zIndex, err := nextActiveZIndexTx(tx)
	if err != nil {
		return err
	}
	item := Item{
		NoteID:          randomScopedID("note"),
		TopicID:         topic.TopicID,
		Body:            body,
		PreviewText:     previewText,
		CharacterCount:  characterCount,
		SizeBucket:      sizeBucket,
		StyleVersion:    DefaultStyleVersion,
		ColorToken:      welcomeNoteColor,
		X:               welcomeNoteX,
		Y:               welcomeNoteY,
		ZIndex:          zIndex,
		CreatedAtUnixMs: nowUnixMs,
		UpdatedAtUnixMs: nowUnixMs,
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO notes_items(
  note_id, topic_id, body, preview_text, character_count, size_bucket,
  style_version, color_token, x, y, z_index,
  created_at_unix_ms, updated_at_unix_ms, deleted_at_unix_ms, deleted_snapshot_json
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '')
`, item.NoteID, item.TopicID, item.Body, item.PreviewText, item.CharacterCount, item.SizeBucket, item.StyleVersion, item.ColorToken, item.X, item.Y, item.ZIndex, item.CreatedAtUnixMs, item.UpdatedAtUnixMs); err != nil {
		return err
	}
	if _, err := appendEventTx(tx, eventEnvelope{
		Type:            "item.created",
		EntityKind:      "item",
		EntityID:        item.NoteID,
		TopicID:         item.TopicID,
		CreatedAtUnixMs: nowUnixMs,
		Payload: struct {
			Item Item `json:"item"`
		}{Item: item},
	}); err != nil {
		return err
	}
	return nil
}

func currentSeqTx(tx *sql.Tx) (int64, error) {
	var seq sql.NullInt64
	if err := tx.QueryRow(`SELECT MAX(seq) FROM notes_events`).Scan(&seq); err != nil {
		return 0, err
	}
	if !seq.Valid {
		return 0, nil
	}
	return seq.Int64, nil
}

func notesStateExistsTx(ctx context.Context, tx *sql.Tx) (bool, error) {
	var topicCount sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM notes_topics`).Scan(&topicCount); err != nil {
		return false, err
	}
	if topicCount.Int64 > 0 {
		return true, nil
	}

	var itemCount sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM notes_items`).Scan(&itemCount); err != nil {
		return false, err
	}
	return itemCount.Int64 > 0, nil
}

func listTopicsTx(ctx context.Context, tx *sql.Tx) ([]Topic, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT topic_id, name, icon_key, icon_accent, sort_order, created_at_unix_ms, updated_at_unix_ms, deleted_at_unix_ms
FROM notes_topics
WHERE deleted_at_unix_ms = 0
ORDER BY sort_order ASC, topic_id ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Topic, 0)
	for rows.Next() {
		var topic Topic
		if err := rows.Scan(&topic.TopicID, &topic.Name, &topic.IconKey, &topic.IconAccent, &topic.SortOrder, &topic.CreatedAtUnixMs, &topic.UpdatedAtUnixMs, &topic.DeletedAtUnixMs); err != nil {
			return nil, err
		}
		out = append(out, topic)
	}
	return out, rows.Err()
}

func listActiveItemsTx(ctx context.Context, tx *sql.Tx) ([]Item, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT note_id, topic_id, body, preview_text, character_count, size_bucket, style_version, color_token, x, y, z_index, created_at_unix_ms, updated_at_unix_ms
FROM notes_items
WHERE deleted_at_unix_ms = 0
ORDER BY z_index ASC, note_id ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Item, 0)
	for rows.Next() {
		var item Item
		if err := rows.Scan(&item.NoteID, &item.TopicID, &item.Body, &item.PreviewText, &item.CharacterCount, &item.SizeBucket, &item.StyleVersion, &item.ColorToken, &item.X, &item.Y, &item.ZIndex, &item.CreatedAtUnixMs, &item.UpdatedAtUnixMs); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func listTrashItemsTx(ctx context.Context, tx *sql.Tx) ([]TrashItem, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT n.note_id, n.topic_id, n.body, n.preview_text, n.character_count, n.size_bucket, n.style_version, n.color_token,
       n.x, n.y, n.z_index, n.created_at_unix_ms, n.updated_at_unix_ms, n.deleted_at_unix_ms,
       t.name, t.icon_key, t.icon_accent, t.sort_order
FROM notes_items n
JOIN notes_topics t ON t.topic_id = n.topic_id
WHERE n.deleted_at_unix_ms > 0
ORDER BY n.deleted_at_unix_ms DESC, n.note_id DESC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]TrashItem, 0)
	for rows.Next() {
		var item TrashItem
		if err := rows.Scan(
			&item.NoteID,
			&item.TopicID,
			&item.Body,
			&item.PreviewText,
			&item.CharacterCount,
			&item.SizeBucket,
			&item.StyleVersion,
			&item.ColorToken,
			&item.X,
			&item.Y,
			&item.ZIndex,
			&item.CreatedAtUnixMs,
			&item.UpdatedAtUnixMs,
			&item.DeletedAtUnixMs,
			&item.TopicName,
			&item.TopicIconKey,
			&item.TopicIconAccent,
			&item.TopicSortOrder,
		); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func listTopicActiveItemsTx(ctx context.Context, tx *sql.Tx, topicID string) ([]Item, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT note_id, topic_id, body, preview_text, character_count, size_bucket, style_version, color_token, x, y, z_index, created_at_unix_ms, updated_at_unix_ms
FROM notes_items
WHERE topic_id = ? AND deleted_at_unix_ms = 0
ORDER BY z_index ASC, note_id ASC
`, topicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Item, 0)
	for rows.Next() {
		var item Item
		if err := rows.Scan(&item.NoteID, &item.TopicID, &item.Body, &item.PreviewText, &item.CharacterCount, &item.SizeBucket, &item.StyleVersion, &item.ColorToken, &item.X, &item.Y, &item.ZIndex, &item.CreatedAtUnixMs, &item.UpdatedAtUnixMs); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func loadTopicTx(ctx context.Context, tx *sql.Tx, topicID string) (*Topic, error) {
	var topic Topic
	err := tx.QueryRowContext(ctx, `
SELECT topic_id, name, icon_key, icon_accent, sort_order, created_at_unix_ms, updated_at_unix_ms, deleted_at_unix_ms
FROM notes_topics
WHERE topic_id = ?
`, topicID).Scan(&topic.TopicID, &topic.Name, &topic.IconKey, &topic.IconAccent, &topic.SortOrder, &topic.CreatedAtUnixMs, &topic.UpdatedAtUnixMs, &topic.DeletedAtUnixMs)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &topic, nil
}

func loadActiveTopicTx(ctx context.Context, tx *sql.Tx, topicID string) (*Topic, error) {
	topic, err := loadTopicTx(ctx, tx, topicID)
	if err != nil {
		return nil, err
	}
	if topic == nil || topic.DeletedAtUnixMs > 0 {
		return nil, nil
	}
	return topic, nil
}

func loadActiveItemTx(ctx context.Context, tx *sql.Tx, noteID string) (*Item, error) {
	var item Item
	var deletedAt int64
	err := tx.QueryRowContext(ctx, `
SELECT note_id, topic_id, body, preview_text, character_count, size_bucket, style_version, color_token,
       x, y, z_index, created_at_unix_ms, updated_at_unix_ms, deleted_at_unix_ms
FROM notes_items
WHERE note_id = ?
`, noteID).Scan(
		&item.NoteID,
		&item.TopicID,
		&item.Body,
		&item.PreviewText,
		&item.CharacterCount,
		&item.SizeBucket,
		&item.StyleVersion,
		&item.ColorToken,
		&item.X,
		&item.Y,
		&item.ZIndex,
		&item.CreatedAtUnixMs,
		&item.UpdatedAtUnixMs,
		&deletedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if deletedAt > 0 {
		return nil, nil
	}
	return &item, nil
}

func loadDeletedItemWithSnapshotTx(ctx context.Context, tx *sql.Tx, noteID string) (*Item, int64, deletedSnapshot, error) {
	var item Item
	var deletedAt int64
	var snapshotJSON string
	err := tx.QueryRowContext(ctx, `
SELECT note_id, topic_id, body, preview_text, character_count, size_bucket, style_version, color_token,
       x, y, z_index, created_at_unix_ms, updated_at_unix_ms, deleted_at_unix_ms, deleted_snapshot_json
FROM notes_items
WHERE note_id = ? AND deleted_at_unix_ms > 0
`, noteID).Scan(
		&item.NoteID,
		&item.TopicID,
		&item.Body,
		&item.PreviewText,
		&item.CharacterCount,
		&item.SizeBucket,
		&item.StyleVersion,
		&item.ColorToken,
		&item.X,
		&item.Y,
		&item.ZIndex,
		&item.CreatedAtUnixMs,
		&item.UpdatedAtUnixMs,
		&deletedAt,
		&snapshotJSON,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, 0, deletedSnapshot{}, nil
	}
	if err != nil {
		return nil, 0, deletedSnapshot{}, err
	}
	var snapshot deletedSnapshot
	if err := json.Unmarshal([]byte(snapshotJSON), &snapshot); err != nil {
		return nil, 0, deletedSnapshot{}, err
	}
	return &item, deletedAt, snapshot, nil
}

func nextTopicSortOrderTx(tx *sql.Tx) (int, error) {
	var next sql.NullInt64
	if err := tx.QueryRow(`SELECT COALESCE(MAX(sort_order), -1) + 1 FROM notes_topics`).Scan(&next); err != nil {
		return 0, err
	}
	if !next.Valid {
		return 0, nil
	}
	return int(next.Int64), nil
}

func assignedTopicDecorationTx(tx *sql.Tx) (string, string, error) {
	var count sql.NullInt64
	if err := tx.QueryRow(`SELECT COUNT(*) FROM notes_topics`).Scan(&count); err != nil {
		return "", "", err
	}
	index := int(count.Int64)
	return topicAnimalPalette[index%len(topicAnimalPalette)], topicAccentPalette[index%len(topicAccentPalette)], nil
}

func nextActiveZIndexTx(tx *sql.Tx) (int, error) {
	var next sql.NullInt64
	if err := tx.QueryRow(`SELECT COALESCE(MAX(z_index), 0) + 1 FROM notes_items WHERE deleted_at_unix_ms = 0`).Scan(&next); err != nil {
		return 0, err
	}
	if !next.Valid {
		return 1, nil
	}
	return int(next.Int64), nil
}

func countTopicTrashItemsTx(ctx context.Context, tx *sql.Tx, topicID string) (int, error) {
	var count sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM notes_items WHERE topic_id = ? AND deleted_at_unix_ms > 0`, topicID).Scan(&count); err != nil {
		return 0, err
	}
	return int(count.Int64), nil
}

func topicHasAnyItemsTx(ctx context.Context, tx *sql.Tx, topicID string) (bool, error) {
	var count sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM notes_items WHERE topic_id = ?`, topicID).Scan(&count); err != nil {
		return false, err
	}
	return count.Int64 > 0, nil
}

func listDeletedItemIDsByTopicTx(ctx context.Context, tx *sql.Tx, topicID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT note_id
FROM notes_items
WHERE topic_id = ? AND deleted_at_unix_ms > 0
ORDER BY deleted_at_unix_ms DESC, note_id DESC
`, topicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var noteID string
		if err := rows.Scan(&noteID); err != nil {
			return nil, err
		}
		out = append(out, noteID)
	}
	return out, rows.Err()
}

func purgeExpiredTrashTx(tx *sql.Tx, nowUnixMs int64) error {
	cutoff := nowUnixMs - int64(RetentionHours)*int64(time.Hour/time.Millisecond)
	if cutoff <= 0 {
		return nil
	}
	if _, err := tx.Exec(`DELETE FROM notes_items WHERE deleted_at_unix_ms > 0 AND deleted_at_unix_ms <= ?`, cutoff); err != nil {
		return err
	}
	return nil
}

func cleanupDeletedTopicsWithoutItemsTx(tx *sql.Tx) error {
	_, err := tx.Exec(`
DELETE FROM notes_topics
WHERE deleted_at_unix_ms > 0
  AND NOT EXISTS (
    SELECT 1
    FROM notes_items
    WHERE notes_items.topic_id = notes_topics.topic_id
  )
`)
	return err
}

func normalizeContext(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return ctx
}

func normalizeBody(value string) (string, error) {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	if utf8.RuneCountInString(value) > maxNoteBodyRunes {
		return "", fmt.Errorf("%w: note body is too long", ErrInvalidNoteBody)
	}
	return value, nil
}

func projectionFromBody(body string) (string, int, int) {
	count := utf8.RuneCountInString(strings.TrimSpace(body))
	previewSource := strings.TrimSpace(body)
	if previewSource == "" {
		return "", count, 1
	}
	preview := truncateRunes(previewSource, DefaultPreviewMaxRunes)
	return preview, count, sizeBucketForCount(count)
}

func sizeBucketForCount(count int) int {
	switch {
	case count <= 24:
		return 1
	case count <= 80:
		return 2
	case count <= 180:
		return 3
	case count <= 360:
		return 4
	default:
		return 5
	}
}

func truncateRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := make([]rune, 0, limit)
	for _, r := range value {
		if len(runes) >= limit {
			break
		}
		runes = append(runes, r)
	}
	return string(runes) + "…"
}

func randomScopedID(prefix string) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		prefix = "notes"
	}
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	out := make([]byte, 0, len(prefix)+1+12)
	out = append(out, prefix...)
	out = append(out, '_')
	for i := 0; i < 12; i++ {
		out = append(out, alphabet[int(buf[i])%len(alphabet)])
	}
	return string(out)
}

func randomPaletteValue(values []string) string {
	if len(values) == 0 {
		return ""
	}
	buf := make([]byte, 1)
	if _, err := rand.Read(buf); err != nil {
		return values[0]
	}
	return values[int(buf[0])%len(values)]
}

func validateCoordinate(value float64) error {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return fmt.Errorf("%w: invalid coordinate", ErrInvalidNoteBody)
	}
	if value < -1_000_000 || value > 1_000_000 {
		return fmt.Errorf("%w: coordinate out of range", ErrInvalidNoteBody)
	}
	return nil
}
