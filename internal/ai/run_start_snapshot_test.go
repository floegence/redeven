package ai

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
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

func TestPrepareRunDoesNotPublishDraftBeforeFloretAcceptance(t *testing.T) {
	svc := newRealtimeTestService(t, 2*time.Second)
	ctx := context.Background()
	meta := &session.Meta{EndpointID: "env_prepare_draft", NamespacePublicID: "ns", ChannelID: "ch", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := svc.CreateThread(ctx, meta, "prepare", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := svc.prepareRun(meta, "run_prepare", RunStartRequest{ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "hello"}}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		svc.mu.Lock()
		delete(svc.runs, "run_prepare")
		delete(svc.activeRunByTh, runThreadKey(meta.EndpointID, thread.ThreadID))
		svc.mu.Unlock()
		prepared.r.markDone()
	})
	bootstrap, err := svc.GetFlowerThreadLiveBootstrap(ctx, meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if len(bootstrap.TimelineMessages) != 0 {
		t.Fatalf("pre-accept draft entered canonical timeline: %#v", bootstrap.TimelineMessages)
	}
}

func TestStartUserTurnDetachedDoesNotPublishDraftBeforeFloretAcceptance(t *testing.T) {
	svc := newSendTurnTestService(t)
	ctx := context.Background()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(ctx, meta, "admission boundary", "", "", "")
	if err != nil {
		t.Fatal(err)
	}

	_, _, err = svc.startUserTurnDetached(ctx, meta, "run_before_floret_acceptance", RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "missing/provider",
		Input:    RunInput{Text: "provider resolution fails before Floret admission"},
	}, "")
	if err != nil {
		t.Fatalf("startUserTurnDetached: %v", err)
	}

	bootstrap, err := svc.GetFlowerThreadLiveBootstrap(ctx, meta, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadLiveBootstrap: %v", err)
	}
	if len(bootstrap.TimelineMessages) != 0 {
		t.Fatalf("pre-admission draft entered canonical timeline: %#v", bootstrap.TimelineMessages)
	}
	if len(bootstrap.LiveState.Messages) != 0 {
		t.Fatalf("pre-admission draft entered live state: %#v", bootstrap.LiveState.Messages)
	}
	commands, err := svc.threadsDB.ListFollowupsByLane(ctx, meta.EndpointID, thread.ThreadID, threadstore.FollowupLaneQueued, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(commands) != 1 || commands[0].AdmissionState != threadstore.PendingTurnAdmissionInFlight {
		t.Fatalf("pre-admission command=%#v, want durable in-flight state", commands)
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
			ToolAllowlist: []string{"terminal.exec", "task_complete"},
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
		Options: RunOptions{},
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
