package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
)

func TestPublishedStrictRepetitionThroughFlowerAdapter(t *testing.T) {
	for _, tc := range []struct {
		name                                       string
		count                                      int
		hosted, alternating, descriptions, failure bool
		dispatched                                 int
	}{
		{name: "hosted searches break sequence", count: 6, hosted: true, dispatched: 6},
		{name: "alternating individual calls", count: 6, alternating: true, dispatched: 6},
		{name: "description changes", count: 6, descriptions: true, dispatched: 6},
		{name: "feedback permits summary", count: 4, dispatched: 3},
		{name: "unchanged after feedback fails", count: 5, failure: true, dispatched: 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			const report = "Saved complete child report: confirmed observation."
			child := completedSubagentTestSummary("child-result", "Review", "preview", time.Now())
			adapter, _ := newSubagentHandoffTestAdapter(t, []flruntime.ThreadSummary{child}, map[identity.ThreadID]flruntime.ThreadView{child.ID: completedSubagentTestView(child, report)})
			var dispatched, independent atomic.Int32
			collect := fltools.Define[map[string]any](fltools.Definition{Name: "subagent_manage", ReadOnly: true, InputSchema: fltools.StrictObject(map[string]any{"action": fltools.String("Action"), "description": fltools.String("Description")}, []string{"action", "description"}), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(ctx context.Context, inv fltools.Invocation[map[string]any]) (fltools.Result, error) {
				dispatched.Add(1)
				data, err := adapter.manage(ctx, inv.CallID, inv.Args)
				if err != nil {
					return fltools.Result{}, err
				}
				return floretToolResultFromFlower(nil, ToolResult{ToolID: inv.CallID, ToolName: inv.Name, Status: toolResultStatusSuccess, Data: data})
			})
			other := fltools.Define[struct{}](fltools.Definition{Name: "independent", ReadOnly: true, InputSchema: fltools.StrictObject(nil, nil), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(context.Context, fltools.Invocation[struct{}]) (fltools.Result, error) {
				independent.Add(1)
				return fltools.Result{Text: "Other evidence"}, nil
			})
			var steps []florettest.Step
			for i := 0; i < tc.count; i++ {
				description := "Collect completed report"
				if tc.descriptions {
					description = fmt.Sprintf("Collect completed report %d", i)
				}
				args, _ := json.Marshal(map[string]string{"action": "wait", "description": description})
				events := []flprovider.Event{}
				if tc.hosted {
					search := flprovider.ToolCall{ID: fmt.Sprintf("search-%d", i), Name: "web_search", Args: "{}"}
					events = append(events, flprovider.Event{Type: flprovider.EventHostedToolCall, HostedToolCall: &search}, flprovider.Event{Type: flprovider.EventHostedToolResult, HostedToolCall: &search, HostedResult: &flprovider.HostedToolResult{Text: "Search complete"}})
				}
				calls := []flprovider.ToolCall{{ID: fmt.Sprintf("inspect-%d", i), Name: "subagent_manage", Args: string(args)}}
				if tc.alternating {
					calls = append(calls, flprovider.ToolCall{ID: fmt.Sprintf("other-%d", i), Name: "independent", Args: "{}"})
				}
				events = append(events, flprovider.Event{Type: flprovider.EventToolCalls, ToolCalls: calls}, flprovider.Event{Type: flprovider.EventDone, Reason: "tool_calls"})
				steps = append(steps, florettest.Step{Events: events})
			}
			if !tc.failure {
				steps = append(steps, delegationContextDone())
			}
			gateway := delegationContextGateway(steps...)
			service := delegationContextThread(t, gateway, func(context.Context, flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
				surface := flruntime.ToolSurface{Tools: fltools.NewRegistry(collect, other)}
				if tc.hosted {
					surface.HostedToolDefinitions = []flprovider.HostedToolDefinition{{Name: "web_search", Type: "web_search"}}
				}
				return surface, nil
			})
			created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
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
			if _, err = service.Send(ctx, flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "send", Input: flruntime.UserInput{Text: "Review saved report"}}); err != nil {
				t.Fatal(err)
			}
			var view flruntime.ThreadView
			for {
				view, err = service.View(ctx, created.ThreadID)
				if err != nil {
					t.Fatal(err)
				}
				if view.Activity == flruntime.ThreadActivityIdle && view.LastOutcome != nil {
					break
				}
				if _, err = updates.Next(ctx); err != nil {
					t.Fatal(err)
				}
			}
			if dispatched.Load() != int32(tc.dispatched) {
				t.Fatalf("dispatched=%d failure=%+v", dispatched.Load(), view.Failure)
			}
			if tc.alternating && independent.Load() != 6 {
				t.Fatalf("independent calls=%d", independent.Load())
			}
			if tc.failure {
				if view.Failure == nil || view.Failure.ToolRepetition == nil {
					t.Fatalf("missing failure: %+v", view.Failure)
				}
				code, _ := projectFloretTurnFailure(view.Failure, "")
				detail := scopedFailureDetail(view.Failure, created.ThreadID.String(), string(view.TurnID), string(view.RunID))
				for _, fact := range []string{"subagent_manage", "inspect-4", "\"consecutive_calls\": 5", "\"repeat_limit\": 3", "\"not_executed\": true", "\"feedback_given\": true"} {
					if !strings.Contains(detail, fact) {
						t.Fatalf("missing %s: %s", fact, detail)
					}
				}
				if code != runErrorCodeRepeatedTools {
					t.Fatalf("code=%s", code)
				}
			} else if view.Failure != nil || *view.LastOutcome != flruntime.TurnOutcomeCompleted {
				t.Fatalf("outcome=%v failure=%+v", view.LastOutcome, view.Failure)
			}
			requests := gateway.Requests()
			last := requests[len(requests)-1]
			saved, feedback := false, false
			for _, message := range last.Messages {
				if message.ToolResult != nil {
					saved = saved || strings.Contains(message.ToolResult.Text, report)
					feedback = feedback || strings.Contains(message.ToolResult.Text, "not executed")
				}
			}
			if !saved {
				t.Fatal("model lost completed report")
			}
			if !tc.hosted && !tc.alternating && !tc.descriptions && !feedback {
				t.Fatal("model did not receive paired non-execution feedback")
			}
		})
	}
}
