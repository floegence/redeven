package ai

import (
	"context"
	"strings"
	"testing"
)

type selectionObservationExecutor struct{ scriptTestExecutor }

func TestComputerCoreHelpHasMinimalSignaturesAndNoWorkflow(t *testing.T) {
	for _, browser := range []bool{false, true} {
		help, ok := computerScriptHelp("core", browser)
		if !ok || len(help) > 3000 {
			t.Fatalf("core reference size: %d", len(help))
		}
		for _, signature := range []string{"ui.snapshot(", "ui.ref(", "ui.getByRole(", "locator.node()", "parent_ref is optional", "log(", "locator.fill(", "locator.press(", "ui.key(", "ui.doubleClick(", "status:'invalidated'", "without content", "read_options", "method inventory"} {
			if !strings.Contains(help, signature) {
				t.Fatalf("missing signature %s", signature)
			}
		}
		if browser {
			for _, signature := range []string{"browser.navigate(", "browser.back(", "browser.reload("} {
				if !strings.Contains(help, signature) {
					t.Fatalf("missing qualified signature %s", signature)
				}
			}
		}
		for _, directive := range []string{"Choose the next", "Use roles and refs", "before claiming completeness"} {
			if strings.Contains(help, directive) {
				t.Fatalf("prescriptive help: %s", directive)
			}
		}
	}
}

func (selectionObservationExecutor) EnsureTargetReady(context.Context, string) error { return nil }

func TestComputerSelectionKeepsBindingWhenInitialObservationFails(t *testing.T) {
	for _, kind := range []string{"desktop.screen", "browser.managed"} {
		for _, mode := range []string{"success", "unavailable", "private"} {
			t.Run(kind+"/"+mode, func(t *testing.T) {
				host, _, store, _ := computerBindingFixture(t)
				target := TargetDescriptor{ID: "desktop-main", Kind: kind, Ready: true, State: "ready"}
				if err := host.registry.Update(target); err != nil {
					t.Fatal(err)
				}
				reads := 0
				host.executors[target.ID] = selectionObservationExecutor{scriptTestExecutor{fn: func(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
					if call.ToolName == "computer.select_target" {
						return TargetToolResult{Result: map[string]any{"selected": true, "action_executed": false}}, nil
					}
					reads++
					if call.ToolName != "computer.observe" {
						t.Fatalf("unexpected operation %s", call.ToolName)
					}
					if mode == "unavailable" {
						return TargetToolResult{}, computerTargetFailure(call, "TARGET_OBSERVATION_UNAVAILABLE")
					}
					if mode == "private" {
						return TargetToolResult{Safety: &InteractionSafetyDecision{Level: "takeover", ReasonCodes: []string{"secret_input"}}, Result: map[string]any{"text": "private fixture"}}, nil
					}
					return TargetToolResult{Result: map[string]any{"observation": semanticTestTree()}}, nil
				}}}
				candidate, err := host.rememberComputerCandidate("thread-first", ComputerCandidate{TargetID: target.ID, Kind: target.Kind}, nil)
				if err != nil {
					t.Fatal(err)
				}
				r := &run{threadID: "thread-first", targetResolver: host, targetToolExecutor: host}
				bindTargetTestRun(t, r)
				value, err := r.execComputerManagement(computerAuthorizedTestContext(t, r, "select", "computer.select_target"), "select", "computer.select_target", map[string]any{"candidate_ref": candidate.CandidateRef})
				output, ok := value.(toolExecutionOutput)
				if !ok {
					t.Fatalf("missing selection result: %v %v", value, err)
				}
				payload := output.Payload.(map[string]any)
				if payload["selected"] != true || reads != 1 {
					t.Fatalf("lost selection/initial observation: %+v reads=%d", payload, reads)
				}
				selected, _ := store.GetComputerTarget(t.Context(), r.threadID)
				if selected != target.ID {
					t.Fatal("selection was rolled back")
				}
				if (mode == "success") != (err == nil) {
					t.Fatalf("unexpected observation result %v", err)
				}
				if mode == "unavailable" && payload["needs_observation"] != true {
					t.Fatal("missing recovery fact")
				}
				if kind == "browser.managed" && mode == "success" && payload["observation_status"] != "current" {
					t.Fatalf("initial snapshot lost freshness: %#v", payload)
				}
				if mode == "success" {
					tree := payload["observation"].(map[string]any)
					for _, raw := range tree["nodes"].([]any) {
						node := raw.(map[string]any)
						if node["platform_role"] == nil || node["canonical_role"] != nil || node["role"] != computerCanonicalRole(anyToString(node["platform_role"])) {
							t.Fatalf("inconsistent selection role: %#v", node)
						}
					}
				}
				if mode == "private" && payload["text"] != nil {
					t.Fatal("private observation escaped")
				}
			})
		}
	}
}
