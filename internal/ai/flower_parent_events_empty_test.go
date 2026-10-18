package ai

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
)

func assertFlowerEmptyParentEvents(t *testing.T, value any) {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var root struct {
		Current struct {
			ParentEvents *struct {
				Events json.RawMessage `json:"events"`
			} `json:"parent_events"`
		} `json:"current"`
	}
	if err := json.Unmarshal(encoded, &root); err != nil {
		t.Fatal(err)
	}
	if root.Current.ParentEvents == nil || string(root.Current.ParentEvents.Events) != "[]" {
		t.Fatalf("successful product envelope lost empty parent event array: %s", encoded)
	}
}

func TestFlowerHiEmptyParentEventsThroughLiveAndDetail(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(ctx, meta, "Empty parent events", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	detail, err := svc.GetFlowerThreadDetail(ctx, meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	assertFlowerEmptyParentEvents(t, detail)
	var calls atomic.Int32
	gateway := testFloretGatewayFunc(func(context.Context, flprovider.Request) (<-chan flprovider.Event, error) {
		calls.Add(1)
		events := make(chan flprovider.Event, 2)
		events <- flprovider.Event{Type: flprovider.EventDelta, Text: "Hi! How can I help?"}
		events <- flprovider.Event{Type: flprovider.EventDone, Reason: "stop"}
		close(events)
		return events, nil
	})
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{
		Profile: flconfig.AgentProfile{ID: "hi-assistant", Name: "Hi assistant"}, SystemPrompt: "Reply to the greeting.",
		Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens},
	}, gateway)
	if err != nil {
		t.Fatal(err)
	}
	const requestKey = "request-hi-empty-events"
	svc.floretEffects.put(identity.ThreadID(thread.ThreadID), requestKey, floretEffectRequest{agent: agent, meta: *meta,
		req: SendUserTurnRequest{Options: RunOptions{PermissionType: "approval_required"}}})
	subscription, err := svc.SubscribeFlowerLiveStream(ctx, meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	if ready := nextFlowerLiveStreamFrame(t, subscription); ready.Kind != FlowerLiveStreamReady {
		t.Fatalf("ready kind=%q", ready.Kind)
	}
	admitted, err := svc.threadRuntime.Send(ctx, flruntime.SendInput{ThreadID: identity.ThreadID(thread.ThreadID), Input: flruntime.UserInput{Text: "hi"}, RequestKey: requestKey})
	if err != nil {
		t.Fatal(err)
	}
	assertFlowerEmptyParentEvents(t, SendUserTurnResponse{Kind: "start", Current: admitted})
	for {
		frame, err := readFlowerLiveStreamEnvelope(ctx, subscription)
		if err != nil {
			t.Fatal(err)
		}
		var envelope FlowerLiveStreamEnvelope
		if err := json.Unmarshal(frame.Data, &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.Current == nil || envelope.ThreadID != thread.ThreadID {
			continue
		}
		assertFlowerEmptyParentEvents(t, envelope)
		current := envelope.Current
		if current.Activity != flruntime.ThreadActivityIdle {
			continue
		}
		if current.LastOutcome == nil || *current.LastOutcome != flruntime.TurnOutcomeCompleted || !strings.Contains(string(frame.Data), "Hi! How can I help?") {
			t.Fatalf("hi did not converge to its saved reply: %s", frame.Data)
		}
		break
	}
	for range 2 {
		detail, err = svc.GetFlowerThreadDetail(ctx, meta, thread.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		assertFlowerEmptyParentEvents(t, detail)
		encoded, err := json.Marshal(detail)
		if err != nil || !strings.Contains(string(encoded), "Hi! How can I help?") {
			t.Fatalf("saved reply missing: %s %v", encoded, err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("provider dispatched %d times, want one", calls.Load())
	}
}
