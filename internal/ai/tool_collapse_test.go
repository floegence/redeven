package ai

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/redeven-agent/internal/session"
)

func TestGetActiveRunSnapshot_UsesStreamingStatus(t *testing.T) {
	t.Parallel()

	r := &run{
		messageID:                "msg_snapshot_streaming",
		assistantCreatedAtUnixMs: 1700000000003,
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "still running"},
		},
	}
	svc := &Service{
		activeRunByTh: map[string]string{
			runThreadKey("env_test", "th_test"): "run_test",
		},
		runs: map[string]*run{
			"run_test": r,
		},
	}
	meta := &session.Meta{
		EndpointID: "env_test",
		CanRead:    true,
	}

	runID, rawJSON, err := svc.GetActiveRunSnapshot(meta, "th_test")
	if err != nil {
		t.Fatalf("GetActiveRunSnapshot: %v", err)
	}
	if strings.TrimSpace(runID) != "run_test" {
		t.Fatalf("runID=%q, want run_test", runID)
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(rawJSON), &parsed); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	gotStatus, _ := parsed["status"].(string)
	if strings.TrimSpace(gotStatus) != "streaming" {
		t.Fatalf("status=%q, want streaming", gotStatus)
	}
}
