package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	fltools "github.com/floegence/floret/v7/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestComputerResourceFailuresStopBeforeDispatch(t *testing.T) {
	for _, scenario := range []string{"closed current", "closed explicit", "expired candidate", "other thread candidate", "not allowed", "ready"} {
		t.Run(scenario, func(t *testing.T) {
			host, executor, store, _ := computerBindingFixture(t)
			if err := store.SetComputerTarget(t.Context(), "thread-first", "browser-main"); err != nil {
				t.Fatal(err)
			}
			if err := host.registry.Register(TargetDescriptor{ID: "replacement", Kind: "browser.managed", Ready: true}); err != nil {
				t.Fatal(err)
			}
			r := &run{targetResolver: host, targetToolExecutor: host}
			toolName, args, wantCode := "browser.reload", map[string]any{"description": "Reload the selected page"}, "TARGET_UNAVAILABLE"
			switch scenario {
			case "closed current", "closed explicit":
				host.registry.remove("browser-main")
				if scenario == "closed explicit" {
					args["target"] = "browser-main"
				}
			case "expired candidate", "other thread candidate":
				candidate, err := host.rememberComputerCandidate("thread-first", ComputerCandidate{TargetID: "replacement", Kind: "browser.managed", State: "ready"}, nil)
				if err != nil {
					t.Fatal(err)
				}
				stored := host.candidates[candidate.CandidateRef]
				if scenario == "expired candidate" {
					stored.expires = time.Now().Add(-time.Minute)
				} else {
					stored.threadID = "thread-second"
				}
				host.candidates[candidate.CandidateRef] = stored
				toolName, args, wantCode = "computer.select_target", map[string]any{"candidate_ref": candidate.CandidateRef, "description": "Select discovered page"}, "TARGET_SELECTION_STALE"
			case "not allowed":
				r.toolTargetPolicy = ToolTargetPolicy{AllowedTargetIDs: []string{"replacement"}}
				wantCode = "TARGET_NOT_ALLOWED"
			case "ready":
				wantCode = ""
			}
			inv := fltools.Invocation[map[string]any]{Name: toolName, ThreadID: "thread-first", Args: args}
			resources, resolveErr := floretComputerResources(r, inv)
			if wantCode != "" {
				classified := aitools.ClassifyError(aitools.Invocation{ToolName: toolName}, resolveErr)
				if classified == nil || string(classified.Code) != wantCode {
					t.Fatalf("resource failure lost classification: %+v (%v)", classified, resolveErr)
				}
			} else if resolveErr != nil || len(resources) != 1 || resources[0].Value != "browser-main" {
				t.Fatalf("normal resolution: %+v %v", resources, resolveErr)
			}
			var dispatches, handlers int
			var schema map[string]any
			for _, definition := range builtInComputerToolDefinitions() {
				if definition.Name == toolName {
					if err := json.Unmarshal(definition.InputSchema, &schema); err != nil {
						t.Fatal(err)
					}
				}
			}
			registry := fltools.NewRegistry(fltools.Define(fltools.Definition{Name: toolName, InputSchema: schema, Effects: []fltools.Effect{fltools.EffectWrite}, Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil,
				func(inv fltools.Invocation[map[string]any]) ([]fltools.ResourceRef, error) {
					return floretComputerResources(r, inv)
				},
				func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
					handlers++
					return fltools.Result{}, nil
				}))
			raw, _ := json.Marshal(args)
			result := registry.Dispatch(t.Context(), fltools.ToolCall{ID: "reload", Name: toolName, Args: string(raw)}, fltools.DispatchOptions{ThreadID: "thread-first", EffectDispatcher: func(ctx context.Context, _ fltools.EffectDispatchRequest, execute func(context.Context) fltools.Result) fltools.Result {
				dispatches++
				return execute(ctx)
			}})
			if wantCode == "" {
				if result.IsError || dispatches != 1 || handlers != 1 {
					t.Fatalf("normal dispatch: %+v %d %d", result, dispatches, handlers)
				}
			} else {
				if !result.IsError || !strings.Contains(result.Text, wantCode) || !strings.Contains(result.Text, "Tool execution has not started") || dispatches != 0 || handlers != 0 || len(executor.calls) != 0 {
					t.Fatalf("failure reached execution or lost facts: %+v dispatches=%d handlers=%d effects=%+v", result, dispatches, handlers, executor.calls)
				}
				if strings.Contains(result.Text, "computer.targets") || strings.Contains(result.Text, "computer.select_target:") {
					t.Fatalf("resource error prescribes a route: %s", result.Text)
				}
			}
			bound, err := store.GetComputerTarget(t.Context(), "thread-first")
			if err != nil || bound != "browser-main" {
				t.Fatalf("resource resolution changed binding: %q %v", bound, err)
			}
		})
	}
}

func TestComputerModelErrorKeepsFactsAndActivityKeepsAssistance(t *testing.T) {
	failure := &targetToolPolicyError{code: "target_connection_required", tool: "browser.reload", target: "closed", targetKind: "browser.connected", targetState: "connection_required", repairAction: "connect_current_browser", safety: &InteractionSafetyDecision{Level: "takeover"}}
	source := ToolResult{ToolID: "reload", ToolName: "browser.reload", Status: toolResultStatusError, Error: aitools.ClassifyError(aitools.Invocation{}, failure), Data: map[string]any{"target_id": "closed", "action_executed": false}}
	result, err := floretToolResultFromFlower(nil, source)
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{result.Text, string(mustMarshalComputerError(t, result.Structured))} {
		for _, route := range []string{"repair_action", "suggested_targets", "Use computer.targets"} {
			if strings.Contains(text, route) {
				t.Fatalf("model error contains route %q: %s", route, text)
			}
		}
		for _, fact := range []string{"TARGET_CONNECTION_REQUIRED", "target_state", "connection_required", "safety", "action_executed"} {
			if !strings.Contains(text, fact) {
				t.Fatalf("model error lost %q: %s", fact, text)
			}
		}
	}
	activity := string(mustMarshalComputerError(t, result.Activity))
	if !strings.Contains(activity, "The selected page is disconnected.") || !strings.Contains(activity, "closed") {
		t.Fatalf("Activity lost the user-visible failure or target: %s", activity)
	}
	if !strings.Contains(string(mustMarshalComputerError(t, source.Error)), "repair_action") {
		t.Fatal("model projection mutated source error")
	}
}

func TestComputerModelErrorProjectionPreservesTopLevelFacts(t *testing.T) {
	failure := &aitools.ToolError{Code: aitools.ErrorCodeTargetUnavailable, Message: "The selected page is unavailable.", Meta: map[string]any{"target_state": "unavailable", "repair_action": "choose_target", "suggested_targets": []string{"browser.managed"}}}
	model := modelToolErrorPayload(failure, "browser.reload")
	meta := model["meta"].(map[string]any)
	if meta["target_state"] != "unavailable" || meta["repair_action"] != nil || meta["suggested_targets"] != nil {
		t.Fatalf("unexpected model metadata: %+v", meta)
	}
	if failure.Meta["repair_action"] == nil || modelToolErrorPayload(failure, "read_file")["meta"].(map[string]any)["repair_action"] == nil {
		t.Fatal("computer projection modified source or unrelated tools")
	}
}

func TestComputerTargetErrorsDescribeStateWithoutToolRoutes(t *testing.T) {
	for _, code := range []string{"target_connection_required", "target_in_use", "target_ambiguous", "target_selection_stale", "target_unavailable", "target_observation_unavailable", "frame_unavailable", "target_action_failed", "recovery_observation_required"} {
		message := (&targetToolPolicyError{code: code}).Error()
		for _, route := range []string{"computer.", "Use ", "Choose ", "Refresh ", "Observe ", "Inspect ", "reconnect"} {
			if strings.Contains(message, route) {
				t.Fatalf("%s prescribes %q: %s", code, route, message)
			}
		}
	}
}

func TestComputerEncodingFailurePreservesNoReplayWithoutToolRoutes(t *testing.T) {
	for _, name := range []string{"computer.targets", "computer.exec", "computer.observe"} {
		encoded, err := encodeModelToolResult(ToolResult{ToolName: name, Status: toolResultStatusSuccess, Data: func() {}})
		if err != nil {
			t.Fatal(err)
		}
		if encoded.result.Error == nil || encoded.result.Error.Code != aitools.ErrorCodeToolResultEncodingFailed {
			t.Fatalf("encoding error lost classification: %+v", encoded.result)
		}
		message := encoded.result.Error.Message
		if !strings.Contains(message, "does not establish that an action did not execute") || !strings.Contains(message, "Completed actions must not be replayed") {
			t.Fatalf("encoding error lost effect safety: %s", message)
		}
		for _, tool := range []string{"computer.targets", "computer.select_target", "computer.observe", "computer.screenshot"} {
			if strings.Contains(message, tool) {
				t.Fatalf("encoding failure prescribed a tool route: %s", message)
			}
		}
	}
}

func mustMarshalComputerError(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
