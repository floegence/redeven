package ai

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func testSendTurnMeta() *session.Meta {
	return &session.Meta{
		ChannelID: "ch_send_turn_test", EndpointID: "env_send_turn_test", NamespacePublicID: "ns_send_turn_test",
		UserPublicID: "u_send_turn_test", UserEmail: "u_send_turn_test@example.com",
		CanRead: true, CanWrite: true, CanExecute: true,
	}
}

func TestRunInputRejectsLegacyMessageIdentityField(t *testing.T) {
	var input RunInput
	err := json.Unmarshal([]byte(`{"message_id":"legacy_message","text":"must fail","attachments":[]}`), &input)
	if err == nil || !strings.Contains(err.Error(), `unknown field "message_id"`) {
		t.Fatalf("json.Unmarshal error=%v, want rejected legacy message_id", err)
	}
}

func TestSendUserTurnReturnsImmediateTypedCurrent(t *testing.T) {
	svc := newRealtimeTestService(t, 2*time.Second)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "typed acceptance", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	startedAt := time.Now()
	response, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{
		ClientRequestID: "request-immediate-current", ThreadID: thread.ThreadID,
		Input: RunInput{Text: "start"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(startedAt); elapsed >= 500*time.Millisecond {
		t.Fatalf("typed send elapsed %s, want below 500ms", elapsed)
	}
	if response.Kind != "start" || response.ClientRequestID != "request-immediate-current" || response.TurnID == "" {
		t.Fatalf("typed response=%#v", response)
	}
	if response.Current.Activity != flruntime.ThreadActivityActive || response.Current.TurnID.String() != response.TurnID || len(response.Current.Items) != 1 || response.Current.Items[0].Kind != flruntime.ThreadItemUser {
		t.Fatalf("command current=%#v, want immediate canonical user/running view", response.Current)
	}
}

func TestTypedStopSucceedsWithoutLegacyHandler(t *testing.T) {
	svc := newRealtimeTestService(t, 5*time.Second)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "handler-free stop", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{
		ClientRequestID: "request-handler-free-stop", ThreadID: thread.ThreadID,
		Input: RunInput{Text: "start then stop"},
	}); err != nil {
		t.Fatal(err)
	}
	stop, err := svc.StopThread(t.Context(), meta, thread.ThreadID)
	if err != nil || !stop.OK {
		t.Fatalf("typed stop=%#v err=%v", stop, err)
	}
	second, err := svc.StopThread(t.Context(), meta, thread.ThreadID)
	if err != nil || !second.OK {
		t.Fatalf("idempotent typed stop=%#v err=%v", second, err)
	}
}

func TestTypedSendPublishesRunningBeforeEffectPreparation(t *testing.T) {
	svc := newRealtimeTestService(t, 5*time.Second)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "slow preparation", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	preparationStarted := make(chan struct{})
	releasePreparation := make(chan struct{})
	svc.toolTargetPolicyForRun = func(*session.Meta, threadstore.ThreadSettings, *threadstore.FlowerThreadRouting) ToolTargetPolicy {
		close(preparationStarted)
		<-releasePreparation
		return ToolTargetPolicy{}
	}
	t.Cleanup(func() {
		select {
		case <-releasePreparation:
		default:
			close(releasePreparation)
		}
	})
	startedAt := time.Now()
	response, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{
		ClientRequestID: "request-slow-preparation", ThreadID: thread.ThreadID,
		Input: RunInput{Text: "accept before preparing effects"},
	})
	if err != nil || response.TurnID == "" {
		t.Fatalf("typed send=%#v err=%v", response, err)
	}
	if elapsed := time.Since(startedAt); elapsed >= 500*time.Millisecond {
		t.Fatalf("typed Send elapsed=%s, want below 500ms", elapsed)
	}
	view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil || view.Activity != flruntime.ThreadActivityActive {
		t.Fatalf("runtime view=%#v err=%v", view, err)
	}
	select {
	case <-preparationStarted:
	case <-time.After(time.Second):
		t.Fatal("effect preparation did not start asynchronously")
	}
	close(releasePreparation)
}

func TestTypedActiveThreadQueuesOnlyInRuntimeView(t *testing.T) {
	svc := newRealtimeTestService(t, 250*time.Millisecond)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "typed queue", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if first, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "request-first", ThreadID: thread.ThreadID, Input: RunInput{Text: "first"}}); err != nil || first.Kind != "start" {
		t.Fatalf("first=%#v err=%v", first, err)
	}
	second, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "request-second", ThreadID: thread.ThreadID, Input: RunInput{Text: "second"}})
	if err != nil || second.Kind != "queued" || second.QueueID != "queue:request-second" {
		t.Fatalf("second=%#v err=%v", second, err)
	}
	view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil || len(view.Queue) != 1 || view.Queue[0].RequestKey != "request-second" {
		t.Fatalf("runtime queue=%#v err=%v", view.Queue, err)
	}
}

func TestConcurrentTypedSendDeduplicatesRequest(t *testing.T) {
	svc := newRealtimeTestService(t, 250*time.Millisecond)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "typed dedupe", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan SendUserTurnResponse, 2)
	errs := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			response, sendErr := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "request-same", ThreadID: thread.ThreadID, Input: RunInput{Text: "same"}})
			results <- response
			errs <- sendErr
		}()
	}
	close(start)
	var first SendUserTurnResponse
	for index := range 2 {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
		response := <-results
		if index == 0 {
			first = response
		} else if response.TurnID != first.TurnID || response.Kind != first.Kind {
			t.Fatalf("deduplicated responses differ: first=%#v second=%#v", first, response)
		}
	}
	view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil || len(view.Items) != 1 {
		t.Fatalf("canonical items=%#v err=%v", view.Items, err)
	}
}
