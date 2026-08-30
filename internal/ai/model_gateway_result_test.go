package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v6/provider"
)

type fixedModelGatewayResult struct {
	result ModelGatewayResult
}

func (g fixedModelGatewayResult) StreamTurn(context.Context, ModelGatewayRequest, func(StreamEvent)) (ModelGatewayResult, error) {
	return g.result, nil
}

func TestModelGatewayResultToolCallJSONRequiresAndPreservesArguments(t *testing.T) {
	t.Parallel()

	original := ModelGatewayResult{
		FinishReason: "tool_calls",
		ToolCalls: []ToolCall{{
			ID:   "call_okf_index",
			Name: "okf.index",
			Args: map[string]any{},
		}},
	}
	raw, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if !strings.Contains(string(raw), `"id":"call_okf_index"`) || !strings.Contains(string(raw), `"args":{}`) {
		t.Fatalf("model gateway result JSON omitted required tool-call fields: %s", raw)
	}

	var roundTrip ModelGatewayResult
	if err := json.Unmarshal(raw, &roundTrip); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if err := validateModelGatewayResult(roundTrip); err != nil {
		t.Fatalf("validateModelGatewayResult: %v", err)
	}
	if len(roundTrip.ToolCalls) != 1 || roundTrip.ToolCalls[0].Args == nil || len(roundTrip.ToolCalls[0].Args) != 0 {
		t.Fatalf("round-trip tool calls=%#v, want one non-nil empty argument object", roundTrip.ToolCalls)
	}
}

func TestValidateModelGatewayResultRejectsIncompleteToolCalls(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		call         ToolCall
		missingField string
	}{
		{name: "missing id", call: ToolCall{Name: "okf.index", Args: map[string]any{}}, missingField: "id"},
		{name: "missing name", call: ToolCall{ID: "call_1", Args: map[string]any{}}, missingField: "name"},
		{name: "missing args", call: ToolCall{ID: "call_1", Name: "okf.index"}, missingField: "args"},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			err := validateModelGatewayResult(ModelGatewayResult{ToolCalls: []ToolCall{testCase.call}})
			var contractErr *modelGatewayContractError
			if !errors.As(err, &contractErr) {
				t.Fatalf("error=%v, want modelGatewayContractError", err)
			}
			if !strings.Contains(err.Error(), testCase.missingField) {
				t.Fatalf("error=%q, want missing field %q", err, testCase.missingField)
			}
		})
	}
}

func TestFloretProviderRejectsIncompleteModelGatewayToolCallBeforeDispatch(t *testing.T) {
	t.Parallel()

	adapter := newFloretProviderAdapter(
		fixedModelGatewayResult{result: ModelGatewayResult{
			FinishReason: "tool_calls",
			ToolCalls: []ToolCall{{
				ID:   "call_1",
				Name: "okf.index",
			}},
		}},
		"deepseek",
		"deepseek-v4-flash",
		ProviderControls{},
		TurnBudgets{},
		"",
	)
	stream, err := adapter.Stream(context.Background(), flprovider.Request{
		Messages: []flprovider.Message{{Role: flprovider.RoleUser, Text: "introduce Redeven"}},
	})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	errorEvents := 0
	toolCallEvents := 0
	for event := range stream {
		switch event.Type {
		case flprovider.EventError:
			errorEvents++
			var contractErr *modelGatewayContractError
			if !errors.As(event.Err, &contractErr) {
				t.Fatalf("event error=%v, want modelGatewayContractError", event.Err)
			}
		case flprovider.EventToolCalls:
			toolCallEvents++
		}
	}
	if errorEvents != 1 || toolCallEvents != 0 {
		t.Fatalf("error events=%d tool-call events=%d, want one error and no dispatchable calls", errorEvents, toolCallEvents)
	}
}

var _ ModelGateway = fixedModelGatewayResult{}
