package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
)

type subagentScopeTestRuntime struct {
	flruntime.ThreadService
	listErr error
	writes  int
}

func (s *subagentScopeTestRuntime) Summary(ctx context.Context, id identity.ThreadID) (flruntime.ThreadSummary, error) {
	return s.ThreadService.(flruntime.ThreadSummaryReader).Summary(ctx, id)
}

func (s *subagentScopeTestRuntime) List(ctx context.Context, scope flruntime.ThreadScope) ([]flruntime.ThreadSummary, error) {
	if s.listErr != nil {
		return nil, s.listErr
	}
	return s.ThreadService.List(ctx, scope)
}

func (s *subagentScopeTestRuntime) Steer(context.Context, flruntime.SteerInput) (flruntime.ThreadView, error) {
	s.writes++
	return flruntime.ThreadView{}, errors.New("unexpected child steering")
}

func (s *subagentScopeTestRuntime) Cancel(context.Context, flruntime.CancelInput) (flruntime.ThreadView, error) {
	s.writes++
	return flruntime.ThreadView{}, errors.New("unexpected child cancellation")
}

func (s *subagentScopeTestRuntime) WaitThreads(ctx context.Context, in flruntime.WaitThreadsInput) (flruntime.ThreadWaitResult, error) {
	return s.ThreadService.(flruntime.ThreadWaiter).WaitThreads(ctx, in)
}

func TestFlowerSubagentMissingTargetsRecoverWithoutMutation(t *testing.T) {
	adapter, _ := newSubagentHandoffTestAdapter(t, nil, nil)
	for _, action := range []string{subagentActionSendInput, subagentActionClose} {
		args := map[string]any{"target": "source-child", "message": "guidance"}
		var result map[string]any
		var err error
		if action == subagentActionSendInput {
			result, err = adapter.sendInput(t.Context(), "stale-input", args)
		} else {
			result, err = adapter.close(t.Context(), "stale-close", args)
		}
		if err != nil {
			t.Errorf("%s returned a tool error instead of scoped recovery: %v", action, err)
			continue
		}
		if result["status"] != "not_found" || result["parent_thread_id"] != "thread-parent" || result["target"] != "source-child" || result["recovery_action"] != "list" {
			t.Errorf("%s result=%#v", action, result)
		}
		if result["accepted"] == true || result["closed"] == true || result["stopped"] == true {
			t.Errorf("missing target claimed success: %#v", result)
		}
	}
}

func TestFlowerSubagentScopeReadFailuresRemainErrors(t *testing.T) {
	for _, failure := range []error{errors.New("canonical inventory unavailable"), sql.ErrNoRows, context.Canceled} {
		adapter, _ := newSubagentHandoffTestAdapter(t, nil, nil)
		adapter.service.threadRuntime = &subagentScopeTestRuntime{listErr: failure}
		for _, action := range []string{subagentActionSendInput, subagentActionClose} {
			_, err := adapter.manage(t.Context(), "read-failure", map[string]any{"action": action, "target": "child", "message": "guidance"})
			if !errors.Is(err, failure) {
				t.Errorf("%s hides canonical read error %v: %v", action, failure, err)
			}
		}
	}
}

func TestFlowerSubagentForkAndIndependentRootCannotControlSourceChildren(t *testing.T) {
	f := newParentEventForkFixture(t)
	fork, err := f.service.ForkThreadWithOptions(t.Context(), testSendTurnMeta(), f.source, ForkThreadRequest{ClientRequestID: "fork-child-scope", Title: "Separate scope"})
	if err != nil {
		t.Fatal(err)
	}
	other, err := f.service.CreateThread(t.Context(), testSendTurnMeta(), "Independent root", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		before, err := f.canonical.View(t.Context(), f.child)
		if err != nil {
			t.Fatal(err)
		}
		guard := &subagentScopeTestRuntime{ThreadService: f.canonical}
		f.service.threadRuntime = guard
		for _, parentID := range []string{fork.ThreadID, other.ThreadID} {
			adapter := newServiceFloretSubagentRuntime(f.service, &run{threadID: parentID, turnID: "scope-turn"})
			for _, action := range []string{subagentActionSendInput, subagentActionClose, subagentActionInspect, subagentActionStatus} {
				result, err := adapter.manage(t.Context(), "foreign-"+action, map[string]any{"action": action, "target": f.child.String(), "message": "Must not reach the source child."})
				if err != nil || result["status"] != "not_found" {
					t.Fatalf("%s %s=%#v err=%v", parentID, action, result, err)
				}
			}
			listed, err := adapter.list(t.Context(), nil)
			if err != nil || listed["total"] != 0 {
				t.Fatalf("foreign list=%#v err=%v", listed, err)
			}
			waited, err := adapter.wait(t.Context(), map[string]any{"ids": []any{f.child.String()}, "timeout_ms": 1})
			if err != nil || waited["reason"] != "missing" || waited["found_count"] != 0 {
				t.Fatalf("foreign wait=%#v err=%v", waited, err)
			}
			closed, err := adapter.closeAll(t.Context(), "foreign-close-all", nil)
			if err != nil || closed["closed_count"] != 0 {
				t.Fatalf("foreign close_all=%#v err=%v", closed, err)
			}
			if _, err := f.service.GetFlowerSubagentDetail(t.Context(), testSendTurnMeta(), parentID, f.child.String()); !errors.Is(err, sql.ErrNoRows) {
				t.Fatalf("foreign detail err=%v", err)
			}
		}
		after, err := f.canonical.View(t.Context(), f.child)
		if err != nil || !reflect.DeepEqual(before, after) || guard.writes != 0 {
			t.Fatalf("foreign operations changed original child: writes=%d err=%v", guard.writes, err)
		}
		parentID := identity.ThreadID(f.source)
		children, err := f.canonical.List(t.Context(), flruntime.ThreadScope{ParentID: &parentID})
		if err != nil || len(children) != 1 || children[0].ID != f.child {
			t.Fatalf("source lost child ownership: %+v %v", children, err)
		}
		if err := f.host.Shutdown(t.Context()); err != nil {
			t.Fatal(err)
		}
		f.open(t)
	}
}

func TestFlowerSubagentStaleTargetResultContinuesProviderTurn(t *testing.T) {
	for _, action := range []string{subagentActionSendInput, subagentActionClose} {
		t.Run(action, func(t *testing.T) {
			adapter, _ := newSubagentHandoffTestAdapter(t, nil, nil)
			tool := fltools.Define[map[string]any](fltools.Definition{Name: "subagents", InputSchema: fltools.StrictObject(map[string]any{"action": map[string]any{"type": "string"}}, []string{"action"}), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(ctx context.Context, inv fltools.Invocation[map[string]any]) (fltools.Result, error) {
				data, err := adapter.manage(ctx, inv.CallID, map[string]any{"action": action, "target": "source-child", "message": "guidance"})
				if err != nil {
					return fltools.Result{}, err
				}
				return floretToolResultFromFlower(nil, ToolResult{ToolID: inv.CallID, ToolName: "subagents", Status: toolResultStatusSuccess, Data: data})
			})
			args, _ := json.Marshal(map[string]any{"action": action})
			gateway := delegationContextGateway(delegationContextCall("stale-target", string(args)), delegationContextDone())
			service := delegationContextThread(t, gateway, func(context.Context, flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
				return flruntime.ToolSurface{Tools: fltools.NewRegistry(tool)}, nil
			})
			created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "stale-target-create"})
			if err != nil {
				t.Fatal(err)
			}
			delegationContextSend(t, service, created.ThreadID, "recover-stale-target", nil)
			requests := gateway.Requests()
			if len(requests) != 2 {
				t.Fatalf("provider requests=%d", len(requests))
			}
			var resultText string
			for _, message := range requests[1].Messages {
				if message.ToolResult != nil && message.ToolResult.CallID == "stale-target" {
					resultText = message.ToolResult.Text
				}
			}
			for _, want := range []string{"not_found", "recovery_action", "No action was taken", "thread-parent"} {
				if !strings.Contains(resultText, want) {
					t.Fatalf("provider lost %q: %s", want, resultText)
				}
			}
		})
	}
}
