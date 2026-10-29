package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
)

func TestSubagentWaitReportsDeletedFrozenTargets(t *testing.T) {
	adapter, children := newSubagentHandoffTestAdapter(t, nil, nil)
	children.waitResult = &flruntime.ThreadWaitResult{Reason: flruntime.ThreadWaitMissing, MissingThreadIDs: []identity.ThreadID{"deleted-child"}}
	result, err := adapter.wait(t.Context(), map[string]any{"timeout_ms": 10})
	if err != nil {
		t.Fatal(err)
	}
	if result["reason"] != "missing" || readIntField(result, "requested_count") != 1 || readIntField(result, "found_count") != 0 || readIntField(result, "missing_count") != 1 {
		t.Fatalf("result=%#v", result)
	}
	if ids := result["missing_ids"].([]identity.ThreadID); len(ids) != 1 || ids[0] != "deleted-child" {
		t.Fatalf("missing=%#v", ids)
	}
}

func TestSubagentWaitWithoutParentEventsKeepsScopedEmptyPage(t *testing.T) {
	adapter, _ := newSubagentHandoffTestAdapter(t, nil, nil)
	result, err := adapter.wait(t.Context(), map[string]any{"timeout_ms": 10})
	if err != nil {
		t.Fatal(err)
	}
	page := result["events"].(flruntime.ParentEventPage)
	if page.ThreadID != "thread-parent" || page.Events == nil || len(page.Events) != 0 {
		t.Fatalf("empty page=%+v", page)
	}
	raw, err := json.Marshal(result)
	if err != nil || !strings.Contains(string(raw), "\"thread_id\":\"thread-parent\"") {
		t.Fatalf("result=%s err=%v", raw, err)
	}
}

func TestSubagentWaitMetadataAndAttention(t *testing.T) {
	for _, tc := range []struct {
		name, reason   string
		count, missing int
		wait, input    bool
	}{
		{name: "timeout", reason: "wait_timeout", count: 1, wait: true},
		{name: "empty timeout", reason: "wait_timeout"},
		{name: "missing", reason: "missing", count: 1, missing: 1},
		{name: "completed", reason: "completed", count: 1},
		{name: "attention", reason: "attention_required", count: 1, input: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result, err := floretToolResultFromFlower(nil, ToolResult{ToolID: "wait", ToolName: "subagents", Status: toolResultStatusSuccess, Data: map[string]any{"action": "wait", "reason": tc.reason, "found_count": tc.count, "missing_count": tc.missing, "timed_out": tc.reason == "wait_timeout", "effective_timeout_ms": 10000}})
			if err != nil || (result.BoundedWait != nil) != tc.wait || (result.InputRequired != nil) != tc.input {
				t.Fatalf("result=%#v err=%v", result, err)
			}
			if result.InputRequired != nil {
				if err := result.InputRequired.Validate(); err != nil {
					t.Fatal(err)
				}
			}
			if result.BoundedWait != nil && result.BoundedWait.Timeout != 10*time.Second {
				t.Fatal("deadline changed")
			}
		})
	}
}
func TestSubagentWaitCancellationIsNotTimeout(t *testing.T) {
	adapter, _ := newSubagentHandoffTestAdapter(t, nil, nil)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := adapter.wait(ctx, map[string]any{"timeout_ms": 10}); !errors.Is(err, context.Canceled) {
		t.Fatalf("err=%v", err)
	}
}
func TestTypedLoopFailureProjectionIsSafe(t *testing.T) {
	failure := &flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureEngineContract, Reason: flruntime.ThreadTurnFailureRepeatedToolCalls, Message: "agent loop repeated identical tool calls"}
	code, message := projectFloretTurnFailure(failure, "")
	if code != runErrorCodeRepeatedTools || !strings.Contains(message, "preserved") {
		t.Fatalf("code=%s message=%s", code, message)
	}
	detail := canonicalFailureDetail(failure)
	if !strings.Contains(detail, "repeated_tool_calls") || strings.Contains(detail, failure.Message) {
		t.Fatalf("detail=%s", detail)
	}
	failure.Message = "secret request body"
	if code, _ := projectFloretTurnFailure(failure, ""); code != runErrorCodeFloretEngineFailed {
		t.Fatalf("unvalidated reason=%s", code)
	}
	if canonicalFailureDetail(failure) != "" {
		t.Fatal("raw diagnostic leaked")
	}
}

func TestLoopFailureDiagnosticsRetainOnlyCanonicalIdentity(t *testing.T) {
	failure := &flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureEngineContract, Reason: flruntime.ThreadTurnFailureRepeatedToolCalls, Message: "agent loop repeated identical tool calls"}
	detail := scopedFailureDetail(failure, "thread-safe", "turn-safe", "run-safe")
	for _, value := range []string{"thread-safe", "turn-safe", "run-safe", "repeated_tool_calls"} {
		if !strings.Contains(detail, value) {
			t.Fatalf("missing %q: %s", value, detail)
		}
	}
	if strings.Contains(detail, failure.Message) {
		t.Fatal("raw engine message leaked")
	}
}

func TestSubagentRetryPreservesFourCompletedReportsWithoutRedispatch(t *testing.T) {
	summaries := make([]flruntime.ThreadSummary, 0, 4)
	views := make(map[identity.ThreadID]flruntime.ThreadView, 4)
	var reports []string
	for i := 0; i < 4; i++ {
		summary := completedSubagentTestSummary(fmt.Sprintf("completed-child-%d", i), fmt.Sprintf("Review %d", i), "preview", time.Now())
		report := fmt.Sprintf("COMPLETE_REPORT_%d:", i) + strings.Repeat("complete evidence ", 900)
		summaries = append(summaries, summary)
		views[summary.ID] = completedSubagentTestView(summary, report)
		reports = append(reports, report)
	}
	adapter, children := newSubagentHandoffTestAdapter(t, summaries, views)
	var dispatches atomic.Int32
	tool := fltools.Define[map[string]any](fltools.Definition{Name: "subagents", InputSchema: fltools.StrictObject(map[string]any{"action": fltools.String("action")}, []string{"action"}), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil,
		func(ctx context.Context, invocation fltools.Invocation[map[string]any]) (fltools.Result, error) {
			dispatches.Add(1)
			if invocation.Args["action"] != subagentActionWait {
				return fltools.Result{}, errors.New("completed children must not be spawned again")
			}
			data, err := adapter.manage(ctx, invocation.CallID, invocation.Args)
			if err != nil {
				return fltools.Result{}, err
			}
			return floretToolResultFromFlower(nil, ToolResult{ToolID: invocation.CallID, ToolName: "subagents", Status: toolResultStatusSuccess, Data: data})
		})
	gateway := delegationContextGateway(delegationContextCall("collect-reports", `{"action":"wait"}`), florettest.Step{ReturnError: errors.New("agent loop repeated identical tool calls")}, delegationContextDone())
	service := delegationContextThread(t, gateway, func(context.Context, flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
		return flruntime.ToolSurface{Tools: fltools.NewRegistry(tool)}, nil
	})
	created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create-retry-reports"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	updates, err := service.Subscribe(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer updates.Close()
	waitTerminal := func() flruntime.ThreadView {
		t.Helper()
		for {
			current, err := service.View(ctx, created.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			if current.Activity == flruntime.ThreadActivityIdle && current.LastOutcome != nil {
				return current
			}
			if _, err := updates.Next(ctx); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := service.Send(ctx, flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "collect", Input: flruntime.UserInput{Text: "collect all four reports"}}); err != nil {
		t.Fatal(err)
	}
	failed := waitTerminal()
	if *failed.LastOutcome != flruntime.TurnOutcomeFailed {
		t.Fatalf("outcome=%v", *failed.LastOutcome)
	}
	if _, err := service.Retry(ctx, flruntime.RetryInput{ThreadID: created.ThreadID, SourceTurnID: failed.TurnID, RequestKey: "retry-collection"}); err != nil {
		t.Fatal(err)
	}
	completed := waitTerminal()
	if *completed.LastOutcome != flruntime.TurnOutcomeCompleted || dispatches.Load() != 1 || len(children.summaries) != 4 {
		t.Fatalf("outcome=%v dispatches=%d children=%d", *completed.LastOutcome, dispatches.Load(), len(children.summaries))
	}
	requests := gateway.Requests()
	last := requests[len(requests)-1]
	var toolText string
	for _, message := range last.Messages {
		if message.ToolResult != nil {
			toolText += message.ToolResult.Text
		}
	}
	for _, report := range reports {
		if !strings.Contains(toolText, report) {
			t.Fatal("canonical retry discarded or truncated a completed child report")
		}
	}
}

func TestChildAttentionLeavesParentDecisionWithModel(t *testing.T) {
	for _, needsInput := range []bool{false, true} {
		t.Run(fmt.Sprint(needsInput), func(t *testing.T) {
			child := completedSubagentTestSummary("waiting-child", "Needs input", "", time.Now())
			child.Attention.InputCount = 1
			child.LastOutcome = nil
			adapter, children := newSubagentHandoffTestAdapter(t, []flruntime.ThreadSummary{child}, nil)
			var independent atomic.Int32
			wait := fltools.Define[map[string]any](fltools.Definition{Name: "subagents", InputSchema: fltools.StrictObject(map[string]any{"action": fltools.String("action")}, []string{"action"}), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(ctx context.Context, inv fltools.Invocation[map[string]any]) (fltools.Result, error) {
				data, err := adapter.wait(ctx, map[string]any{"ids": []any{child.ID.String()}, "timeout_ms": 1})
				if err != nil {
					return fltools.Result{}, err
				}
				result, err := floretToolResultFromFlower(nil, ToolResult{ToolID: inv.CallID, ToolName: "subagents", Status: toolResultStatusSuccess, Data: data})
				if result.InputRequired != nil || result.BoundedWait != nil || result.Metadata[fltools.ResultMetadataProgressToken] != nil {
					t.Error("attention manufactured parent control or progress")
				}
				return result, err
			})
			inspect := fltools.Define[struct{}](fltools.Definition{Name: "independent", ReadOnly: true, InputSchema: fltools.StrictObject(nil, nil), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(context.Context, fltools.Invocation[struct{}]) (fltools.Result, error) {
				independent.Add(1)
				return fltools.Result{Text: "Independent evidence"}, nil
			})
			last := delegationContextDone()
			if needsInput {
				last = goalInteractionCall("question", "ask_user", "{\"reason_code\":\"missing_external_input\",\"required_from_user\":[\"Choose the required destination.\"],\"evidence_refs\":[],\"questions\":[{\"id\":\"destination\",\"header\":\"Destination\",\"question\":\"Which destination should I use?\",\"response_mode\":\"write\",\"is_secret\":false}]}")
			}
			gateway := delegationContextGateway(delegationContextCall("wait", "{\"action\":\"wait\"}"), goalInteractionCall("independent", "independent", "{}"), last, delegationContextDone())
			service := delegationContextThread(t, gateway, func(context.Context, flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
				return flruntime.ToolSurface{Tools: fltools.NewRegistry(wait, inspect)}, nil
			})
			created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
			if err != nil {
				t.Fatal(err)
			}
			if needsInput {
				if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "start", Input: flruntime.UserInput{Text: "Continue available work"}}); err != nil {
					t.Fatal(err)
				}
				waiting := waitToolDesignAttention(t, service, created.ThreadID)
				if len(waiting.Interactions) != 1 || waiting.Interactions[0].ID != "question" || independent.Load() != 1 {
					t.Fatalf("parent did not choose the real request: %+v", waiting)
				}
				if _, err := service.Respond(t.Context(), flruntime.RespondInput{ThreadID: created.ThreadID, InteractionID: waiting.Interactions[0].ID, RequestKey: "answer", Answers: []flruntime.InteractionAnswer{{Input: map[string]string{"destination": "chosen"}}}}); err != nil {
					t.Fatal(err)
				}
				waitDesktopContinuation(t, service, created.ThreadID)
			} else {
				delegationContextSend(t, service, created.ThreadID, "start", nil)
			}
			if independent.Load() != 1 || children.summaries[0].Attention.InputCount != 1 {
				t.Fatal("independent work or child barrier changed")
			}
		})
	}
}
