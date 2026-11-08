package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
)

type subagentCancellationTestRuntime struct {
	*subagentHandoffTestRuntime
	calls    []identity.ThreadID
	results  map[identity.ThreadID]flruntime.ThreadView
	failures map[identity.ThreadID]error
}

func (runtime *subagentCancellationTestRuntime) Cancel(_ context.Context, in flruntime.CancelInput) (flruntime.ThreadView, error) {
	runtime.calls = append(runtime.calls, in.ThreadID)
	if in.IncludeDescendants || in.RequestKey == "" {
		panic("unexpected cancellation scope")
	}
	return runtime.results[in.ThreadID], runtime.failures[in.ThreadID]
}

func cancellationFixture(t *testing.T) (*floretSubagentRuntime, *subagentCancellationTestRuntime) {
	t.Helper()
	now := time.Unix(1700000000, 0)
	summaries := []flruntime.ThreadSummary{}
	results := map[identity.ThreadID]flruntime.ThreadView{}
	for i, id := range []string{"older", "current", "completed"} {
		summary := completedSubagentTestSummary(id, id, "report", now.Add(-time.Duration(i)*time.Second))
		if id == "older" {
			summary.ParentTurnID = "previous-parent-turn"
		}
		if id != "completed" {
			summary.Activity, summary.LastOutcome = flruntime.ThreadActivityActive, nil
		}
		summaries = append(summaries, summary)
		outcome := flruntime.TurnOutcomeCancelled
		results[summary.ID] = flruntime.ThreadView{ThreadID: summary.ID, TurnID: summary.TurnID, RunID: summary.RunID, Activity: flruntime.ThreadActivityIdle, LastOutcome: &outcome, Cancellation: &flruntime.ThreadCancellation{ThreadID: summary.ID, TurnID: summary.TurnID, RunID: summary.RunID, Mode: flruntime.CancelModeImmediate}}
	}
	adapter, base := newSubagentHandoffTestAdapter(t, summaries, nil)
	runtime := &subagentCancellationTestRuntime{subagentHandoffTestRuntime: base, results: results, failures: map[identity.ThreadID]error{}}
	adapter.service.threadRuntime = runtime
	return adapter, runtime
}

func TestSubagentCloseAllCountsOnlyConfirmedCurrentThreadCancellations(t *testing.T) {
	adapter, runtime := cancellationFixture(t)
	result, err := adapter.closeAll(t.Context(), "cancel-all", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(runtime.calls, []identity.ThreadID{"older", "current"}) || result["scope"] != "current_thread" || result["accepted_count"] != 2 || result["stopped_count"] != 2 || result["closed_count"] != 2 || !reflect.DeepEqual(result["affected_ids"], []string{"older", "current"}) || len(result["items"].([]map[string]any)) != 2 {
		t.Fatalf("calls=%v result=%#v", runtime.calls, result)
	}
}

func TestSubagentCloseUsesReturnedCancellationFacts(t *testing.T) {
	for _, scenario := range []string{"terminal", "completed_race", "stopping", "stopped", "old_cancellation", "unknown_child_effect"} {
		t.Run(scenario, func(t *testing.T) {
			adapter, runtime := cancellationFixture(t)
			target, accepted, stopped, calls := "older", false, false, 1
			view := runtime.results["older"]
			switch scenario {
			case "terminal":
				target = "completed"
			case "completed_race":
				outcome := flruntime.TurnOutcomeCompleted
				view.LastOutcome, view.Cancellation = &outcome, nil
			case "stopping":
				view.Activity = flruntime.ThreadActivityActive
				view.LastOutcome = nil
				accepted = true
			case "stopped":
				accepted, stopped = true, true
			case "old_cancellation":
				view.Activity = flruntime.ThreadActivityActive
				view.LastOutcome = nil
				view.Cancellation.RunID = "old-run"
			case "unknown_child_effect":
				outcome := flruntime.TurnOutcomeFailed
				view.LastOutcome = &outcome
				view.Failure = &flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureEffectOutcomeUnknown}
				accepted, stopped = true, true
			}
			runtime.results["older"] = view
			result, err := adapter.close(t.Context(), "close", map[string]any{"target": target})
			if err != nil || result["accepted"] != accepted || result["stopped"] != stopped || result["closed"] != stopped || len(runtime.calls) != calls {
				t.Fatalf("calls=%v result=%#v err=%v", runtime.calls, result, err)
			}
		})
	}
}

func TestSubagentCloseAllPreservesConfirmedPrefixOnFailure(t *testing.T) {
	adapter, runtime := cancellationFixture(t)
	failure := errors.New("result projection unavailable")
	runtime.failures["current"] = failure
	result, err := adapter.closeAll(t.Context(), "partial", nil)
	if !errors.Is(err, failure) || result["status"] != "partial" || result["stopped_count"] != 1 || result["accepted_count"] != 1 || !reflect.DeepEqual(result["affected_ids"], []string{"older"}) || !reflect.DeepEqual(result["unconfirmed_ids"], []string{"current"}) {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if !reflect.DeepEqual(runtime.calls, []identity.ThreadID{"older", "current"}) {
		t.Fatalf("unexpected replay: %v", runtime.calls)
	}
}

func TestSubagentCancellationPartialFactsReachModelAndPublicActivity(t *testing.T) {
	for _, action := range []string{subagentActionClose, subagentActionCloseAll} {
		t.Run(action, func(t *testing.T) {
			adapter, runtime := cancellationFixture(t)
			runtime.failures["current"] = errors.New("canonical projection unavailable")
			r := newRun(runOptions{SessionMeta: testSendTurnMeta(), ThreadID: "thread-parent", TurnID: "turn-parent", RunID: "run-parent", SubagentRuntime: adapter, AllowSubagentDelegate: true})
			snapshot := buildPermissionSnapshot(FlowerPermissionFullAccess, builtInToolDefinitions(), nil)
			snapshot.SnapshotID = "cancellation-fixture"
			ctx := contextWithToolAuthorizationSnapshot(t.Context(), snapshot)
			ctx = contextWithFloretToolExecutionAuthorization(ctx, "call", "subagent_manage", "attempt", snapshot, ApprovalDecisionAllow, true, nil)
			args := map[string]any{"action": action}
			if action == subagentActionClose {
				args["target"] = "current"
			}
			result, err := (&builtInToolHandler{r: r, toolName: "subagent_manage"}).Execute(ctx, ToolCall{ID: "call", Name: "subagent_manage", Args: args})
			if err != nil {
				t.Fatal(err)
			}
			if result.Status != toolResultStatusError || result.Error == nil || result.Error.Retryable || !result.effectUncertain {
				t.Fatalf("false success or retry authority: %+v", result)
			}
			encoded, err := floretToolResultFromFlower(r, result)
			if err != nil {
				t.Fatal(err)
			}
			if !encoded.IsError || encoded.EffectOutcome != fltools.EffectOutcomeUncertain || encoded.Activity == nil {
				t.Fatalf("result boundary lost uncertainty: %+v", encoded)
			}
			var model struct {
				Data map[string]any `json:"data"`
			}
			if err := json.Unmarshal([]byte(encoded.Text), &model); err != nil {
				t.Fatal(err)
			}
			if model.Data["status"] != "partial" || !reflect.DeepEqual(model.Data["unconfirmed_ids"], []any{"current"}) {
				t.Fatalf("model lost partial facts: %s", encoded.Text)
			}
			wantTargets := 1
			if action == subagentActionCloseAll {
				wantTargets = 2
				if model.Data["stopped_count"] != float64(1) || !reflect.DeepEqual(model.Data["affected_ids"], []any{"older"}) {
					t.Fatalf("model lost confirmed prefix: %s", encoded.Text)
				}
			}
			payload := encoded.Activity.Payload.(fltools.SubAgentOperationActivityPayload)
			if payload.Status != toolResultStatusError || payload.Error == nil || payload.RequestedCount != wantTargets || len(payload.Targets) != wantTargets || payload.Targets[wantTargets-1].Status != "unknown" {
				t.Fatalf("activity lost outcomes: %+v", payload)
			}
			if action == subagentActionCloseAll && payload.Targets[0].Status != subagentStatusCanceled {
				t.Fatalf("activity lost stopped sibling: %+v", payload)
			}
			original := flruntime.ThreadItem{ID: "tool:call", TurnID: "turn-parent", RunID: "run-parent", Kind: flruntime.ThreadItemTool, Activity: &observation.ActivityItem{ItemID: "call", ToolID: "call", ToolName: "subagent_manage", Kind: observation.ActivityKindTool, Status: observation.ActivityStatusError, Presentation: encoded.Activity}}
			saved, err := json.Marshal(original)
			if err != nil {
				t.Fatal(err)
			}
			var reloaded flruntime.ThreadItem
			if err := json.Unmarshal(saved, &reloaded); err != nil {
				t.Fatal(err)
			}
			public, ok, err := typedThreadItemMessage("thread-parent", reloaded)
			if err != nil || !ok || !strings.Contains(string(public), `"status":"unknown"`) || !strings.Contains(string(public), `"status":"error"`) {
				t.Fatalf("public reload lost facts: %s %v", public, err)
			}
			if len(runtime.calls) != wantTargets {
				t.Fatalf("cancellation replayed: %v", runtime.calls)
			}
		})
	}
}

func TestSubagentCloseAllReportsUnattemptedChildren(t *testing.T) {
	adapter, runtime := cancellationFixture(t)
	runtime.failures["older"] = context.DeadlineExceeded
	result, err := adapter.closeAll(t.Context(), "failure-first", nil)
	if !errors.Is(err, context.DeadlineExceeded) || !reflect.DeepEqual(result["unattempted_ids"], []string{"current"}) || result["stopped_count"] != 0 || !reflect.DeepEqual(runtime.calls, []identity.ThreadID{"older"}) {
		t.Fatalf("result=%#v calls=%v err=%v", result, runtime.calls, err)
	}
}

func TestSubagentCloseAllUsesPublishedCancellationAndRetainsThreads(t *testing.T) {
	gateway := delegationContextGateway(florettest.Step{WaitForCancellation: true}, florettest.Step{WaitForCancellation: true}, delegationContextDone(), delegationContextDone())
	threads := delegationContextThread(t, gateway, func(context.Context, flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
		return flruntime.ToolSurface{}, nil
	})
	parent, err := threads.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "parent"})
	if err != nil {
		t.Fatal(err)
	}
	children := []identity.ThreadID{}
	for i, key := range []string{"older", "current", "completed"} {
		child, err := threads.Create(t.Context(), flruntime.CreateThreadInput{ParentThreadID: parent.ThreadID, ParentTurnID: identity.TurnID(key), TaskName: key, TaskDescription: "Cancellation acceptance", HostProfileRef: "flower", RequestKey: flruntime.RequestKey(key)})
		if err != nil {
			t.Fatal(err)
		}
		children = append(children, child.ThreadID)
		if i == 2 {
			delegationContextSend(t, threads, child.ThreadID, "finish", nil)
			continue
		}
		if _, err := threads.Send(t.Context(), flruntime.SendInput{ThreadID: child.ThreadID, RequestKey: "work", Input: flruntime.UserInput{Text: "wait for cancellation"}}); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
		err = gateway.WaitForRequests(ctx, i+1)
		cancel()
		if err != nil {
			t.Fatal(err)
		}
	}
	adapter := newServiceFloretSubagentRuntime(&Service{threadRuntime: threads}, &run{threadID: parent.ThreadID.String(), turnID: "current"})
	result, err := adapter.closeAll(t.Context(), "close-all", nil)
	if err != nil || result["accepted_count"] != 2 || result["stopped_count"] != 2 {
		t.Fatalf("published Cancel result=%#v err=%v", result, err)
	}
	for i, id := range children {
		view, err := threads.View(t.Context(), id)
		if err != nil || len(view.Items) == 0 || view.Activity != flruntime.ThreadActivityIdle {
			t.Fatalf("child/history lost: %+v err=%v", view, err)
		}
		want := flruntime.TurnOutcomeCancelled
		if i == 2 {
			want = flruntime.TurnOutcomeCompleted
		}
		if view.LastOutcome == nil || *view.LastOutcome != want {
			t.Fatalf("child outcome=%+v", view)
		}
	}
	// A repeated close observes terminal children without claiming new effects.
	again, err := adapter.closeAll(t.Context(), "again", nil)
	if err != nil || again["stopped_count"] != 0 {
		t.Fatalf("repeated close=%#v err=%v", again, err)
	}
	// Published steering accepts a new turn on the same durable cancelled child.
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	updates, err := threads.Subscribe(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer updates.Close()
	resumed, err := threads.(flruntime.ThreadSteeringController).Steer(ctx, flruntime.SteerInput{ThreadID: children[0], RequestKey: "continue", Input: flruntime.UserInput{Text: "continue"}})
	if err != nil {
		t.Fatal(err)
	}
	for {
		view, err := threads.View(ctx, children[0])
		if err != nil {
			t.Fatal(err)
		}
		if view.Activity == flruntime.ThreadActivityIdle {
			if view.TurnID != resumed.TurnID || view.LastOutcome == nil || *view.LastOutcome != flruntime.TurnOutcomeCompleted {
				t.Fatalf("continuation failed: %+v", view)
			}
			break
		}
		if _, err := updates.Next(ctx); err != nil {
			t.Fatal(err)
		}
	}
	parentID := parent.ThreadID
	listed, err := threads.List(ctx, flruntime.ThreadScope{ParentID: &parentID})
	if err != nil || len(listed) != 3 {
		t.Fatalf("lost durable children: %v %v", listed, err)
	}
}

func TestSubagentCloseAllLargeInventoryKeepsCompleteCountsAndBoundedActivity(t *testing.T) {
	adapter, runtime := cancellationFixture(t)
	base := runtime.summaries[0]
	runtime.summaries = nil
	for i := range 205 {
		summary := base
		summary.ID = identity.ThreadID(fmt.Sprintf("child-%03d", i))
		runtime.summaries = append(runtime.summaries, summary)
		view := runtime.results["older"]
		view.ThreadID = summary.ID
		cancellation := *view.Cancellation
		cancellation.ThreadID = summary.ID
		view.Cancellation = &cancellation
		runtime.results[summary.ID] = view
	}
	data, err := adapter.closeAll(t.Context(), "large", nil)
	if err != nil || data["stopped_count"] != 205 || len(data["affected_ids"].([]string)) != 205 || len(runtime.calls) != 205 {
		t.Fatalf("large batch lost effects: %#v %v", data, err)
	}
	encoded, err := floretToolResultFromFlower(nil, ToolResult{ToolID: "large", ToolName: "subagent_manage", Status: toolResultStatusSuccess, Data: data})
	if err != nil {
		t.Fatal(err)
	}
	payload := encoded.Activity.Payload.(fltools.SubAgentOperationActivityPayload)
	var model struct {
		Data struct {
			Items []any `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(encoded.Text), &model); err != nil || len(model.Data.Items) != 205 {
		t.Fatalf("model outcomes truncated: %d %v", len(model.Data.Items), err)
	}
	if payload.RequestedCount != 205 || len(payload.Targets) != 200 {
		t.Fatalf("unbounded activity: counts=%d targets=%d", payload.RequestedCount, len(payload.Targets))
	}
	if _, err := json.Marshal(encoded.Activity); err != nil {
		t.Fatalf("invalid public Activity: %v", err)
	}
}
