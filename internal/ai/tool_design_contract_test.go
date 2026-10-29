package ai

import (
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"

	fltools "github.com/floegence/floret/v7/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestAllLocalToolErrorsPreserveFactsWithoutWordingInference(t *testing.T) {
	definitions := append(builtInToolDefinitions(), ToolDef{Name: "mcp_fixture"})
	for _, definition := range definitions {
		t.Run(definition.Name, func(t *testing.T) {
			message := "quoted permission denied; process not found; invalid cwd; timed out"
			failure := aitools.ClassifyError(errors.New(message))
			result, err := floretToolResultFromFlower(nil, ToolResult{ToolID: "failure", ToolName: definition.Name, Status: toolResultStatusError, Error: failure})
			if err != nil {
				t.Fatal(err)
			}
			text, err := decodeToolJSON([]byte(result.Text))
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(text, result.Structured) {
				t.Fatal("model boundaries differ")
			}
			diagnostic := result.Structured["error"].(map[string]any)
			if diagnostic["code"] != "UNKNOWN" || diagnostic["message"] != message || diagnostic["retryable"] != false || diagnostic["meta"] != nil || result.InputRequired != nil {
				t.Fatalf("invented handling: %+v", result)
			}
			if result.Activity == nil {
				t.Fatal("missing user-visible activity")
			}
		})
	}
}

func TestEncodingLossRetainsOnlyCorrelatedExecutionFacts(t *testing.T) {
	for _, mode := range []string{"partial", "mismatched_call", "mismatched_tool", "empty_prefix", "pending"} {
		t.Run(mode, func(t *testing.T) {
			source := ToolResult{ToolID: "effect", ToolName: "computer.exec", Status: toolResultStatusError, effectUncertain: true, Data: map[string]any{"bad": math.NaN(), "target_id": "untrusted"}, executionFacts: toolExecutionFacts{callID: "effect", toolName: "computer.exec", targetID: "observed", completedActions: []string{"snapshot", "click"}, needsObservation: true}}
			switch mode {
			case "mismatched_call":
				source.executionFacts.callID = "different"
			case "mismatched_tool":
				source.executionFacts.toolName = "other"
			case "empty_prefix":
				source.executionFacts.completedActions = nil
			case "pending":
				source.Pending = &PendingToolResult{Handle: "real-pending", Summary: "Existing interaction"}
			}
			result, err := floretToolResultFromFlower(nil, source)
			if err != nil {
				t.Fatal(err)
			}
			if result.InputRequired != nil {
				t.Fatal("manufactured interaction")
			}
			data := result.Structured["data"].(map[string]any)
			if data["result_unavailable"] != true {
				t.Fatal("result loss hidden")
			}
			if strings.HasPrefix(mode, "mismatched") {
				if data["target_id"] != nil || data["completed_actions"] != nil || data["invocation_completed"] != nil {
					t.Fatalf("uncorrelated facts escaped: %+v", data)
				}
			} else if data["target_id"] != "observed" || data["invocation_completed"] != false || data["needs_observation"] != true {
				t.Fatalf("facts lost: %+v", data)
			}
			if mode == "pending" {
				if result.Pending == nil || result.Pending.Handle != "real-pending" {
					t.Fatal("pending authority lost")
				}
			} else if result.EffectOutcome != fltools.EffectOutcomeUncertain {
				t.Fatal("effect uncertainty lost")
			}
			var snapshot map[string]any
			decoder := json.NewDecoder(strings.NewReader(result.Text))
			decoder.UseNumber()
			if err := decoder.Decode(&snapshot); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(snapshot, result.Structured) {
				t.Fatal("model text differs")
			}
		})
	}
}

func TestUndeliverableSafeResultRemainsInfrastructureFailure(t *testing.T) {
	source := ToolResult{ToolID: "effect", ToolName: "computer.exec", Status: toolResultStatusSuccess, Data: math.NaN(), executionFacts: toolExecutionFacts{callID: "effect", toolName: "computer.exec", completed: true, completedActions: []string{strings.Repeat("x", computerResultMaxBytes)}}}
	if _, err := floretToolResultFromFlower(nil, source); err == nil {
		t.Fatal("failed fallback was reported as delivered")
	}
}

func TestEncodingLossPreservesExecutionError(t *testing.T) {
	for _, code := range []aitools.ErrorCode{aitools.ErrorCodePermissionDenied, aitools.ErrorCodeTakeoverRequired, aitools.ErrorCodeUnknown} {
		t.Run(string(code), func(t *testing.T) {
			source := ToolResult{ToolID: "failed", ToolName: "computer.exec", Status: toolResultStatusError, Data: math.NaN(), Error: &aitools.ToolError{Code: code, Message: "Execution owner reported a failure.", Meta: map[string]any{"unencodable": math.NaN()}}}
			result, err := floretToolResultFromFlower(nil, source)
			if err != nil {
				t.Fatal(err)
			}
			diagnostic := result.Structured["error"].(map[string]any)
			data := result.Structured["data"].(map[string]any)
			if diagnostic["code"] != string(code) || !strings.Contains(diagnostic["message"].(string), source.Error.Message) || data["result_error_code"] != string(aitools.ErrorCodeToolResultEncodingFailed) || !result.IsError || result.InputRequired != nil {
				t.Fatalf("execution failure hidden by output failure: %+v", result)
			}
		})
	}
}
