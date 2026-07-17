package ai

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func newSendTurnTestService(t *testing.T) *Service {
	t.Helper()
	cfg := &config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []config.AIProvider{{
			ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: "https://api.openai.com/v1",
			Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}, {ModelName: "gpt-4o-mini"}},
		}},
	}
	svc, err := NewService(Options{
		Logger:   slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelDebug})),
		StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/bash", Config: cfg,
		PersistOpTimeout: 2 * time.Second, RunMaxWallTime: 2 * time.Second, RunIdleTimeout: time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "", false, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func testSendTurnMeta() *session.Meta {
	return &session.Meta{
		ChannelID: "ch_send_turn_test", EndpointID: "env_send_turn_test", NamespacePublicID: "ns_send_turn_test",
		UserPublicID: "u_send_turn_test", UserEmail: "u_send_turn_test@example.com",
		CanRead: true, CanWrite: true, CanExecute: true,
	}
}

func TestPendingTurnCommandRemainsBeforeFloretAcceptance(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "pending", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	command := createPendingCommandForTest(t, svc, meta, thread.ThreadID, "command_1", "turn_1", "run_1")
	accepted, err := svc.reconcilePendingTurnCommand(ctx, meta.EndpointID, thread.ThreadID, command.QueueID, command.TurnID)
	if err != nil {
		t.Fatal(err)
	}
	if accepted {
		t.Fatal("unadmitted command was treated as accepted")
	}
	stored, err := svc.threadsDB.GetQueuedTurn(ctx, meta.EndpointID, thread.ThreadID, command.QueueID)
	if err != nil || stored == nil || stored.TextContent != "pending prompt" {
		t.Fatalf("pending prompt was not retained: %#v err=%v", stored, err)
	}
}

func TestPendingTurnCommandIsDeletedAfterCanonicalAcceptance(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "accepted", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	command := createPendingCommandForTest(t, svc, meta, thread.ThreadID, "command_1", "turn_1", "run_1")
	host := newTestFloretHost(t, svc.floretStore, "accepted")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: flruntime.TurnID(command.TurnID), RunID: flruntime.RunID(command.RunID), Input: command.TextContent}); err != nil {
		t.Fatal(err)
	}
	accepted, err := svc.reconcilePendingTurnCommand(ctx, meta.EndpointID, thread.ThreadID, command.QueueID, command.TurnID)
	if err != nil || !accepted {
		t.Fatalf("reconcile accepted=%v err=%v", accepted, err)
	}
	if stored, err := svc.threadsDB.GetQueuedTurn(ctx, meta.EndpointID, thread.ThreadID, command.QueueID); !errors.Is(err, sql.ErrNoRows) || stored != nil {
		t.Fatalf("accepted prompt still stored: %#v err=%v", stored, err)
	}
	accepted, err = svc.reconcilePendingTurnCommand(ctx, meta.EndpointID, thread.ThreadID, command.QueueID, command.TurnID)
	if err != nil || !accepted {
		t.Fatalf("idempotent reconcile accepted=%v err=%v", accepted, err)
	}
}

func TestPendingTurnCommandIsDeletedOnCanonicalUserEntryEvent(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "committed event", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	command := createPendingCommandForTest(t, svc, meta, thread.ThreadID, "command_event", "turn_event", "run_event")
	r := newRun(runOptions{
		Log: svc.log, Service: svc, RunID: command.RunID, EndpointID: meta.EndpointID,
		ThreadID: thread.ThreadID, MessageID: command.TurnID, ThreadsDB: svc.threadsDB,
		FloretStore: svc.floretStore, PersistOpTimeout: time.Second,
	})
	r.setPendingTurnCommand(command.QueueID)
	r.expectFloretRuntimeEventIdentity(command.RunID, thread.ThreadID, command.TurnID, true)
	floretEventSink{run: r}.EmitEvent(flruntime.Event{
		Type: observation.EventTypeThreadEntryCommitted, RunID: flruntime.RunID(command.RunID),
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: flruntime.TurnID(command.TurnID),
		Committed: &flruntime.ThreadDetailEvent{
			ID: "entry_event", ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: flruntime.TurnID(command.TurnID),
			RunID: flruntime.RunID(command.RunID), Kind: flruntime.ThreadDetailEventUserMessage,
		},
	})
	if stored, err := svc.threadsDB.GetQueuedTurn(ctx, meta.EndpointID, thread.ThreadID, command.QueueID); !errors.Is(err, sql.ErrNoRows) || stored != nil {
		t.Fatalf("committed user entry left pending prompt stored: %#v err=%v", stored, err)
	}
}

func TestPendingTurnReconciliationMatchesExactTurnID(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "exact identity", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	command := createPendingCommandForTest(t, svc, meta, thread.ThreadID, "command_2", "turn_expected", "run_expected")
	host := newTestFloretHost(t, svc.floretStore, "other")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_other", RunID: "run_other", Input: command.TextContent}); err != nil {
		t.Fatal(err)
	}
	accepted, err := svc.reconcilePendingTurnCommand(ctx, meta.EndpointID, thread.ThreadID, command.QueueID, command.TurnID)
	if err != nil {
		t.Fatal(err)
	}
	if accepted {
		t.Fatal("different canonical turn consumed pending command")
	}
}

func createPendingCommandForTest(t *testing.T, svc *Service, meta *session.Meta, threadID, commandID, turnID, runID string) threadstore.QueuedTurn {
	t.Helper()
	record, _, _, err := svc.threadsDB.CreateFollowup(context.Background(), threadstore.QueuedTurn{
		QueueID: commandID, EndpointID: meta.EndpointID, ThreadID: threadID, ChannelID: meta.ChannelID,
		Lane: threadstore.FollowupLaneQueued, TurnID: turnID, RunID: runID, ModelID: "openai/gpt-5-mini",
		TextContent: "pending prompt", AttachmentsJSON: "[]", OptionsJSON: "{}", SessionMetaJSON: "{}",
		CreatedByUserPublicID: meta.UserPublicID, CreatedByUserEmail: meta.UserEmail,
	})
	if err != nil {
		t.Fatal(err)
	}
	return record
}
