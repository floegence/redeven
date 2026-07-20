package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/config"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func newSendTurnTestService(t *testing.T) *Service {
	t.Helper()
	return newSendTurnTestServiceAt(t, t.TempDir(), t.TempDir())
}

func newSendTurnTestServiceAt(t *testing.T, stateDir string, agentHomeDir string) *Service {
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
		StateDir: stateDir, AgentHomeDir: agentHomeDir, Shell: "/bin/bash", Config: cfg,
		PersistOpTimeout: 2 * time.Second, RunMaxWallTime: 2 * time.Second, RunIdleTimeout: time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "", false, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func TestRunInputRejectsLegacyMessageIdentityField(t *testing.T) {
	t.Parallel()

	var input RunInput
	err := json.Unmarshal([]byte(`{"message_id":"legacy_message","text":"must fail","attachments":[]}`), &input)
	if err == nil || !strings.Contains(err.Error(), `unknown field "message_id"`) {
		t.Fatalf("json.Unmarshal error=%v, want rejected legacy message_id", err)
	}
}

func TestSendUserTurnRejectsInvalidExplicitTurnIDWithoutAdmissionSideEffects(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "invalid turn identity", "", "", "")
	if err != nil {
		t.Fatal(err)
	}

	_, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Input:    RunInput{TurnID: "invalid turn id", Text: "must not be admitted"},
	})
	if err == nil || !strings.Contains(err.Error(), "invalid turn_id") {
		t.Fatalf("SendUserTurn error=%v, want invalid turn_id", err)
	}
	queued, err := svc.threadsDB.CountFollowupsByLane(ctx, meta.EndpointID, thread.ThreadID, threadstore.FollowupLaneQueued)
	if err != nil {
		t.Fatal(err)
	}
	if queued != 0 {
		t.Fatalf("queued turns=%d, want 0", queued)
	}
	turnIDs, err := svc.readCanonicalThreadTurnIDs(ctx, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if len(turnIDs) != 0 {
		t.Fatalf("canonical turns=%v, want none", turnIDs)
	}
	if svc.HasActiveThreadForEndpoint(meta.EndpointID, thread.ThreadID) {
		t.Fatal("invalid turn registered an active run")
	}
}

func TestAdmissionRPCDecodersRejectLegacyAndInvalidTurnIdentityWithoutSideEffects(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "rpc decoder boundary", "", "", "")
	if err != nil {
		t.Fatal(err)
	}

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() { _ = serverConn.Close() })
	t.Cleanup(func() { _ = clientConn.Close() })
	router := rpc.NewRouter()
	svc.RegisterRPC(router, meta, nil)
	server := rpc.NewServer(serverConn, router)
	serveCtx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go func() { _ = server.Serve(serveCtx) }()
	client := rpc.NewClient(clientConn)

	callInvalid := func(typeID uint32, payload string) {
		t.Helper()
		_, rpcErr, err := client.Call(ctx, typeID, []byte(payload))
		if err != nil {
			t.Fatalf("Call type_id=%d: %v", typeID, err)
		}
		if rpcErr == nil || rpcErr.Code != 400 {
			t.Fatalf("Call type_id=%d rpc error=%#v, want code 400", typeID, rpcErr)
		}
	}
	assertState := func(wantCanonicalTurns int) {
		t.Helper()
		queued, err := svc.threadsDB.CountFollowupsByLane(ctx, meta.EndpointID, thread.ThreadID, threadstore.FollowupLaneQueued)
		if err != nil {
			t.Fatal(err)
		}
		turns, err := svc.readCanonicalThreadTurnIDs(ctx, thread.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		if queued != 0 || len(turns) != wantCanonicalTurns || svc.HasActiveThreadForEndpoint(meta.EndpointID, thread.ThreadID) {
			t.Fatalf("admission side effects: queued=%d canonical=%v active=%v", queued, turns, svc.HasActiveThreadForEndpoint(meta.EndpointID, thread.ThreadID))
		}
	}

	callInvalid(TypeID_AI_SEND_USER_TURN, `{"thread_id":"`+thread.ThreadID+`","input":{"message_id":"legacy","text":"must fail","attachments":[]},"options":{}}`)
	callInvalid(TypeID_AI_SEND_USER_TURN, `{"thread_id":"`+thread.ThreadID+`","input":{"turn_id":"invalid turn id","text":"must fail","attachments":[]},"options":{}}`)
	assertState(0)

	prompt := testSingleQuestionPrompt("turn_rpc_waiting", "tool_rpc_waiting", "question_1", "Continue?", nil)
	seedWaitingUserPrompt(t, svc, ctx, meta, thread.ThreadID, prompt)
	response := `"response":{"prompt_id":"` + prompt.PromptID + `","answers":{"question_1":{"text":"continue"}}}`
	callInvalid(TypeID_AI_SUBMIT_REQUEST_USER_INPUT_RESPONSE, `{"thread_id":"`+thread.ThreadID+`",`+response+`,"input":{"message_id":"legacy","text":"continue","attachments":[]},"options":{}}`)
	callInvalid(TypeID_AI_SUBMIT_REQUEST_USER_INPUT_RESPONSE, `{"thread_id":"`+thread.ThreadID+`",`+response+`,"input":{"turn_id":"invalid turn id","text":"continue","attachments":[]},"options":{}}`)
	assertState(1)
}

func TestSendUserTurnReturnsAcceptedTurnAndRunIdentity(t *testing.T) {
	svc := newRealtimeTestService(t, 2*time.Second)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "turn receipt", "", "", "")
	if err != nil {
		t.Fatal(err)
	}

	response, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Input:    RunInput{TurnID: "turn_client_receipt", Text: "start"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.Kind != "start" || response.TurnID != "turn_client_receipt" || strings.TrimSpace(response.RunID) == "" {
		t.Fatalf("response=%#v, want exact start receipt", response)
	}
	bootstrap, err := svc.GetFlowerThreadLiveBootstrap(ctx, meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	canonicalUserIndex := -1
	for index, message := range bootstrap.TimelineMessages {
		if message.Role == "user" && message.TurnID == response.TurnID && message.RunID == response.RunID && message.MessageID != response.TurnID {
			canonicalUserIndex = index
			break
		}
	}
	if canonicalUserIndex < 0 {
		t.Fatalf("start receipt returned before canonical user timeline: %#v", bootstrap.TimelineMessages)
	}
	events, err := svc.ListFlowerThreadLiveEvents(ctx, meta, thread.ThreadID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	replacementIndex := -1
	assistantIndex := -1
	for index, event := range events.Events {
		if event.Kind == FlowerLiveTimelineReplaced && replacementIndex < 0 {
			replacementIndex = index
		}
		if event.Kind == FlowerLiveMessageStarted && assistantIndex < 0 {
			assistantIndex = index
		}
	}
	if replacementIndex < 0 || (assistantIndex >= 0 && replacementIndex >= assistantIndex) {
		t.Fatalf("live event order replacement=%d assistant=%d events=%#v", replacementIndex, assistantIndex, events.Events)
	}
	queued, err := svc.threadsDB.CountFollowupsByLane(ctx, meta.EndpointID, thread.ThreadID, threadstore.FollowupLaneQueued)
	if err != nil || queued != 0 {
		t.Fatalf("admitted command remains queued: count=%d err=%v", queued, err)
	}
}

func TestQueuedSecondTurnTransitionsFromServerSnapshotToCanonicalFloretRow(t *testing.T) {
	svc := newRealtimeTestService(t, 50*time.Millisecond)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "queued admission handoff", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	first, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{TurnID: "turn_queued_handoff_first", Text: "run long enough to queue the next turn"},
	})
	if err != nil || first.Kind != "start" {
		t.Fatalf("first turn response=%#v err=%v", first, err)
	}
	second, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{TurnID: "turn_queued_handoff_second", Text: "continue after the first turn"},
	})
	if err != nil || second.Kind != "queued" || second.TurnID != "turn_queued_handoff_second" {
		t.Fatalf("second turn response=%#v err=%v", second, err)
	}

	queuedView, err := svc.GetThread(ctx, meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if queuedView == nil || len(queuedView.QueuedTurns) != 1 || queuedView.QueuedTurns[0].TurnID != second.TurnID || queuedView.QueuedTurns[0].Text != "continue after the first turn" {
		t.Fatalf("queued thread snapshot=%#v", queuedView)
	}

	var admittedBootstrap *FlowerLiveBootstrapResponse
	waitForSinkCondition(t, "queued turn canonical admission", func() bool {
		bootstrap, readErr := svc.GetFlowerThreadLiveBootstrap(ctx, meta, thread.ThreadID)
		if readErr != nil {
			return false
		}
		userRows := 0
		for _, message := range bootstrap.TimelineMessages {
			if message.Role == "user" && message.TurnID == second.TurnID {
				userRows++
			}
		}
		if userRows != 1 || len(bootstrap.Thread.QueuedTurns) != 0 {
			return false
		}
		admittedBootstrap = bootstrap
		return true
	})
	if admittedBootstrap == nil {
		t.Fatal("canonical bootstrap was not captured")
	}
	if stored, getErr := svc.threadsDB.GetQueuedTurn(ctx, meta.EndpointID, thread.ThreadID, second.QueueID); !errors.Is(getErr, sql.ErrNoRows) || stored != nil {
		t.Fatalf("admitted queued command remains stored: %#v err=%v", stored, getErr)
	}
}

func TestGetThreadSerializesOwnedEmptyQueuedTurns(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(context.Background(), meta, "empty queue", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	view, err := svc.GetThread(context.Background(), meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"queued_turns":[]`) {
		t.Fatalf("thread detail does not own an explicit empty queue: %s", raw)
	}
}

func TestStartupRecoveryReleasesUnadmittedInFlightCommand(t *testing.T) {
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()
	meta := testSendTurnMeta()
	ctx := context.Background()
	first := newSendTurnTestServiceAt(t, stateDir, agentHomeDir)
	thread, err := first.CreateThread(ctx, meta, "recover in-flight admission", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	command := createPendingCommandForTest(t, first, meta, thread.ThreadID, "command_crash_before_admission", "turn_crash_before_admission", "run_crash_before_admission")
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	restarted := newSendTurnTestServiceAt(t, stateDir, agentHomeDir)
	deadline := time.Now().Add(3 * time.Second)
	for {
		stored, getErr := restarted.threadsDB.GetQueuedTurn(ctx, meta.EndpointID, thread.ThreadID, command.QueueID)
		if getErr == nil && stored != nil && stored.AdmissionState == threadstore.PendingTurnAdmissionReady && stored.Lane == threadstore.FollowupLaneQueued {
			break
		}
		if getErr != nil && !errors.Is(getErr, sql.ErrNoRows) {
			t.Fatal(getErr)
		}
		if time.Now().After(deadline) {
			t.Fatalf("recovered command=%#v err=%v, want queued ready admission", stored, getErr)
		}
		time.Sleep(10 * time.Millisecond)
	}
	turnIDs, err := restarted.readCanonicalThreadTurnIDs(ctx, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if _, admitted := turnIDs[command.TurnID]; admitted {
		t.Fatal("startup recovery admitted a command that had no canonical user entry before the crash")
	}
}

func TestStartupRecoveryFailsBeforeWakeWhenAdmissionReleaseIdentityIsInvalid(t *testing.T) {
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()
	svc := newSendTurnTestServiceAt(t, stateDir, agentHomeDir)
	meta := testSendTurnMeta()
	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, meta, "fail closed admission recovery", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	command := createPendingCommandForTest(t, svc, meta, thread.ThreadID, "command_release_failure", "turn_release_failure", "run_release_failure")
	raw, err := sql.Open("sqlite", filepath.Join(stateDir, "ai", "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	if _, err := raw.ExecContext(ctx, `
UPDATE ai_queued_turns
SET run_id = ''
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ?
`, meta.EndpointID, thread.ThreadID, command.QueueID); err != nil {
		t.Fatal(err)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewService(Options{
		Logger:   slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelDebug})),
		StateDir: stateDir, AgentHomeDir: agentHomeDir, Shell: "/bin/bash", Config: svc.cfg,
		PersistOpTimeout: 2 * time.Second, RunMaxWallTime: 2 * time.Second, RunIdleTimeout: time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "", false, nil },
	})
	if restarted != nil {
		_ = restarted.Close()
		t.Fatal("startup returned a service after incomplete queued admission recovery")
	}
	if err == nil || !strings.Contains(err.Error(), "release unadmitted command") {
		t.Fatalf("startup error=%v, want explicit release failure", err)
	}
	var admissionState string
	if err := raw.QueryRowContext(ctx, `
SELECT admission_state
FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND queue_id = ?
`, meta.EndpointID, thread.ThreadID, command.QueueID).Scan(&admissionState); err != nil {
		t.Fatal(err)
	}
	if admissionState != threadstore.PendingTurnAdmissionInFlight {
		t.Fatalf("failed release admission state=%q, want in_flight", admissionState)
	}
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
		ThreadID: thread.ThreadID, TurnID: command.TurnID, MessageID: "message_event",
		FloretHostFactory: floretRuntime.Turn, PersistOpTimeout: time.Second,
	}, svc.threadsDB)
	if r.turnID != command.TurnID || r.messageID == r.turnID {
		t.Fatalf("admission identity turn=%q message=%q, want exact distinct identities", r.turnID, r.messageID)
	}
	r.setPendingTurnCommand(command.QueueID)
	r.awaitFloretAdmission.Store(true)
	r.expectFloretRuntimeEventIdentity(command.RunID, thread.ThreadID, command.TurnID, true)
	turnHost, err := floretRuntime.Turn(ctx, flruntime.TurnExecutionHostOptions{
		Config: flconfig.Config{Provider: flconfig.ProviderFake, Model: "fake-model", FakeResponse: "accepted"},
		Sink:   floretEventSink{run: r},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := turnHost.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID), TurnID: flruntime.TurnID(command.TurnID),
		RunID: flruntime.RunID(command.RunID), Input: flruntime.TurnInput{Text: command.TextContent},
	}); err != nil {
		t.Fatal(err)
	}
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
		{name: "execution failure", id: "retry", targetLane: threadstore.FollowupLaneDraft},
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
				ThreadID: thread.ThreadID, TurnID: command.TurnID, MessageID: "message_release_" + testCase.id,
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
