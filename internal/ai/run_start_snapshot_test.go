package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/session"
)

func TestEnsureAssistantMessageStarted_IsIdempotent(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := &run{
		messageID: "msg_started_once",
		onStreamEvent: func(ev any) {
			events = append(events, ev)
		},
	}

	if !r.ensureAssistantMessageStarted() {
		t.Fatalf("first ensureAssistantMessageStarted() should initialize the assistant message")
	}
	if r.ensureAssistantMessageStarted() {
		t.Fatalf("second ensureAssistantMessageStarted() should be a no-op")
	}

	if got := len(r.assistantBlocks); got != 1 {
		t.Fatalf("assistant block count=%d, want 1", got)
	}
	if r.nextBlockIndex != 1 {
		t.Fatalf("nextBlockIndex=%d, want 1", r.nextBlockIndex)
	}
	if r.currentTextBlockIndex != 0 {
		t.Fatalf("currentTextBlockIndex=%d, want 0", r.currentTextBlockIndex)
	}
	if r.needNewTextBlock {
		t.Fatal("needNewTextBlock should be false after initialization")
	}
	if len(events) != 2 {
		t.Fatalf("event count=%d, want 2", len(events))
	}
	if _, ok := events[0].(streamEventMessageStart); !ok {
		t.Fatalf("events[0]=%T, want streamEventMessageStart", events[0])
	}
	if _, ok := events[1].(streamEventBlockStart); !ok {
		t.Fatalf("events[1]=%T, want streamEventBlockStart", events[1])
	}
}

func TestPrepareRun_InitializesActiveRunSnapshotImmediately(t *testing.T) {
	t.Parallel()

	svc := newRealtimeTestService(t, 2*time.Second)
	ctx := context.Background()
	meta := &session.Meta{
		EndpointID:        "env_prepare_snapshot",
		NamespacePublicID: "ns_prepare_snapshot",
		ChannelID:         "ch_prepare_snapshot",
		UserPublicID:      "user_prepare_snapshot",
		UserEmail:         "prepare@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	thread, err := svc.CreateThread(ctx, meta, "prepare snapshot", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_prepare_immediate_snapshot"
	prepared, err := svc.prepareRun(meta, runID, RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hello"},
		Options:  RunOptions{MaxSteps: 1},
	}, nil, nil)
	if err != nil {
		t.Fatalf("prepareRun: %v", err)
	}
	t.Cleanup(func() {
		svc.mu.Lock()
		delete(svc.runs, runID)
		delete(svc.activeRunByTh, runThreadKey(meta.EndpointID, thread.ThreadID))
		svc.mu.Unlock()
		prepared.r.markDone()
	})

	gotRunID, rawJSON, err := svc.GetActiveRunSnapshot(meta, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetActiveRunSnapshot: %v", err)
	}
	if strings.TrimSpace(gotRunID) != runID {
		t.Fatalf("runID=%q, want %q", gotRunID, runID)
	}

	var parsed struct {
		ID        string `json:"id"`
		Role      string `json:"role"`
		Status    string `json:"status"`
		Timestamp int64  `json:"timestamp"`
		Blocks    []struct {
			Type    string `json:"type"`
			Content string `json:"content"`
		} `json:"blocks"`
	}
	if err := json.Unmarshal([]byte(rawJSON), &parsed); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}

	if strings.TrimSpace(parsed.ID) != strings.TrimSpace(prepared.messageID) {
		t.Fatalf("assistant message id=%q, want %q", parsed.ID, prepared.messageID)
	}
	if strings.TrimSpace(parsed.Role) != "assistant" {
		t.Fatalf("role=%q, want assistant", parsed.Role)
	}
	if strings.TrimSpace(parsed.Status) != "streaming" {
		t.Fatalf("status=%q, want streaming", parsed.Status)
	}
	if parsed.Timestamp <= 0 {
		t.Fatalf("timestamp=%d, want > 0", parsed.Timestamp)
	}
	if len(parsed.Blocks) != 1 {
		t.Fatalf("block count=%d, want 1", len(parsed.Blocks))
	}
	if strings.TrimSpace(parsed.Blocks[0].Type) != "markdown" {
		t.Fatalf("block type=%q, want markdown", parsed.Blocks[0].Type)
	}
	if parsed.Blocks[0].Content != "" {
		t.Fatalf("block content=%q, want empty string", parsed.Blocks[0].Content)
	}
}
