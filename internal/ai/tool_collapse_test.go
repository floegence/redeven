package ai

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestActiveRunMessageSnapshot_UsesStreamingStatus(t *testing.T) {
	t.Parallel()

	r := &run{
		id:                       "run_test",
		messageID:                "msg_snapshot_streaming",
		assistantCreatedAtUnixMs: 1700000000003,
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "still running"},
		},
	}

	snapshot := r.activeRunMessageSnapshot()

	var parsed map[string]any
	if err := json.Unmarshal(snapshot.MessageJSON, &parsed); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	gotStatus, _ := parsed["status"].(string)
	if strings.TrimSpace(gotStatus) != "streaming" {
		t.Fatalf("status=%q, want streaming", gotStatus)
	}
}

func TestActiveRunMessageSnapshot_SuppressesSnapshotsAfterAssistantPersisted(t *testing.T) {
	t.Parallel()

	r := &run{
		id:                       "run_test",
		messageID:                "msg_snapshot_persisted",
		assistantCreatedAtUnixMs: 1700000000004,
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "persisted already"},
		},
	}
	r.markAssistantPersisted()

	snapshot := r.activeRunMessageSnapshot()
	if len(snapshot.MessageJSON) != 0 {
		t.Fatalf("messageJSON=%q, want empty", string(snapshot.MessageJSON))
	}
}
