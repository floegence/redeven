package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
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
			Name: "okf_get_index",
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
		{name: "missing id", call: ToolCall{Name: "okf_get_index", Args: map[string]any{}}, missingField: "id"},
		{name: "missing name", call: ToolCall{ID: "call_1", Args: map[string]any{}}, missingField: "name"},
		{name: "missing args", call: ToolCall{ID: "call_1", Name: "okf_get_index"}, missingField: "args"},
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
				Name: "okf_get_index",
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

func TestModelGatewayPreservesRawArgumentsForEngineValidation(t *testing.T) {
	for _, arguments := range []string{`{"value": unquoted}`, `[]`, `null`, `{"integer":9007199254740993}`} {
		t.Run(arguments, func(t *testing.T) {
			// Decode the actual RPC envelope rather than constructing an internal call.
			raw, _ := json.Marshal(map[string]any{"finish_reason": "tool_calls", "tool_calls": []any{map[string]any{"id": "call", "name": "inspect", "args_json": arguments}}})
			var result ModelGatewayResult
			if err := json.Unmarshal(raw, &result); err != nil {
				t.Fatal(err)
			}
			if err := validateModelGatewayResult(result); err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(result)
			if err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(encoded, &result); err != nil {
				t.Fatal(err)
			}
			calls, err := floretToolCallsFromFlower(result.ToolCalls)
			if err != nil || len(calls) != 1 || calls[0].Args != arguments {
				t.Fatalf("calls=%+v err=%v", calls, err)
			}
			adapter := &floretProviderAdapter{}
			messages, err := adapter.floretMessagesToFlowerWithResolver(t.Context(), []flprovider.Message{{Role: flprovider.RoleAssistant, ToolCalls: calls}}, nil)
			if err != nil || len(messages) != 1 || messages[0].Content[0].ArgsJSON != arguments {
				t.Fatalf("history=%+v err=%v", messages, err)
			}
			history := buildToolCallMessages(result.ToolCalls, "")
			if len(history) != 1 || history[0].Content[0].ArgsJSON != arguments {
				t.Fatalf("gateway history lost raw arguments: %+v", history)
			}
		})
	}
}

func TestModelGatewayRejectsConflictingArgumentAuthorities(t *testing.T) {
	var result ModelGatewayResult
	if err := json.Unmarshal([]byte(`{"tool_calls":[{"id":"call","name":"inspect","args":{},"args_json":"{broken"}]}`), &result); err != nil {
		t.Fatal(err)
	}
	if err := validateModelGatewayResult(result); err == nil {
		t.Fatal("ambiguous argument authorities accepted")
	}
}

func TestFloretProviderForwardsArgumentFragmentsWithoutParsing(t *testing.T) {
	adapter := &floretProviderAdapter{}
	var arguments strings.Builder
	ends := 0
	stream := adapter.streamPreparedTurn(t.Context(), flprovider.Request{}, func(_ context.Context, emit func(StreamEvent)) (ModelGatewayResult, error) {
		emit(StreamEvent{Type: StreamEventToolCallStart, ToolCall: &PartialToolCall{ID: "call", Name: "inspect"}})
		for _, delta := range []string{`{"content":"`, `中文\n`, `done"}`} {
			emit(StreamEvent{Type: StreamEventToolCallDelta, Text: delta, ToolCall: &PartialToolCall{ID: "call", Name: "inspect"}})
		}
		emit(StreamEvent{Type: StreamEventToolCallEnd, ToolCall: &PartialToolCall{ID: "call", Name: "inspect", Arguments: map[string]any{"content": "中文\ndone"}}})
		return ModelGatewayResult{FinishReason: "tool_calls", ToolCalls: []ToolCall{{ID: "call", Name: "inspect", Args: map[string]any{"content": "中文\ndone"}}}}, nil
	})
	for event := range stream {
		switch event.Type {
		case flprovider.EventError:
			t.Fatal(event.Err)
		case flprovider.EventToolCallDelta:
			arguments.WriteString(event.Text)
		case flprovider.EventToolCallEnd:
			ends++
		}
	}
	if arguments.String() != `{"content":"中文\ndone"}` || ends != 1 {
		t.Fatalf("arguments=%q ends=%d", arguments.String(), ends)
	}
}
