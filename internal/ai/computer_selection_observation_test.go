package ai

import (
	"context"
	"strings"
	"testing"
)

type selectionObservationExecutor struct{ scriptTestExecutor }

func TestComputerCoreHelpExplainsAutomaticScreenshotsAndDocumentRefs(t *testing.T) {
	for _, browser := range []bool{false, true} {
		help, ok := computerScriptHelp("core", browser)
		for _, text := range []string{"automatically returns the image", "not PNG bytes or a filesystem path", "Refs identify the observed node, role and complete name within a document"} {
			if !ok || !strings.Contains(help, text) {
				t.Fatalf("missing lifecycle contract %q", text)
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
				if mode == "private" && payload["text"] != nil {
					t.Fatal("private observation escaped")
				}
			})
		}
	}
}
