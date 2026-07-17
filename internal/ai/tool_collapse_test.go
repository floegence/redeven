package ai

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSnapshotAssistantMessageJSONWithStatus_UsesStreamingStatus(t *testing.T) {
	t.Parallel()

	r := &run{
		id:                       "run_test",
		messageID:                "msg_snapshot_streaming",
		assistantCreatedAtUnixMs: 1700000000003,
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "still running"},
		},
	}

	msgJSON, _, _, err := r.snapshotAssistantMessageJSONWithStatus("streaming")
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSONWithStatus: %v", err)
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(msgJSON), &parsed); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	gotStatus, _ := parsed["status"].(string)
	if strings.TrimSpace(gotStatus) != "streaming" {
		t.Fatalf("status=%q, want streaming", gotStatus)
	}
}

func TestSnapshotAssistantMessageJSONWithStatus_RemainsFinalizationOnly(t *testing.T) {
	t.Parallel()

	r := &run{
		id:                       "run_test",
		messageID:                "msg_snapshot_persisted",
		assistantCreatedAtUnixMs: 1700000000004,
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "persisted already"},
		},
	}
	msgJSON, _, _, err := r.snapshotAssistantMessageJSONWithStatus("streaming")
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSONWithStatus: %v", err)
	}
	if !strings.Contains(msgJSON, "persisted already") {
		t.Fatalf("messageJSON=%q, want finalization snapshot content", msgJSON)
	}
}
