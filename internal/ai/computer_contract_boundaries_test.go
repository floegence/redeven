package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"testing"
)

func TestComputerExchangeStopReasonIsIndependentOfEffect(t *testing.T) {
	for _, tc := range []struct {
		cause  error
		reason string
	}{{context.DeadlineExceeded, "deadline_exceeded"}, {context.Canceled, "cancelled"}, {io.EOF, "connection_closed"}, {errors.New("private text"), ""}} {
		t.Run(fmt.Sprint(tc.cause), func(t *testing.T) {
			runtime, call := scriptRuntimeFixture(t, func(_ context.Context, inner TargetToolCall) (TargetToolResult, error) {
				return computerBrowserExchangeFailure(inner, false, &browserHostCallError{reason: "response_unavailable", cause: tc.cause})
			})
			result, err := executeTestScript(t.Context(), runtime, call, "await ui.click(1,2); await ui.click(3,4);")
			payload := result.Result.(map[string]any)
			if !errors.Is(err, errComputerEffectUnknown) || !errors.Is(err, tc.cause) || payload["effect_outcome_unknown"] != true || payload["action_executed"] != false {
				t.Fatalf("lost independent outcome: %#v %v", payload, err)
			}
			if got, _ := payload["stop_reason"].(string); got != tc.reason {
				t.Fatalf("stop reason %q, want %q", got, tc.reason)
			}
			if (payload["budget_exhausted"] == "time") != errors.Is(tc.cause, context.DeadlineExceeded) {
				t.Fatalf("budget inferred without typed deadline: %#v", payload)
			}
			if encoded, _ := json.Marshal(payload); strings.Contains(string(encoded), "private text") {
				t.Fatal("raw cause leaked")
			}
		})
	}
}

func TestComputerActivityPreservesMeasuredActionability(t *testing.T) {
	raw := map[string]any{"stage": "hit_or_layout", "connected": true, "failed_checks": []any{"receives"}, "tested_point": map[string]any{"x": 136., "y": 237.}, "private": "excluded"}
	want := computerActionabilityFacts(raw)
	rows := computerActivityResultRows("computer.exec", map[string]any{"actionability": raw})
	for _, row := range rows {
		if row.Title == "actionability" {
			var got map[string]any
			if err := json.Unmarshal([]byte(row.Content), &got); err != nil {
				t.Fatal(err)
			}
			encoded, _ := json.Marshal(want)
			var expected map[string]any
			_ = json.Unmarshal(encoded, &expected)
			if !reflect.DeepEqual(got, expected) {
				t.Fatalf("activity changed measurements: %#v", got)
			}
			return
		}
	}
	t.Fatal("activity omitted actionability")
}

func TestComputerContractTopicsAndBoundaries(t *testing.T) {
	for _, kind := range []string{"browser.connected", "desktop.window"} {
		contract := computerTargetContract(TargetDescriptor{Kind: kind})
		if contract["version"] != 3 || len(contract["documentation"].(string)) > 3000 {
			t.Fatal("unbounded/old core contract")
		}
		for _, topic := range contract["help_topics"].([]string) {
			if text, ok := computerScriptHelp(topic, strings.HasPrefix(kind, "browser.")); !ok || text == "" {
				t.Fatalf("unavailable topic %q", topic)
			}
		}
	}
	if len(computerScriptDocumentation) > 900 {
		t.Fatal("tool description duplicated detailed contract")
	}
}
