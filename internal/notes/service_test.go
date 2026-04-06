package notes

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func openTestService(t *testing.T) *Service {
	t.Helper()

	svc, err := Open(filepath.Join(t.TempDir(), "notes.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() {
		if err := svc.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
	})
	return svc
}

func TestServiceCreateDeleteRestoreTopicFlow(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := openTestService(t)

	topic, err := svc.CreateTopic(ctx, CreateTopicRequest{Name: "Research Threads"})
	if err != nil {
		t.Fatalf("CreateTopic() error = %v", err)
	}

	body := strings.Repeat("restore ", 42)
	color := "amber"
	item, err := svc.CreateItem(ctx, CreateItemRequest{
		TopicID:    topic.TopicID,
		Body:       body,
		ColorToken: &color,
		X:          1384,
		Y:          -720,
	})
	if err != nil {
		t.Fatalf("CreateItem() error = %v", err)
	}
	if item.SizeBucket < 3 {
		t.Fatalf("CreateItem() size bucket = %d, want >= 3", item.SizeBucket)
	}

	if err := svc.DeleteTopic(ctx, topic.TopicID); err != nil {
		t.Fatalf("DeleteTopic() error = %v", err)
	}

	deleted, err := svc.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() after delete error = %v", err)
	}
	if len(deleted.Topics) != 0 {
		t.Fatalf("deleted snapshot topics = %d, want 0", len(deleted.Topics))
	}
	if len(deleted.Items) != 0 {
		t.Fatalf("deleted snapshot items = %d, want 0", len(deleted.Items))
	}
	if len(deleted.TrashItems) != 1 {
		t.Fatalf("deleted snapshot trash = %d, want 1", len(deleted.TrashItems))
	}

	restored, err := svc.RestoreItem(ctx, item.NoteID)
	if err != nil {
		t.Fatalf("RestoreItem() error = %v", err)
	}
	if restored.TopicID != topic.TopicID {
		t.Fatalf("restored topic_id = %q, want %q", restored.TopicID, topic.TopicID)
	}
	if restored.X != item.X || restored.Y != item.Y {
		t.Fatalf("restored coordinates = (%v, %v), want (%v, %v)", restored.X, restored.Y, item.X, item.Y)
	}
	if restored.ColorToken != item.ColorToken {
		t.Fatalf("restored color = %q, want %q", restored.ColorToken, item.ColorToken)
	}
	if restored.SizeBucket != item.SizeBucket {
		t.Fatalf("restored size bucket = %d, want %d", restored.SizeBucket, item.SizeBucket)
	}

	finalSnapshot, err := svc.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() after restore error = %v", err)
	}
	if len(finalSnapshot.Topics) != 1 {
		t.Fatalf("final topics = %d, want 1", len(finalSnapshot.Topics))
	}
	if len(finalSnapshot.Items) != 1 {
		t.Fatalf("final items = %d, want 1", len(finalSnapshot.Items))
	}
	if len(finalSnapshot.TrashItems) != 0 {
		t.Fatalf("final trash = %d, want 0", len(finalSnapshot.TrashItems))
	}
}

func TestServicePurgeExpiredTrashAndClearTrashTopic(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := openTestService(t)

	topic, err := svc.CreateTopic(ctx, CreateTopicRequest{Name: "Backlog"})
	if err != nil {
		t.Fatalf("CreateTopic() error = %v", err)
	}
	item, err := svc.CreateItem(ctx, CreateItemRequest{
		TopicID: topic.TopicID,
		Body:    "stale note",
		X:       12,
		Y:       24,
	})
	if err != nil {
		t.Fatalf("CreateItem() error = %v", err)
	}
	if err := svc.DeleteItem(ctx, item.NoteID); err != nil {
		t.Fatalf("DeleteItem() error = %v", err)
	}

	expiredAt := time.Now().Add(-(RetentionHours + 4) * time.Hour).UnixMilli()
	if _, err := svc.store.db.Exec(`UPDATE notes_items SET deleted_at_unix_ms = ?, updated_at_unix_ms = ? WHERE note_id = ?`, expiredAt, expiredAt, item.NoteID); err != nil {
		t.Fatalf("aging trash item error = %v", err)
	}

	snap, err := svc.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() purge error = %v", err)
	}
	if len(snap.TrashItems) != 0 {
		t.Fatalf("purged trash count = %d, want 0", len(snap.TrashItems))
	}

	item, err = svc.CreateItem(ctx, CreateItemRequest{
		TopicID: topic.TopicID,
		Body:    "fresh trash",
		X:       48,
		Y:       60,
	})
	if err != nil {
		t.Fatalf("CreateItem() fresh error = %v", err)
	}
	if err := svc.DeleteItem(ctx, item.NoteID); err != nil {
		t.Fatalf("DeleteItem() fresh error = %v", err)
	}
	if err := svc.ClearTrashTopic(ctx, topic.TopicID); err != nil {
		t.Fatalf("ClearTrashTopic() error = %v", err)
	}

	snap, err = svc.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() after clear error = %v", err)
	}
	if len(snap.TrashItems) != 0 {
		t.Fatalf("trash after clear = %d, want 0", len(snap.TrashItems))
	}
}

func TestServiceSubscribeBaselineAndLiveEvents(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	svc := openTestService(t)
	topic, err := svc.CreateTopic(ctx, CreateTopicRequest{Name: "Realtime"})
	if err != nil {
		t.Fatalf("CreateTopic() error = %v", err)
	}

	baseline, ch, err := svc.Subscribe(ctx, 0)
	if err != nil {
		t.Fatalf("Subscribe() error = %v", err)
	}
	if len(baseline) != 1 {
		t.Fatalf("baseline len = %d, want 1", len(baseline))
	}
	if baseline[0].Type != "topic.created" {
		t.Fatalf("baseline event type = %q, want topic.created", baseline[0].Type)
	}

	item, err := svc.CreateItem(ctx, CreateItemRequest{
		TopicID: topic.TopicID,
		Body:    "live event",
		X:       10,
		Y:       20,
	})
	if err != nil {
		t.Fatalf("CreateItem() error = %v", err)
	}

	select {
	case event := <-ch:
		if event.Type != "item.created" {
			t.Fatalf("live event type = %q, want item.created", event.Type)
		}
		if event.EntityID != item.NoteID {
			t.Fatalf("live event entity = %q, want %q", event.EntityID, item.NoteID)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for live event")
	}
}

func TestServiceDeleteTrashedItemPermanentlyRemovesDeletedTopicAndBroadcasts(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	svc := openTestService(t)
	topic, err := svc.CreateTopic(ctx, CreateTopicRequest{Name: "Ephemeral"})
	if err != nil {
		t.Fatalf("CreateTopic() error = %v", err)
	}
	item, err := svc.CreateItem(ctx, CreateItemRequest{
		TopicID: topic.TopicID,
		Body:    "temporary note",
		X:       44,
		Y:       66,
	})
	if err != nil {
		t.Fatalf("CreateItem() error = %v", err)
	}
	if err := svc.DeleteTopic(ctx, topic.TopicID); err != nil {
		t.Fatalf("DeleteTopic() error = %v", err)
	}

	snap, err := svc.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() before subscribe error = %v", err)
	}
	baseline, ch, err := svc.Subscribe(ctx, snap.Seq)
	if err != nil {
		t.Fatalf("Subscribe() error = %v", err)
	}
	if len(baseline) != 0 {
		t.Fatalf("baseline len = %d, want 0", len(baseline))
	}

	if err := svc.DeleteTrashedItemPermanently(ctx, item.NoteID); err != nil {
		t.Fatalf("DeleteTrashedItemPermanently() error = %v", err)
	}

	select {
	case event := <-ch:
		if event.Type != "item.removed" {
			t.Fatalf("live event type = %q, want item.removed", event.Type)
		}
		if event.EntityID != item.NoteID {
			t.Fatalf("live event entity = %q, want %q", event.EntityID, item.NoteID)
		}
		if !strings.Contains(string(event.Payload), `"topic_removed":true`) {
			t.Fatalf("event payload = %s, want topic_removed=true", string(event.Payload))
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for removed event")
	}

	finalSnapshot, err := svc.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() after permanent delete error = %v", err)
	}
	if len(finalSnapshot.Topics) != 0 {
		t.Fatalf("final topics = %#v, want empty", finalSnapshot.Topics)
	}
	if len(finalSnapshot.Items) != 0 {
		t.Fatalf("final items = %#v, want empty", finalSnapshot.Items)
	}
	if len(finalSnapshot.TrashItems) != 0 {
		t.Fatalf("final trash = %#v, want empty", finalSnapshot.TrashItems)
	}
}
