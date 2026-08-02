package ai

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v3/identity"
	flprovider "github.com/floegence/floret/v3/provider"
	flruntime "github.com/floegence/floret/v3/runtime"
	flstorage "github.com/floegence/floret/v3/storage"
	fltools "github.com/floegence/floret/v3/tools"
)

func TestFloretApprovedEffectsKeepAuthorityAcrossLeaseRenewal(t *testing.T) {
	ctx := context.Background()
	store := openTestFloretRuntimeHost(t, flstorage.Memory())
	bootstrap := testFloretBootstrap(t, store)
	created, err := bootstrap.threadCreate.CreateThread(ctx, "create-approval-renewal")
	if err != nil {
		t.Fatal(err)
	}
	threadRuntime, err := bootstrap.bindThreadRuntime(created.ThreadID)
	if err != nil {
		t.Fatal(err)
	}

	var handlerCalls atomic.Int32
	tool := fltools.Define[struct {
		Text string `json:"text"`
	}](
		fltools.Definition{
			Name: "write_note",
			InputSchema: fltools.StrictObject(map[string]any{
				"text": fltools.String("note text"),
			}, []string{"text"}),
			Effects:    []fltools.Effect{fltools.EffectWrite},
			Permission: fltools.PermissionSpec{Mode: fltools.PermissionAsk},
		},
		nil,
		nil,
		func(_ context.Context, inv fltools.Invocation[struct {
			Text string `json:"text"`
		}]) (fltools.Result, error) {
			handlerCalls.Add(1)
			return fltools.Result{Text: "wrote " + inv.Args.Text}, nil
		},
	)
	gateway := floretModelGatewayFunc(func(_ context.Context, req flprovider.Request) (<-chan flprovider.Event, error) {
		events := make(chan flprovider.Event, 3)
		if req.Step <= 3 {
			callID := fmt.Sprintf("call-%d", req.Step)
			events <- flprovider.Event{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{
				ID: callID, Name: "write_note", Args: fmt.Sprintf(`{"text":"note %d"}`, req.Step),
			}}}
			events <- flprovider.Event{Type: flprovider.EventDone, Reason: "tool_calls"}
		} else {
			events <- flprovider.Event{Type: flprovider.EventDelta, Text: "done"}
			events <- flprovider.Event{Type: flprovider.EventDone, Reason: "stop"}
		}
		close(events)
		return events, nil
	})
	agent := newTestFloretAgent(t, gateway,
		flruntime.WithAgentTools(tool),
		flruntime.WithAgentEffectAuthorization(allowFloretEffectGateForTest{}),
	)
	turnHost, err := threadRuntime.Turn(ctx, agent)
	if err != nil {
		t.Fatal(err)
	}
	admission, err := turnHost.AdmitTurn(ctx, flruntime.StartTurnCommand{
		LogicalRequestID: "approval-renewal-turn",
		UserMessage:      flruntime.TurnInput{Text: "write three notes"},
		Limits:           flruntime.TurnLimits{MaxToolCalls: 4},
	})
	if err != nil {
		t.Fatal(err)
	}

	type turnOutcome struct {
		result flruntime.StartTurnResult
		err    error
	}
	done := make(chan turnOutcome, 1)
	go func() {
		result, runErr := turnHost.ExecuteAdmission(ctx, admission.Receipt, flruntime.ExecutionContext{})
		done <- turnOutcome{result: result, err: runErr}
	}()

	for index, callID := range []string{"call-1", "call-2", "call-3"} {
		queue := waitForFloretApprovalCall(t, ctx, turnHost, callID)
		if index == 2 {
			// Floret's published default renewal interval is 10 seconds. Keep the
			// third effect waiting across a heartbeat, matching the Desktop failure.
			time.Sleep(11 * time.Second)
		}
		current := queue.Items[0]
		_, err := turnHost.ResolveApproval(ctx, flruntime.ResolveApprovalCommand{
			LogicalRequestID:         identity.LogicalRequestID("decision-" + string(callID)),
			DecisionID:               "decision-" + string(callID),
			ExpectedGeneration:       queue.Generation,
			ExpectedRevision:         queue.Revision,
			ExpectedCurrent:          flruntime.ApprovalIdentity{ApprovalID: current.ApprovalID, ThreadID: current.ThreadID, TurnID: current.TurnID, RunID: current.RunID, ToolCallID: current.ToolCallID, EffectAttemptID: current.EffectAttemptID},
			ExpectedApprovalRevision: current.Revision,
			Decision:                 flruntime.ApprovalDecisionApprove,
		})
		if err != nil {
			t.Fatalf("approve %s: %v", callID, err)
		}
	}

	select {
	case outcome := <-done:
		if outcome.err != nil {
			t.Fatalf("turn result=%#v err=%v, want no stale authority", outcome.result, outcome.err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("turn did not finish after approved effect dispatch")
	}
	if got := handlerCalls.Load(); got != 3 {
		t.Fatalf("effect handler calls=%d, want 3", got)
	}
	snapshot, err := turnHost.ReadTurn(ctx, admission.TurnID)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Status != flruntime.TurnStatusCompleted {
		t.Fatalf("turn status=%q, want completed", snapshot.Status)
	}
	queue, err := turnHost.ReadApprovalQueue(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(queue.Items) != 0 {
		t.Fatalf("approval queue after completed turn=%#v, want empty", queue)
	}
}

func waitForFloretApprovalCall(t *testing.T, ctx context.Context, host interface {
	ReadApprovalQueue(context.Context) (flruntime.ApprovalQueue, error)
}, callID string) flruntime.ApprovalQueue {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		queue, err := host.ReadApprovalQueue(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if len(queue.Items) == 1 && queue.Items[0].ToolCallID == callID {
			return queue
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for approval %q: %#v", callID, queue)
		}
		time.Sleep(time.Millisecond)
	}
}
