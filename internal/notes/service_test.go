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

func requireWelcomeSeed(t *testing.T, snapshot Snapshot) (Topic, Item) {
	t.Helper()

	var topic Topic
	foundTopic := false
	for _, candidate := range snapshot.Topics {
		if candidate.Name == welcomeTopicName {
			topic = candidate
			foundTopic = true
			break
		}
	}
	if !foundTopic {
		t.Fatalf("welcome topic missing from snapshot: %#v", snapshot.Topics)
	}

	var item Item
	foundItem := false
	for _, candidate := range snapshot.Items {
		if candidate.TopicID == topic.TopicID && strings.Contains(candidate.Body, "Welcome to Notes.") {
			item = candidate
			foundItem = true
			break
		}
	}
	if !foundItem {
		t.Fatalf("welcome item missing from snapshot: %#v", snapshot.Items)
	}
	return topic, item
}

func TestOpenSeedsWelcomeContentOnceAndDoesNotDuplicate(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "notes.db")

	svc, err := Open(path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}

	snap, err := svc.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() error = %v", err)
	}
	topic, item := requireWelcomeSeed(t, snap)
	if len(snap.Topics) != 1 {
		t.Fatalf("initial topics = %d, want 1", len(snap.Topics))
	}
	if len(snap.Items) != 1 {
		t.Fatalf("initial items = %d, want 1", len(snap.Items))
	}
	if topic.SortOrder != 0 {
		t.Fatalf("welcome sort_order = %d, want 0", topic.SortOrder)
	}
	if item.ColorToken != welcomeNoteColor {
		t.Fatalf("welcome color = %q, want %q", item.ColorToken, welcomeNoteColor)
	}
	if item.X != welcomeNoteX || item.Y != welcomeNoteY {
		t.Fatalf("welcome coordinates = (%v, %v), want (%v, %v)", item.X, item.Y, welcomeNoteX, welcomeNoteY)
	}

	baseline, _, err := svc.Subscribe(ctx, 0)
	if err != nil {
		t.Fatalf("Subscribe() error = %v", err)
	}
	if len(baseline) != 2 {
		t.Fatalf("baseline len = %d, want 2", len(baseline))
	}
	if baseline[0].Type != "topic.created" || baseline[1].Type != "item.created" {
		t.Fatalf("baseline types = [%q, %q], want topic.created/item.created", baseline[0].Type, baseline[1].Type)
	}

	if err := svc.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatalf("Open() reopen error = %v", err)
	}
	defer func() {
		if err := reopened.Close(); err != nil {
			t.Fatalf("Close() reopen error = %v", err)
		}
	}()

	reopenedSnap, err := reopened.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() reopen error = %v", err)
	}
	requireWelcomeSeed(t, reopenedSnap)
	if len(reopenedSnap.Topics) != 1 {
		t.Fatalf("reopened topics = %d, want 1", len(reopenedSnap.Topics))
	}
	if len(reopenedSnap.Items) != 1 {
		t.Fatalf("reopened items = %d, want 1", len(reopenedSnap.Items))
	}
}

func TestOpenDoesNotReseedAfterWelcomeContentIsFullyRemoved(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "notes.db")

	svc, err := Open(path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}

	snap, err := svc.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() error = %v", err)
	}
	welcomeTopic, welcomeItem := requireWelcomeSeed(t, snap)
	if err := svc.DeleteTopic(ctx, welcomeTopic.TopicID); err != nil {
		t.Fatalf("DeleteTopic() error = %v", err)
	}
	if err := svc.DeleteTrashedItemPermanently(ctx, welcomeItem.NoteID); err != nil {
		t.Fatalf("DeleteTrashedItemPermanently() error = %v", err)
	}

	emptySnap, err := svc.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() after delete error = %v", err)
	}
	if len(emptySnap.Topics) != 0 || len(emptySnap.Items) != 0 || len(emptySnap.TrashItems) != 0 {
		t.Fatalf("snapshot after removing welcome = %#v, want empty", emptySnap)
	}

	if err := svc.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatalf("Open() reopen error = %v", err)
	}
	defer func() {
		if err := reopened.Close(); err != nil {
			t.Fatalf("Close() reopen error = %v", err)
		}
	}()

	reopenedSnap, err := reopened.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() reopen error = %v", err)
	}
	if len(reopenedSnap.Topics) != 0 || len(reopenedSnap.Items) != 0 || len(reopenedSnap.TrashItems) != 0 {
		t.Fatalf("reopened snapshot = %#v, want empty", reopenedSnap)
	}
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
	if len(deleted.Topics) != 1 {
		t.Fatalf("deleted snapshot topics = %d, want 1", len(deleted.Topics))
	}
	if len(deleted.Items) != 1 {
		t.Fatalf("deleted snapshot items = %d, want 1", len(deleted.Items))
	}
	if len(deleted.TrashItems) != 1 {
		t.Fatalf("deleted snapshot trash = %d, want 1", len(deleted.TrashItems))
	}
	requireWelcomeSeed(t, deleted)

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
	if len(finalSnapshot.Topics) != 2 {
		t.Fatalf("final topics = %d, want 2", len(finalSnapshot.Topics))
	}
	if len(finalSnapshot.Items) != 2 {
		t.Fatalf("final items = %d, want 2", len(finalSnapshot.Items))
	}
	if len(finalSnapshot.TrashItems) != 0 {
		t.Fatalf("final trash = %d, want 0", len(finalSnapshot.TrashItems))
	}
	requireWelcomeSeed(t, finalSnapshot)
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
	if len(baseline) != 3 {
		t.Fatalf("baseline len = %d, want 3", len(baseline))
	}
	if baseline[0].Type != "topic.created" || baseline[1].Type != "item.created" || baseline[2].Type != "topic.created" {
		t.Fatalf("baseline types = [%q, %q, %q], want topic.created/item.created/topic.created", baseline[0].Type, baseline[1].Type, baseline[2].Type)
	}
	if baseline[2].EntityID != topic.TopicID {
		t.Fatalf("realtime topic event entity = %q, want %q", baseline[2].EntityID, topic.TopicID)
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
	if len(finalSnapshot.Topics) != 1 {
		t.Fatalf("final topics = %#v, want welcome only", finalSnapshot.Topics)
	}
	if len(finalSnapshot.Items) != 1 {
		t.Fatalf("final items = %#v, want welcome only", finalSnapshot.Items)
	}
	if len(finalSnapshot.TrashItems) != 0 {
		t.Fatalf("final trash = %#v, want empty", finalSnapshot.TrashItems)
	}
	requireWelcomeSeed(t, finalSnapshot)
}
