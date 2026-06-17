package ai

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
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

func TestPrepareRun_InitializesLiveAssistantDraftImmediately(t *testing.T) {
	t.Parallel()

	svc := newRealtimeTestService(t, 2*time.Second)
	ctx := context.Background()
	meta := &session.Meta{
		EndpointID:        "env_prepare_live_draft",
		NamespacePublicID: "ns_prepare_live_draft",
		ChannelID:         "ch_prepare_live_draft",
		UserPublicID:      "user_prepare_live_draft",
		UserEmail:         "prepare@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	thread, err := svc.CreateThread(ctx, meta, "prepare live draft", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_prepare_immediate_live_draft"
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

	bootstrap, err := svc.GetFlowerThreadLiveBootstrap(ctx, meta, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadLiveBootstrap: %v", err)
	}
	if bootstrap == nil {
		t.Fatalf("bootstrap missing")
	}
	if bootstrap.Cursor <= 0 {
		t.Fatalf("cursor=%d, want > 0", bootstrap.Cursor)
	}
	runState := bootstrap.LiveState.Runs[runID]
	if strings.TrimSpace(runState.RunID) != runID {
		t.Fatalf("runID=%q, want %q", runState.RunID, runID)
	}
	if strings.TrimSpace(runState.MessageID) != strings.TrimSpace(prepared.messageID) {
		t.Fatalf("run messageID=%q, want %q", runState.MessageID, prepared.messageID)
	}
	msg := bootstrap.LiveState.Messages[prepared.messageID]
	if strings.TrimSpace(msg.MessageID) != strings.TrimSpace(prepared.messageID) {
		t.Fatalf("assistant message id=%q, want %q", msg.MessageID, prepared.messageID)
	}
	if strings.TrimSpace(msg.Role) != "assistant" {
		t.Fatalf("role=%q, want assistant", msg.Role)
	}
	if strings.TrimSpace(msg.Status) != "streaming" {
		t.Fatalf("status=%q, want streaming", msg.Status)
	}
	if msg.CreatedAtMs <= 0 {
		t.Fatalf("created_at_ms=%d, want > 0", msg.CreatedAtMs)
	}
	if len(msg.Blocks) != 1 {
		t.Fatalf("block count=%d, want 1", len(msg.Blocks))
	}
	if strings.TrimSpace(msg.Blocks[0].Type) != "markdown" {
		t.Fatalf("block type=%q, want markdown", msg.Blocks[0].Type)
	}
	if msg.Blocks[0].Content != "" {
		t.Fatalf("block content=%q, want empty string", msg.Blocks[0].Content)
	}
}

func TestPrepareRun_PropagatesInternalReadonlyRunOptions(t *testing.T) {
	t.Parallel()

	svc := newRealtimeTestService(t, 0)
	ctx := context.Background()
	meta := &session.Meta{
		EndpointID:        "env_prepare_options",
		NamespacePublicID: "ns_prepare_options",
		ChannelID:         "ch_prepare_options",
		UserPublicID:      "user_prepare_options",
		UserEmail:         "prepare-options@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	thread, err := svc.CreateThread(ctx, meta, "prepare options", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_prepare_internal_options"
	prepared, err := svc.prepareRun(meta, runID, RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hello"},
		Options: RunOptions{
			MaxSteps:          1,
			ToolAllowlist:     []string{"terminal.exec", "task_complete"},
			ForceReadonlyExec: true,
		},
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

	if !prepared.r.forceReadonlyExec {
		t.Fatalf("forceReadonlyExec=false, want true")
	}
	if len(prepared.r.toolAllowlist) != 2 {
		t.Fatalf("toolAllowlist size=%d, want 2", len(prepared.r.toolAllowlist))
	}
	if _, ok := prepared.r.toolAllowlist["terminal.exec"]; !ok {
		t.Fatalf("toolAllowlist missing terminal.exec")
	}
	if _, ok := prepared.r.toolAllowlist["task_complete"]; !ok {
		t.Fatalf("toolAllowlist missing task_complete")
	}
}

func TestPrepareRun_ContextActionSuggestedWorkingDirDoesNotChangeRunWorkingDir(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	ctx := context.Background()
	meta := testSendTurnMeta()

	threadWorkingDir := t.TempDir()
	suggestedWorkingDir := t.TempDir()
	thread, err := svc.CreateThread(ctx, meta, "prepare context action authority", "openai/gpt-5-mini", "", threadWorkingDir)
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_prepare_context_action_authority"
	prepared, err := svc.prepareRun(meta, runID, RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			Text: "inspect env",
			ContextAction: &ContextActionEnvelope{
				SchemaVersion:       ContextActionSchemaVersion,
				ActionID:            "assistant.ask.flower",
				Provider:            "flower",
				Target:              ContextActionTarget{TargetID: "current", Locality: "auto"},
				Source:              ContextActionSource{Surface: "file_browser"},
				Context:             []ContextActionContextItem{{Kind: "file_path", Path: suggestedWorkingDir, IsDirectory: true}},
				Presentation:        ContextActionPresentation{Label: "Ask Flower", Priority: 100},
				SuggestedWorkingDir: suggestedWorkingDir,
			},
		},
		Options: RunOptions{MaxSteps: 1},
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

	threadWorkingDirEval, err := filepath.EvalSymlinks(threadWorkingDir)
	if err != nil {
		t.Fatalf("EvalSymlinks(threadWorkingDir): %v", err)
	}
	if prepared.r.workingDir != threadWorkingDirEval {
		t.Fatalf("run workingDir=%q, want thread working dir %q", prepared.r.workingDir, threadWorkingDirEval)
	}
	if prepared.r.workingDir == suggestedWorkingDir {
		t.Fatalf("context action suggested working dir must not become runtime authority: %q", suggestedWorkingDir)
	}
}
