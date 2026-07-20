package ai

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"strings"
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
	accepted, err := svc.reconcilePendingTurnCommand(ctx, meta.EndpointID, thread.ThreadID, command.QueueID, command.TurnID, nil)
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
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "accepted")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: flruntime.TurnID(command.TurnID), RunID: flruntime.RunID(command.RunID), Input: flruntime.TurnInput{Text: command.TextContent}}); err != nil {
		t.Fatal(err)
	}
	accepted, err := svc.reconcilePendingTurnCommand(ctx, meta.EndpointID, thread.ThreadID, command.QueueID, command.TurnID, nil)
	if err != nil || !accepted {
		t.Fatalf("reconcile accepted=%v err=%v", accepted, err)
	}
	if stored, err := svc.threadsDB.GetQueuedTurn(ctx, meta.EndpointID, thread.ThreadID, command.QueueID); !errors.Is(err, sql.ErrNoRows) || stored != nil {
		t.Fatalf("accepted prompt still stored: %#v err=%v", stored, err)
	}
	accepted, err = svc.reconcilePendingTurnCommand(ctx, meta.EndpointID, thread.ThreadID, command.QueueID, command.TurnID, nil)
	if err == nil || accepted || !strings.Contains(err.Error(), "missing during admission settlement") {
		t.Fatalf("second reconcile accepted=%v err=%v, want missing command failure", accepted, err)
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
	floretRuntime, err := svc.bindFloretThreadRuntime(thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	r := newRunWithProductStoreForTest(t, runOptions{
		Log: svc.log, HostCapabilities: bindTestRunHostCapabilities(t, svc, meta.EndpointID, thread.ThreadID), RunID: command.RunID, EndpointID: meta.EndpointID,
		ThreadID: thread.ThreadID, MessageID: command.TurnID,
		FloretHostFactory: floretRuntime.Turn, PersistOpTimeout: time.Second,
	}, svc.threadsDB)
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
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "other")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: "turn_other", RunID: "run_other", Input: flruntime.TurnInput{Text: command.TextContent}}); err != nil {
		t.Fatal(err)
	}
	accepted, err := svc.reconcilePendingTurnCommand(ctx, meta.EndpointID, thread.ThreadID, command.QueueID, command.TurnID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if accepted {
		t.Fatal("different canonical turn consumed pending command")
	}
}

func TestRunEndReleasesUnadmittedPendingCommandByCancelIntent(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		id         string
		cancel     bool
		targetLane string
	}{
		{name: "retryable failure", id: "retry", targetLane: threadstore.FollowupLaneQueued},
		{name: "user cancellation", id: "cancel", cancel: true, targetLane: threadstore.FollowupLaneDraft},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			svc := newSendTurnTestService(t)
			meta := testSendTurnMeta()
			ctx := context.Background()
			thread, err := svc.CreateThread(ctx, meta, "release unadmitted", "", "", "")
			if err != nil {
				t.Fatal(err)
			}
			command := createPendingCommandForTest(t, svc, meta, thread.ThreadID, "command_release_"+testCase.id, "turn_release_"+testCase.id, "run_release_"+testCase.id)
			floretRuntime, err := svc.bindFloretThreadRuntime(thread.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			r := newRunWithProductStoreForTest(t, runOptions{
				HostCapabilities: bindTestRunHostCapabilities(t, svc, meta.EndpointID, thread.ThreadID), RunID: command.RunID, EndpointID: meta.EndpointID,
				ThreadID: thread.ThreadID, MessageID: command.TurnID,
				FloretHostFactory: floretRuntime.Turn, PersistOpTimeout: time.Second,
			}, svc.threadsDB)
			r.setPendingTurnCommand(command.QueueID)
			if testCase.cancel {
				r.requestCancel("canceled")
			}
			r.reconcilePendingTurnCommand()
			items, err := svc.threadsDB.ListFollowupsByLane(ctx, meta.EndpointID, thread.ThreadID, testCase.targetLane, 10)
			if err != nil {
				t.Fatal(err)
			}
			if len(items) != 1 || items[0].QueueID != command.QueueID || items[0].AdmissionState != threadstore.PendingTurnAdmissionReady {
				t.Fatalf("released items=%#v", items)
			}
		})
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
	if err := svc.threadsDB.BeginPendingTurnAdmission(context.Background(), meta.EndpointID, threadID, record.QueueID, record.TurnID, record.RunID); err != nil {
		t.Fatal(err)
	}
	return record
}
